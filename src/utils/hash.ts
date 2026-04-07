import { createHash, type Hash } from "crypto";

/**
 * Thin wrapper around Node's built-in SHA-256 hasher.
 *
 * Usage:
 *   const h = new Sha256();
 *   h.update("some data");
 *   h.update("more data");
 *   console.log(h.digestHex()); // hex string
 */
export class Sha256 {
  private readonly _hash: Hash;

  constructor() {
    this._hash = createHash("sha256");
  }

  /** Append a UTF-8 string to the running digest. */
  update(data: string): this {
    this._hash.update(data, "utf8");
    return this;
  }

  /** Finalise and return the hex-encoded SHA-256 digest. */
  digestHex(): string {
    return this._hash.digest("hex");
  }
}
