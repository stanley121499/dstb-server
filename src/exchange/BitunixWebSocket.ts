import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import WebSocket from "ws";

import { createAuthPayload } from "./bitunixAuth.js";
import { ExchangeError } from "./ExchangeError.js";

type PendingRequest = Readonly<{
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
}>;

type KlineEvent = Readonly<{
  channel: string;
  symbol: string;
  timestampMs: number;
  data: Readonly<Record<string, unknown>>;
  raw: unknown;
}>;

type Subscription = Readonly<{
  key: string;
  payload: Readonly<Record<string, unknown>>;
}>;

/**
 * Manages Bitunix WebSocket lifecycle, authentication, subscriptions, and reconnects.
 */
export class BitunixWebSocket extends EventEmitter {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;

  private ws: WebSocket | null;
  private isConnectedFlag: boolean;
  private isAuthenticatedFlag: boolean;
  private readonly pendingRequests: Map<string, PendingRequest>;
  private readonly subscriptions: Map<string, Subscription>;
  private reconnectAttempts: number;
  private shouldReconnect: boolean;
  private isReconnecting: boolean;
  private pingHandle: NodeJS.Timeout | null;
  private pongHandle: NodeJS.Timeout | null;
  private heartbeatHandle: NodeJS.Timeout | null;
  private lastHeartbeatMs: number;

  /**
   * Creates a new Bitunix WebSocket manager.
   */
  public constructor(args: Readonly<{
    url: string;
    apiKey: string;
    secretKey: string;
    pingIntervalMs?: number;
  }>) {
    super();
    // Step 1: Persist connection settings.
    this.url = args.url;
    this.apiKey = args.apiKey;
    this.secretKey = args.secretKey;
    this.pingIntervalMs = args.pingIntervalMs ?? 20_000;
    this.pongTimeoutMs = 30_000;
    this.reconnectBaseDelayMs = 1_000;
    this.reconnectMaxDelayMs = 60_000;
    this.maxReconnectAttempts = 10;
    this.heartbeatIntervalMs = 30_000;
    this.heartbeatTimeoutMs = 60_000;

    // Step 2: Initialize socket state and tracking data.
    this.ws = null;
    this.isConnectedFlag = false;
    this.isAuthenticatedFlag = false;
    this.pendingRequests = new Map<string, PendingRequest>();
    this.subscriptions = new Map<string, Subscription>();
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
    this.isReconnecting = false;
    this.pingHandle = null;
    this.pongHandle = null;
    this.heartbeatHandle = null;
    this.lastHeartbeatMs = Date.now();
  }

  /**
   * Connects to the Bitunix WebSocket and authenticates.
   */
  public async connect(): Promise<void> {
    // Step 1: Avoid double-connecting.
    if (this.isConnectedFlag) {
      return;
    }

    // Step 2: Open socket and authenticate.
    this.shouldReconnect = true;
    this.isReconnecting = false;
    await this.openSocket();
    await this.authenticate();
    await this.resubscribeAll();
  }

  /**
   * Disconnects and cleans up any active subscriptions.
   */
  public async disconnect(): Promise<void> {
    // Step 1: Disable auto-reconnect and stop timers.
    this.shouldReconnect = false;
    this.isReconnecting = false;
    this.clearPing();
    this.clearPong();
    this.clearHeartbeatMonitor();
    this.clearPendingRequests();

    // Step 2: Tear down the raw socket without triggering an unhandled `error` on `ws`.
    // Calling `close()` while still CONNECTING makes `ws` emit `error` ("closed before established");
    // if no listener remains, Node crashes the process.
    const socket = this.ws;
    this.ws = null;
    this.isConnectedFlag = false;
    this.isAuthenticatedFlag = false;

    if (socket !== null) {
      socket.removeAllListeners();
      socket.on("error", () => {
        /* Intentional teardown — ignore spurious errors from half-open sockets. */
      });
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        } else if (socket.readyState !== WebSocket.CLOSED) {
          socket.terminate();
        }
      } catch {
        /* Closing can throw in edge cases; state is already cleared above. */
      }
    }
  }

  /**
   * Returns whether the WebSocket is connected and authenticated.
   */
  public isReady(): boolean {
    // Step 1: Report connection + authentication readiness.
    return this.isConnectedFlag && this.isAuthenticatedFlag;
  }

  /**
   * Returns whether the WebSocket is healthy (connected and receiving data).
   */
  public isHealthy(): boolean {
    // Step 1: Ensure socket is authenticated.
    if (!this.isReady()) {
      return false;
    }
    // Step 2: Ensure heartbeat is fresh.
    const elapsed = Date.now() - this.lastHeartbeatMs;
    return elapsed <= this.heartbeatTimeoutMs;
  }

  /**
   * Registers a listener for kline messages.
   */
  public onKline(listener: (event: KlineEvent) => void): () => void {
    // Step 1: Register listener and return unsubscribe handler.
    this.on("kline", listener);
    return () => {
      this.off("kline", listener);
    };
  }

  /**
   * Subscribes to a Bitunix stream and stores it for reconnects.
   */
  public async subscribe(key: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
    // Step 1: Track the subscription for reconnects.
    this.subscriptions.set(key, { key, payload });
    // Step 2: Send immediately if ready.
    if (!this.isReady()) {
      return;
    }
    await this.send(payload);
  }

  /**
   * Unsubscribes from a Bitunix stream.
   */
  public async unsubscribe(key: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
    // Step 1: Remove subscription from registry.
    this.subscriptions.delete(key);
    // Step 2: Send unsubscribe request if ready.
    if (!this.isReady()) {
      return;
    }
    await this.send(payload);
  }

  /**
   * Opens the WebSocket connection and wires listeners.
   */
  private async openSocket(): Promise<void> {
    // Step 1: Guard against duplicate socket instances.
    if (this.ws !== null) {
      return;
    }

    // Step 2: Create WebSocket and bind lifecycle handlers.
    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      this.isConnectedFlag = true;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.lastHeartbeatMs = Date.now();
      this.emit("open");
      this.startPing();
      this.startHeartbeatMonitor();
    });

    this.ws.on("message", (data) => {
      this.handleMessage(data);
    });

    this.ws.on("pong", () => {
      this.lastHeartbeatMs = Date.now();
      this.clearPong();
    });

    this.ws.on("close", () => {
      this.onDisconnect();
    });

    this.ws.on("error", (error) => {
      this.emit("error", error);
    });

    // Step 3: Wait for the socket to open before returning.
    await this.waitForOpen();
  }

  /**
   * Waits for the WebSocket open event.
   */
  private async waitForOpen(): Promise<void> {
    // Step 1: Validate socket availability.
    if (this.ws === null) {
      throw new ExchangeError({
        code: "CONNECTION_ERROR",
        message: "WebSocket is not initialized"
      });
    }

    // Step 2: Exit early if already open.
    if (this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    // Step 3: Await open or error event.
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        this.ws?.off("open", onOpen);
        this.ws?.off("error", onError);
      };

      this.ws?.on("open", onOpen);
      this.ws?.on("error", onError);
    });
  }

  /**
   * Authenticates the WebSocket connection.
   */
  private async authenticate(): Promise<void> {
    // Step 1: Build signed auth payload for WebSocket authentication.
    // For WebSocket auth, we only need apiKey in the params
    // Note: Bitunix format is keyvalue without equals sign
    const auth = createAuthPayload({
      apiKey: this.apiKey,
      secretKey: this.secretKey,
      queryParams: `apiKey${this.apiKey}`,
      body: ""
    });

    // Step 2: Create auth message and send with ack.
    const payload = {
      id: randomUUID(),
      method: "auth",
      params: {
        apiKey: this.apiKey,
        timestamp: String(auth.timestamp),
        nonce: auth.nonce,
        sign: auth.sign
      }
    };

    // Step 3: Await acknowledgement and mark authenticated.
    await this.sendWithAck(payload);
    this.isAuthenticatedFlag = true;
  }

  /**
   * Replays all stored subscriptions on reconnect.
   */
  private async resubscribeAll(): Promise<void> {
    // Step 1: Skip resubscribe if not ready.
    if (!this.isReady()) {
      return;
    }
    // Step 2: Replay stored subscriptions.
    for (const sub of this.subscriptions.values()) {
      await this.send(sub.payload);
    }
  }

  /**
   * Sends a payload and waits for an acknowledgement.
   */
  private async sendWithAck(payload: Readonly<Record<string, unknown>>): Promise<void> {
    // Step 1: Ensure payload includes a request id.
    const id = payload.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new ExchangeError({
        code: "CONNECTION_ERROR",
        message: "WebSocket request id must be a non-empty string"
      });
    }

    // Step 2: Track request and await ack or timeout.
    await new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new ExchangeError({ code: "CONNECTION_ERROR", message: "WebSocket request timed out" }));
      }, 10_000);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeoutHandle
      });

      // Step 3: Send the payload and surface send errors.
      this.send(payload).catch((err) => {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Sends a payload through the WebSocket.
   */
  private async send(payload: Readonly<Record<string, unknown>>): Promise<void> {
    // Step 1: Ensure socket is open.
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      throw new ExchangeError({
        code: "CONNECTION_ERROR",
        message: "WebSocket is not open"
      });
    }

    // Step 2: Serialize and send payload.
    const message = JSON.stringify(payload);
    await new Promise<void>((resolve, reject) => {
      this.ws?.send(message, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Handles incoming WebSocket messages.
   */
  private handleMessage(data: WebSocket.RawData): void {
    // Step 1: Convert raw data into text and parse JSON.
    this.lastHeartbeatMs = Date.now();
    const raw = rawDataToString(data);
    const parsed = safeJsonParse(raw);
    if (parsed === null) {
      return;
    }

    // Step 2: Handle pending request acknowledgements.
    if (this.handleAck(parsed)) {
      return;
    }

    // Step 3: Extract kline events and emit.
    const kline = parseKlineEvent(parsed);
    if (kline !== null) {
      this.emit("kline", kline);
    }

    // Step 4: Emit raw message for generic listeners.
    this.emit("message", parsed);
  }

  /**
   * Resolves pending requests when ack messages arrive.
   */
  private handleAck(payload: unknown): boolean {
    // Step 1: Ensure payload structure supports acknowledgements.
    if (!isRecord(payload)) {
      return false;
    }

    const id = payload.id;
    if (typeof id !== "string") {
      return false;
    }

    // Step 2: Resolve pending request if present.
    const pending = this.pendingRequests.get(id);
    if (pending === undefined) {
      return false;
    }

    clearTimeout(pending.timeoutHandle);
    this.pendingRequests.delete(id);

    // Step 3: Detect Bitunix error fields.
    const code = payload.code;
    const success = payload.success;
    if (typeof code === "number" && code !== 0) {
      pending.reject(new ExchangeError({ code: "CONNECTION_ERROR", message: `WebSocket error code: ${code}` }));
      return true;
    }
    if (typeof success === "boolean" && !success) {
      pending.reject(new ExchangeError({ code: "CONNECTION_ERROR", message: "WebSocket request rejected" }));
      return true;
    }

    // Step 4: Resolve pending request on success.
    pending.resolve();
    return true;
  }

  /**
   * Starts periodic ping/pong health checks.
   */
  private startPing(): void {
    // Step 1: Clear existing timers.
    this.clearPing();
    this.clearPong();

    // Step 2: Schedule periodic ping with pong timeout.
    this.pingHandle = setInterval(() => {
      if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        this.ws.ping();
        this.startPongTimeout();
      } catch (err) {
        this.emit("error", err);
      }
    }, this.pingIntervalMs);
  }

  /**
   * Starts a timeout waiting for the next pong.
   */
  private startPongTimeout(): void {
    // Step 1: Replace any existing pong timeout.
    this.clearPong();
    this.pongHandle = setTimeout(() => {
      if (this.ws !== null) {
        this.ws.terminate();
      }
    }, this.pongTimeoutMs);
  }

  /**
   * Clears any active ping interval.
   */
  private clearPing(): void {
    // Step 1: Clear ping timer if present.
    if (this.pingHandle !== null) {
      clearInterval(this.pingHandle);
      this.pingHandle = null;
    }
  }

  /**
   * Clears any active pong timeout.
   */
  private clearPong(): void {
    // Step 1: Clear pong timer if present.
    if (this.pongHandle !== null) {
      clearTimeout(this.pongHandle);
      this.pongHandle = null;
    }
  }

  /**
   * Starts monitoring for inbound messages to detect dead connections.
   */
  private startHeartbeatMonitor(): void {
    // Step 1: Clear existing monitor before starting a new one.
    this.clearHeartbeatMonitor();
    // Step 2: Schedule heartbeat checks.
    this.heartbeatHandle = setInterval(() => {
      const elapsed = Date.now() - this.lastHeartbeatMs;
      if (elapsed <= this.heartbeatTimeoutMs) {
        return;
      }
      const error = new ExchangeError({
        code: "CONNECTION_ERROR",
        message: "WebSocket heartbeat timeout"
      });
      this.emit("error", error);
      void this.reconnect().catch((err) => {
        this.emit("error", err);
      });
    }, this.heartbeatIntervalMs);
  }

  /**
   * Clears the heartbeat monitor interval.
   */
  private clearHeartbeatMonitor(): void {
    // Step 1: Clear heartbeat timer if present.
    if (this.heartbeatHandle !== null) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
  }

  /**
   * Cancels and rejects all pending requests.
   */
  private clearPendingRequests(): void {
    // Step 1: Reject all outstanding requests.
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new ExchangeError({ code: "CONNECTION_ERROR", message: "WebSocket request cancelled" }));
    }
    // Step 2: Clear registry.
    this.pendingRequests.clear();
  }

  /**
   * Handles a socket close event and schedules reconnection if enabled.
   */
  private onDisconnect(): void {
    // Step 1: Reset connection state and timers.
    this.isConnectedFlag = false;
    this.isAuthenticatedFlag = false;
    this.clearPing();
    this.clearPong();
    this.clearHeartbeatMonitor();
    this.emit("close");
    this.clearPendingRequests();

    // Step 2: Trigger reconnect when allowed.
    if (this.shouldReconnect) {
      void this.reconnect().catch((err) => {
        this.emit("error", err);
      });
    }
  }

  /**
   * Attempts to reconnect using exponential backoff and max attempt limits.
   */
  private async reconnect(): Promise<void> {
    // Step 1: Skip when reconnects are disabled or already in progress.
    if (!this.shouldReconnect || this.isReconnecting) {
      return;
    }
    // Step 2: Enforce maximum reconnect attempts.
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.shouldReconnect = false;
      throw new ExchangeError({
        code: "CONNECTION_ERROR",
        message: "Max reconnect attempts reached"
      });
    }

    // Step 3: Compute exponential backoff delay.
    const delay = Math.min(
      this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts),
      this.reconnectMaxDelayMs
    );
    this.reconnectAttempts += 1;
    this.isReconnecting = true;
    await this.sleep(delay);

    // Step 4: Reconnect if still allowed.
    if (!this.shouldReconnect) {
      this.isReconnecting = false;
      return;
    }
    this.ws = null;
    try {
      await this.connect();
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Sleeps for a given number of milliseconds.
   */
  private async sleep(ms: number): Promise<void> {
    // Step 1: Await a timeout for the requested duration.
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Safely parses JSON text from the socket.
 */
function safeJsonParse(text: string): unknown {
  // Step 1: Attempt to parse JSON and return null on failure.
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Converts WebSocket raw data into a string.
 */
function rawDataToString(data: WebSocket.RawData): string {
  // Step 1: Normalize raw socket data into a UTF-8 string.
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf-8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf-8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer).toString("utf-8");
  }
  return "";
}

/**
 * Parses a Bitunix kline event from a raw payload.
 */
function parseKlineEvent(payload: unknown): KlineEvent | null {
  // Step 1: Validate payload structure.
  if (!isRecord(payload)) {
    return null;
  }

  const channel = payload.ch;
  const symbol = payload.symbol;
  const ts = payload.ts;
  const data = payload.data;

  // Step 2: Ensure required fields exist.
  if (typeof channel !== "string" || typeof symbol !== "string") {
    return null;
  }
  if (!Number.isFinite(ts)) {
    return null;
  }
  if (!isRecord(data)) {
    return null;
  }

  // Step 3: Return normalized event payload.
  return {
    channel,
    symbol,
    timestampMs: Number(ts),
    data,
    raw: payload
  };
}

/**
 * Type guard for record-like objects.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
