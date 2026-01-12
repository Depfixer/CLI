/**
 * API Client Service
 *
 * Handles all HTTP communication with the DepFixer API server.
 * Manages authentication, error handling, and request/response processing.
 *
 * API Endpoints:
 *   - Production: https://api.depfixer.com/api/v1
 *   - Can be overridden with DEPFIXER_API_URL env var
 *
 * Authentication:
 *   - JWT tokens for authenticated users
 *   - API keys for CI/CD (DEPFIXER_TOKEN env var)
 *   - Device ID for anonymous tracking
 *
 * @see https://docs.depfixer.com/api
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { AuthManager } from './auth-manager.js';
import { getDeviceId } from './device-id.js';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

/**
 * Default API URL - points to production server
 */
const DEFAULT_API_URL = 'https://api.depfixer.com/api/v1';

/**
 * Default web app URL - used for generating links
 */
const DEFAULT_WEB_URL = 'https://app.depfixer.com';

/**
 * Request timeout in milliseconds
 */
const REQUEST_TIMEOUT = 30000;

/**
 * Custom error class for network-related errors.
 * Used to distinguish between API errors and connectivity issues.
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

// ============================================================================
// API CLIENT CLASS
// ============================================================================

/**
 * API Client for communicating with DepFixer server.
 *
 * Provides methods for:
 * - Analysis (audit, full, migrate, CI)
 * - Authentication (device code flow)
 * - Payment (credits, execute fix)
 * - User info (balance, whoami)
 */
export class ApiClient {
  /** Axios instance with configured defaults */
  private client: AxiosInstance;

  /** Manages JWT tokens and API keys */
  private authManager: AuthManager;

  /** Web app URL for generating links */
  private webUrl: string;

  constructor() {
    // Allow URL override for development/testing
    const baseURL = process.env.DEPFIXER_API_URL || DEFAULT_API_URL;
    this.webUrl = process.env.DEPFIXER_WEB_URL || DEFAULT_WEB_URL;

    // Create axios instance with defaults
    this.client = axios.create({
      baseURL,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'depfixer-cli/1.0.0',
      },
    });

    this.authManager = new AuthManager();

    // Automatically attach auth token to requests
    this.client.interceptors.request.use(async (config) => {
      const token = await this.authManager.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Handle response errors uniformly
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => this.handleError(error)
    );
  }

  // ==========================================================================
  // ANALYSIS ENDPOINTS
  // ==========================================================================

  /**
   * Audit Analysis (FREE)
   *
   * Analyzes package.json for dependency conflicts without requiring authentication.
   * Returns issues but hides solutions (teaser mode).
   *
   * @param packageJson - Parsed package.json content
   * @param framework - Optional framework hint (angular, react, etc.)
   * @returns Analysis results with conflicts and health score
   */
  async analyzeAudit(packageJson: any, framework?: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    rateLimit?: { remaining: number; resetIn: number };
  }> {
    const deviceId = getDeviceId();
    try {
      const response = await this.client.post('/cli/analyze/audit', {
        packageJson,
        framework,
        deviceId,
      });
      return response.data;
    } catch (err: any) {
      throw err;
    }
  }

  /**
   * CI Analysis (Requires API Key)
   *
   * Full analysis for CI/CD pipelines. Requires DEPFIXER_TOKEN env var.
   * Returns complete results including solutions for automated workflows.
   *
   * @param packageJson - Parsed package.json content
   * @param framework - Optional framework hint
   * @returns Full analysis results for CI processing
   */
  async analyzeForCi(packageJson: any, framework?: string): Promise<{
    success: boolean;
    data?: {
      mode: 'ci';
      analysisId: string;
      healthScore: number;
      totalPackages: number;
      summary: { critical: number; high: number; medium: number; low: number };
      conflicts: any[];
      framework?: string;
      requiresAttention: boolean;
    };
    error?: string;
  }> {
    const authHeader = await this.authManager.getAuthHeader();
    if (!authHeader) {
      throw new Error('Authentication required for CI mode. Set DEPFIXER_TOKEN environment variable.');
    }

    try {
      const response = await this.client.post('/cli/analyze/ci', {
        packageJson,
        framework,
      }, {
        headers: { Authorization: authHeader },
      });
      return response.data;
    } catch (error: any) {
      if (this.isNetworkError(error)) {
        throw new NetworkError('Network error: Unable to connect to DepFixer server.');
      }
      throw error;
    }
  }

  /**
   * Full Analysis (Requires Auth + Credits)
   *
   * Complete analysis with solutions. Requires authentication and credits.
   *
   * @param packageJson - Parsed package.json content
   * @param framework - Optional framework hint
   * @returns Full analysis with solutions
   */
  async analyzeFull(packageJson: any, framework?: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    if (!await this.authManager.isAuthenticated()) {
      throw new Error('Authentication required. Run `npx depfixer login` first.');
    }
    const response = await this.client.post('/cli/analyze/full', {
      packageJson,
      framework,
    });
    return response.data;
  }

  /**
   * Migration Analysis (Requires Auth + Credits)
   *
   * Analyzes project for migration to a target framework version.
   * Shows what changes are needed and potential breaking changes.
   *
   * @param packageJson - Parsed package.json content
   * @param targetVersion - Target framework version to migrate to
   * @param framework - Optional framework hint
   * @returns Migration plan with required changes
   */
  async analyzeMigrate(packageJson: any, targetVersion: string, framework?: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    if (!await this.authManager.isAuthenticated()) {
      throw new Error('Authentication required. Run `npx depfixer login` first.');
    }
    const response = await this.client.post('/cli/analyze/migrate', {
      packageJson,
      targetVersion,
      framework,
    });
    return response.data;
  }

  // ==========================================================================
  // AUTHENTICATION ENDPOINTS
  // ==========================================================================

  /**
   * Create Device Code
   *
   * Initiates device code flow authentication (similar to GitHub CLI).
   * Returns a code for user to enter in browser.
   *
   * @returns Device code and verification URL
   */
  async createDeviceCode(): Promise<{
    success: boolean;
    data?: {
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
      expiresIn: number;
      pollInterval: number;
    };
    error?: string;
  }> {
    const response = await this.client.post('/cli/auth/device-code');
    return response.data;
  }

  /**
   * Poll Device Code Status
   *
   * Checks if user has completed browser authentication.
   * Should be called at pollInterval until approved/expired/denied.
   *
   * @param deviceCode - The device code from createDeviceCode
   * @returns Authentication status and tokens if approved
   */
  async pollDeviceCode(deviceCode: string): Promise<{
    success: boolean;
    data?: {
      status: 'pending' | 'approved' | 'expired' | 'denied';
      accessToken?: string;
      refreshToken?: string;
      expiresIn?: number;
      email?: string;
    };
    error?: string;
  }> {
    const response = await this.client.get(`/cli/auth/device-poll/${deviceCode}`);
    return response.data;
  }

  /**
   * Link Device to User
   *
   * Associates anonymous analyses from this device with the logged-in user.
   * Called automatically after successful login.
   *
   * @returns Number of analyses linked
   */
  async linkDeviceToUser(): Promise<{
    success: boolean;
    data?: { linkedCount: number };
    error?: string;
  }> {
    if (!await this.authManager.isAuthenticated()) {
      throw new Error('Authentication required.');
    }
    try {
      const deviceId = getDeviceId();
      const response = await this.client.post('/cli/link-device', { deviceId });
      return response.data;
    } catch (error: any) {
      if (this.isNetworkError(error)) {
        throw new NetworkError('Network error: Unable to connect to DepFixer server.');
      }
      // Don't throw on link-device errors - it's not critical
      return { success: false, error: error.message };
    }
  }

  // ==========================================================================
  // PREFETCH & ANALYSIS RETRIEVAL
  // ==========================================================================

  /**
   * Poll Prefetch Status
   *
   * When analysis requires fetching new package data, this endpoint
   * reports progress. Poll until isComplete=true && reanalysisStatus='completed'.
   *
   * @param prefetchId - Prefetch job ID from initial analysis
   * @returns Fetch progress and completion status
   */
  async pollPrefetchStatus(prefetchId: string): Promise<{
    status: string;
    fetchedCount: number;
    totalPackages: number;
    percentage: number;
    isComplete: boolean;
    reanalysisStatus?: string;
  }> {
    const response = await this.client.get(`/analyze/prefetch-status/${prefetchId}`);
    return response.data;
  }

  /**
   * Get Analysis by ID
   *
   * Retrieves analysis results after prefetch completes.
   * Used to get updated results with newly fetched package data.
   *
   * @param analysisId - Analysis ID from initial analysis
   * @returns Updated analysis results
   */
  async getAnalysisById(analysisId: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    const response = await this.client.get(`/analyze/analysis/${analysisId}`);
    return response.data;
  }

  // ==========================================================================
  // PAYMENT & CREDITS
  // ==========================================================================

  /**
   * Get User Balance
   *
   * Returns current credit balance and account info.
   *
   * @returns Credit balance and user details
   */
  async getBalance(): Promise<{
    success: boolean;
    data?: {
      credits: number;
      hasActivePass: boolean;
      name?: string;
      email?: string;
    };
    error?: string;
  }> {
    if (!await this.authManager.isAuthenticated()) {
      throw new Error('Authentication required. Run `npx depfixer login` first.');
    }
    try {
      const response = await this.client.get('/cli/balance');
      return response.data;
    } catch (error: any) {
      if (this.isNetworkError(error)) {
        throw new NetworkError('Network error: Unable to connect to DepFixer server.');
      }
      throw error;
    }
  }

  /**
   * Get Analysis Payment Status
   *
   * Checks if an analysis has been paid for.
   *
   * @param analysisId - Analysis ID to check
   * @returns Payment status and cost info
   */
  async getAnalysisStatus(analysisId: string): Promise<{
    success: boolean;
    data?: {
      status: 'UNPAID' | 'PAID';
      cost: number;
      tierName: string;
    };
    error?: string;
  }> {
    if (!await this.authManager.isAuthenticated()) {
      throw new Error('Authentication required. Run `npx depfixer login` first.');
    }
    try {
      const response = await this.client.get(`/cli/analysis/${analysisId}/status`);
      return response.data;
    } catch (error: any) {
      if (this.isNetworkError(error)) {
        throw new NetworkError('Network error: Unable to connect to DepFixer server.');
      }
      throw error;
    }
  }

  /**
   * Execute Fix (Deducts Credits)
   *
   * Pays for an analysis and returns the solution.
   * Deducts credits from user account.
   *
   * @param analysisId - Analysis ID to pay for
   * @returns Solution and payment confirmation
   */
  async executeFix(analysisId: string): Promise<{
    success: boolean;
    data?: {
      solution: {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        removals: Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }>;
        engines?: { node?: string; npm?: string };
      };
      conflicts?: any[];
      missingDependencies?: any[];
      deprecations?: any[];
      healthScore?: number;
      summary?: { critical: number; high: number; medium: number; low: number };
      creditsDeducted: number;
      creditsRemaining: number;
      passUsed?: boolean;
    };
    error?: string;
  }> {
    if (!await this.authManager.isAuthenticated()) {
      throw new Error('Authentication required. Run `npx depfixer login` first.');
    }
    try {
      const response = await this.client.post('/cli/execute-fix', { analysisId });
      return response.data;
    } catch (error: any) {
      if (this.isNetworkError(error)) {
        throw new NetworkError('Network error: Unable to connect to DepFixer server.');
      }
      throw error;
    }
  }

  /**
   * Get Solution (Already Paid)
   *
   * Retrieves solution for a previously paid analysis.
   * Used by fix command to apply cached solutions.
   *
   * @param analysisId - Analysis ID
   * @returns Solution to apply
   */
  async getSolution(analysisId: string): Promise<{
    success: boolean;
    data?: {
      solution: {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        removals: Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }>;
        engines?: { node?: string; npm?: string };
      };
    };
    error?: string;
  }> {
    if (!await this.authManager.isAuthenticated()) {
      throw new Error('Authentication required. Run `npx depfixer login` first.');
    }
    try {
      const response = await this.client.get(`/cli/analysis/${analysisId}/solution`);
      return response.data;
    } catch (error: any) {
      if (this.isNetworkError(error)) {
        throw new NetworkError('Network error: Unable to connect to DepFixer server. Please check your internet connection.');
      }
      throw error;
    }
  }

  // ==========================================================================
  // FRAMEWORK DETECTION
  // ==========================================================================

  /**
   * Detect Framework
   *
   * Analyzes package.json to detect the framework using server-side rules.
   * This provides more accurate detection than client-side logic.
   * Supported frameworks: Angular, React (web), Vue
   * Unsupported (returns null): React Native, Expo, Next.js, Svelte
   *
   * @param packageJson - Parsed package.json content
   * @returns Detected framework info and cost info
   */
  async detectFramework(packageJson: any): Promise<{
    success: boolean;
    data?: {
      name: string;
      version: string;
      majorVersion: number;
      confidence: 'high' | 'medium' | 'low';
      detectedFrom: string;
    } | null;
    packageCount?: number;
    creditInfo?: {
      requiredCredits: number;
      tierName: string;
    };
    error?: string;
  }> {
    try {
      const response = await this.client.post('/cli/detect-framework', {
        packageJson,
      });
      return response.data;
    } catch (error: any) {
      if (this.isNetworkError(error)) {
        throw new NetworkError('Network error: Unable to connect to DepFixer server.');
      }
      throw error;
    }
  }

  // ==========================================================================
  // FRAMEWORK VERSIONS
  // ==========================================================================

  /**
   * Get Framework Versions
   *
   * Returns available versions for a framework (used by migrate command).
   * Formatted for CLI version selector UI.
   *
   * @param framework - Framework name (angular, react)
   * @param currentVersion - Current major version (for filtering)
   * @returns Available versions grouped by type
   */
  async getFrameworkVersions(framework: string, currentVersion?: number): Promise<{
    success: boolean;
    data?: {
      framework: string;
      defaultValue: string;
      quickOptions: Array<{
        value: string;
        label: string;
        badge: string;
        isRecommended: boolean;
      }>;
      groups: Array<{
        label: string;
        options: Array<{
          value: string;
          label: string;
          badge: string;
        }>;
      }>;
    };
    error?: string;
  }> {
    try {
      let url = `/analyze/framework-versions/${framework}?format=selector`;
      if (currentVersion !== undefined) {
        url += `&currentVersion=${currentVersion}`;
      }
      const response = await this.client.get(url);
      return response.data;
    } catch (error: any) {
      if (this.isNetworkError(error)) {
        throw new NetworkError('Network error: Unable to connect to DepFixer server.');
      }
      throw error;
    }
  }

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  /**
   * Checks if an error is a network connectivity error.
   *
   * @param error - Error to check
   * @returns True if network error
   */
  private isNetworkError(error: any): boolean {
    if (!error) return false;
    const code = error.code;
    return code === 'ECONNREFUSED' ||
           code === 'ENOTFOUND' ||
           code === 'ETIMEDOUT' ||
           code === 'ENETUNREACH' ||
           code === 'ECONNRESET' ||
           code === 'ERR_NETWORK';
  }

  /**
   * Handles API errors and converts them to user-friendly messages.
   *
   * @param error - Axios error
   * @throws User-friendly error message
   */
  private handleError(error: AxiosError): never {
    if (error.response) {
      const data = error.response.data as any;
      const status = error.response.status;

      // Authentication expired
      if (status === 401) {
        throw new Error('Authentication expired. Run `npx depfixer login` to re-authenticate.');
      }

      // Forbidden (insufficient credits, rate limit)
      if (status === 403) {
        if (data?.error === 'INSUFFICIENT_CREDITS') {
          throw new Error(`Insufficient credits. Purchase more at ${this.webUrl}/dashboard/pricing`);
        }
        if (data?.error === 'RATE_LIMIT_EXCEEDED') {
          throw new Error(data?.message || 'Rate limit exceeded. Please try again later.');
        }
        throw new Error(data?.message || 'Access forbidden');
      }

      // Rate limited
      if (status === 429) {
        throw new Error('Too many requests. Please wait before trying again.');
      }

      // Other API errors
      throw new Error(data?.message || `API error: ${status}`);
    }

    // Connection refused
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to DepFixer server. Please check your internet connection.');
    }

    // Timeout
    if (error.code === 'ETIMEDOUT') {
      throw new Error('Request timed out. Please try again.');
    }

    throw new Error(error.message || 'Unknown error occurred');
  }
}
