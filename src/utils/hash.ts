import * as crypto from 'crypto';

/**
 * Calculate SHA256 hash of content
 * Used for verifying package.json hasn't changed since last analysis
 */
export function calculateHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
