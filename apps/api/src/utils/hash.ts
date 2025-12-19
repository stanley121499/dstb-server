import { createHash } from "node:crypto";

/**
 * Incremental SHA-256 helper for producing reproducibility fingerprints.
 */
export class Sha256 {
  private readonly hash = createHash("sha256");

  /**
   * Appends a string chunk to the hash.
   */
  public update(text: string): void {
    this.hash.update(text, "utf8");
  }

  /**
   * Returns the hex digest.
   */
  public digestHex(): string {
    return this.hash.digest("hex");
  }
}

