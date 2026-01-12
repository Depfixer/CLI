import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

/**
 * Session data structure for CLI analysis caching
 */
export interface SessionData {
  analysisId: string;
  timestamp: number;
  intent: 'AUDIT' | 'ANALYZE' | 'MIGRATE';
  args?: { target?: string };
  originalFileHash: string;
  cost: number;
  status: 'UNPAID' | 'PAID';
  projectName: string;
  packageCount: number;
  tierName: string;
  projectPath?: string; // Store original project path for reference
}

export interface SessionFile {
  lastSession: SessionData;
}

/**
 * Session Manager
 * Manages CLI session state for the new payment flow.
 *
 * Key features:
 * - Stores session in ~/.depfixer/projects/{projectHash}/session.json
 * - Tracks analysis ID, cost, payment status
 * - Verifies package.json hash for integrity
 * - Supports resume of unpaid analyses
 * - Centralized storage (no .depfixer in project directory)
 */
export class SessionManager {
  private readonly cacheDir: string;
  private readonly sessionFile: string;
  private readonly projectDir: string;

  constructor(projectDir: string = process.cwd()) {
    this.projectDir = projectDir;
    // Use centralized ~/.depfixer/projects/{hash}/ directory
    const projectHash = this.getProjectHash(projectDir);
    this.cacheDir = path.join(os.homedir(), '.depfixer', 'projects', projectHash);
    this.sessionFile = path.join(this.cacheDir, 'session.json');
  }

  /**
   * Generate a short hash from project path for unique folder name
   */
  private getProjectHash(projectDir: string): string {
    // Normalize path and create hash
    const normalizedPath = path.resolve(projectDir).toLowerCase();
    return crypto.createHash('sha256').update(normalizedPath).digest('hex').substring(0, 12);
  }

  /**
   * Calculate SHA256 hash of content
   */
  calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Save a new session after analysis
   */
  async saveSession(data: Omit<SessionData, 'timestamp' | 'projectPath'>): Promise<void> {
    await this.ensureCacheDir();

    const session: SessionFile = {
      lastSession: {
        ...data,
        timestamp: Date.now(),
        projectPath: this.projectDir, // Store project path for reference
      },
    };

    await fs.writeFile(this.sessionFile, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Load the current session
   */
  async loadSession(): Promise<SessionData | null> {
    try {
      const content = await fs.readFile(this.sessionFile, 'utf-8');
      const session: SessionFile = JSON.parse(content);
      return session.lastSession || null;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if a session exists
   */
  async hasSession(): Promise<boolean> {
    try {
      await fs.access(this.sessionFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update session status (e.g., mark as PAID)
   */
  async updateStatus(status: 'UNPAID' | 'PAID'): Promise<void> {
    const session = await this.loadSession();
    if (!session) {
      throw new Error('No session to update');
    }

    session.status = status;

    const sessionFile: SessionFile = { lastSession: session };
    await fs.writeFile(this.sessionFile, JSON.stringify(sessionFile, null, 2), 'utf-8');
  }

  /**
   * Verify that package.json hasn't changed since analysis
   */
  async verifyHash(currentContent: string): Promise<boolean> {
    const session = await this.loadSession();
    if (!session) {
      return false;
    }

    const currentHash = this.calculateHash(currentContent);
    return currentHash === session.originalFileHash;
  }

  /**
   * Get human-readable time since analysis
   */
  getTimeSinceAnalysis(session: SessionData): string {
    const diffMs = Date.now() - session.timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffMins > 0) {
      return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    } else {
      return 'just now';
    }
  }

  /**
   * Get session description for display
   */
  getSessionDescription(session: SessionData): string {
    const timeAgo = this.getTimeSinceAnalysis(session);

    switch (session.intent) {
      case 'MIGRATE':
        return `${timeAgo} (MIGRATE → ${session.args?.target || 'unknown'})`;
      case 'AUDIT':
        return `${timeAgo} (AUDIT)`;
      case 'ANALYZE':
        return `${timeAgo} (ANALYZE)`;
      default:
        return timeAgo;
    }
  }

  /**
   * Clear the session (after successful fix or on user request)
   */
  async clearSession(): Promise<void> {
    try {
      await fs.unlink(this.sessionFile);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Get the session file path
   */
  getSessionFilePath(): string {
    return this.sessionFile;
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
}
