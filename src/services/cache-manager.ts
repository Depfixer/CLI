import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { calculateHash } from '../utils/hash.js';

interface AnalysisEntry {
  analysisId: string;
  projectName: string;
  packageJsonHash: string;
  timestamp: number;
  mode: 'full' | 'migrate';
  targetVersion?: string; // For migrate mode
  projectPath?: string; // Store original project path for reference
}

interface AnalysisHistory {
  entries: AnalysisEntry[];
}

/**
 * Cache Manager
 * Handles local caching of analysis history for the fix command
 *
 * Cache is stored in ~/.depfixer/projects/{projectHash}/analysis-history.json
 * Stores history of all analyses - solution is fetched from server when fixing
 * Centralized storage (no .depfixer in project directory)
 */
export class CacheManager {
  private cacheDir: string;
  private cacheFile: string;
  private maxEntries = 20; // Keep last 20 analyses
  private projectDir: string;

  constructor(projectDir: string = process.cwd()) {
    this.projectDir = projectDir;
    // Use centralized ~/.depfixer/projects/{hash}/ directory
    const projectHash = this.getProjectHash(projectDir);
    this.cacheDir = path.join(os.homedir(), '.depfixer', 'projects', projectHash);
    this.cacheFile = path.join(this.cacheDir, 'analysis-history.json');
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
   * Add analysis to history
   * Stores analysisId, projectName, and hash - no solution content
   */
  async saveAnalysis(
    packageJsonContent: string,
    analysisId: string,
    projectName: string,
    mode: 'full' | 'migrate',
    targetVersion?: string
  ): Promise<void> {
    const history = await this.loadHistory();

    const entry: AnalysisEntry = {
      analysisId,
      projectName,
      packageJsonHash: calculateHash(packageJsonContent),
      timestamp: Date.now(),
      mode,
      targetVersion,
      projectPath: this.projectDir, // Store project path for reference
    };

    // Add to beginning (most recent first)
    history.entries.unshift(entry);

    // Keep only last N entries
    if (history.entries.length > this.maxEntries) {
      history.entries = history.entries.slice(0, this.maxEntries);
    }

    // Ensure directory exists
    await fs.mkdir(this.cacheDir, { recursive: true });

    // Write cache file
    await fs.writeFile(
      this.cacheFile,
      JSON.stringify(history, null, 2),
      'utf-8'
    );
  }

  /**
   * Load analysis history
   */
  async loadHistory(): Promise<AnalysisHistory> {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      return JSON.parse(data) as AnalysisHistory;
    } catch (error) {
      return { entries: [] };
    }
  }

  /**
   * Get the latest analysis entry
   * Returns null if no history exists
   */
  async getLatestAnalysis(): Promise<AnalysisEntry | null> {
    const history = await this.loadHistory();
    return history.entries.length > 0 ? history.entries[0] : null;
  }

  /**
   * Get analysis by ID
   * Returns null if not found
   */
  async getAnalysisById(analysisId: string): Promise<AnalysisEntry | null> {
    const history = await this.loadHistory();
    return history.entries.find(e => e.analysisId === analysisId) || null;
  }

  /**
   * Get all analyses (for listing)
   */
  async getAllAnalyses(): Promise<AnalysisEntry[]> {
    const history = await this.loadHistory();
    return history.entries;
  }

  /**
   * Verify that package.json hasn't changed since analysis
   */
  async verifyHash(packageJsonContent: string, analysisId?: string): Promise<boolean> {
    const entry = analysisId
      ? await this.getAnalysisById(analysisId)
      : await this.getLatestAnalysis();

    if (!entry) return false;

    const currentHash = calculateHash(packageJsonContent);
    return currentHash === entry.packageJsonHash;
  }

  /**
   * Get cache file path (for display purposes)
   */
  getCacheFilePath(): string {
    return this.cacheFile;
  }

  /**
   * Check if any analysis history exists
   */
  async hasHistory(): Promise<boolean> {
    const history = await this.loadHistory();
    return history.entries.length > 0;
  }

  /**
   * Clear all history
   */
  async clearHistory(): Promise<void> {
    try {
      await fs.unlink(this.cacheFile);
    } catch {
      // File might not exist
    }
  }
}
