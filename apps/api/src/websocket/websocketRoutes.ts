import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocketConnectionManager } from "./connectionManager.js";

/**
 * Registers WebSocket routes for real-time backtest updates.
 *
 * Route: GET /ws/backtests/:runId
 *
 * Clients connect to this endpoint to receive real-time progress updates
 * for a specific backtest run. Updates are pushed as JSON messages.
 *
 * @param server - The Fastify server instance
 * @param wsManager - The WebSocket connection manager
 */
export async function registerWebSocketRoutes(server: FastifyInstance, wsManager: WebSocketConnectionManager): Promise<void> {
  /**
   * WebSocket endpoint for a specific backtest run.
   *
   * Clients receive progress updates in real-time as the backtest executes.
   * Connection is automatically cleaned up when the client disconnects.
   */
  server.get("/ws/backtests/:runId", { websocket: true }, (socket, req: FastifyRequest<{ Params: { runId: string } }>) => {
    const runId = req.params.runId;

    if (!runId || typeof runId !== "string" || runId.trim().length === 0) {
      socket.close(1008, "Invalid runId parameter");
      return;
    }

    // Register this connection to receive updates for the specified run.
    wsManager.addConnection(runId, socket);

    server.log.info(`WebSocket client connected for run: ${runId}`);

    // Send an initial connection acknowledgment.
    try {
      socket.send(
        JSON.stringify({
          type: "connected",
          runId,
          message: "Connected to backtest progress stream"
        })
      );
    } catch (err: unknown) {
      server.log.error({ err, runId }, "Failed to send connection acknowledgment");
    }

    // Handle incoming messages from the client (if needed in the future).
    socket.on("message", (message: Buffer | string) => {
      server.log.debug({ runId, message: message.toString() }, "Received WebSocket message from client");
      // Currently, we only push data to clients; no client -> server messages are expected.
    });

    // Handle disconnection.
    socket.on("close", () => {
      wsManager.removeConnection(runId, socket);
      server.log.info(`WebSocket client disconnected for run: ${runId}`);
    });

    socket.on("error", (err: Error) => {
      wsManager.removeConnection(runId, socket);
      server.log.error({ err, runId }, "WebSocket error");
    });
  });
}



