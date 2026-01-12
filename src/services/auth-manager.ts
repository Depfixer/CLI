import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
}

/**
 * Auth Manager
 * Handles storing and retrieving authentication tokens
 * Tokens are stored in ~/.depfixer/credentials.json
 */
export class AuthManager {
  private credentialsPath: string;

  constructor() {
    const depfixerDir = path.join(os.homedir(), '.depfixer');
    this.credentialsPath = path.join(depfixerDir, 'credentials.json');
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getAccessToken();
    return !!token;
  }

  /**
   * Get access token (returns null if not authenticated or expired)
   */
  async getAccessToken(): Promise<string | null> {
    try {
      const credentials = await this.readCredentials();
      if (!credentials) return null;

      // Check if token is expired (with 5 minute buffer)
      const bufferMs = 5 * 60 * 1000;
      if (Date.now() > credentials.expiresAt - bufferMs) {
        // Token expired - user needs to re-login
        return null;
      }

      return credentials.accessToken;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save authentication tokens
   */
  async saveTokens(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
    const credentials: Credentials = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    // Ensure directory exists
    const dir = path.dirname(this.credentialsPath);
    await fs.mkdir(dir, { recursive: true });

    // Write credentials file with restricted permissions
    await fs.writeFile(
      this.credentialsPath,
      JSON.stringify(credentials, null, 2),
      { mode: 0o600 } // Owner read/write only
    );
  }

  /**
   * Clear stored credentials (logout)
   */
  async clearCredentials(): Promise<void> {
    try {
      await fs.unlink(this.credentialsPath);
    } catch (error) {
      // File might not exist, that's fine
    }
  }

  /**
   * Get API key from environment (for CI mode)
   * Checks DEPFIXER_TOKEN environment variable
   */
  getApiKey(): string | null {
    return process.env.DEPFIXER_TOKEN || null;
  }

  /**
   * Get auth header - prefers API key (CI), falls back to JWT (interactive)
   * Returns null if neither is available
   */
  async getAuthHeader(): Promise<string | null> {
    // 1. Check for API key in env (CI mode)
    const apiKey = this.getApiKey();
    if (apiKey) {
      return `Bearer ${apiKey}`;
    }

    // 2. Fall back to JWT token (interactive mode)
    const token = await this.getAccessToken();
    if (token) {
      return `Bearer ${token}`;
    }

    return null;
  }

  /**
   * Check if running in CI mode (has DEPFIXER_TOKEN env var)
   */
  isApiKeyMode(): boolean {
    return !!process.env.DEPFIXER_TOKEN;
  }

  /**
   * Read credentials from file
   */
  private async readCredentials(): Promise<Credentials | null> {
    try {
      const data = await fs.readFile(this.credentialsPath, 'utf-8');
      return JSON.parse(data) as Credentials;
    } catch (error) {
      return null;
    }
  }
}
