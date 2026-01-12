import * as os from 'os';
import * as crypto from 'crypto';
import { AuthManager } from './auth-manager.js';
import { CLI_VERSION } from '../version.js';

// Generate unique session ID once per CLI run
const SESSION_ID = crypto.randomUUID();

// API URL for tracking endpoint - defaults to production
const API_URL = process.env.DEPFIXER_API_URL || 'https://api.depfixer.com/api/v1';

// Event categories (matches CLI command names)
export type EventCategory = 'smart' | 'migrate' | 'fix' | 'auth';

interface EventData {
  event_type: string;
  event_category: EventCategory;
  metadata?: Record<string, any>;
}

interface ProjectContext {
  packageCount?: number;
  framework?: string;
  frameworkVersion?: string;
  projectHash?: string;
}

/**
 * CLI Analytics Service
 *
 * Tracks usage events for conversion funnel and analytics.
 * - Fire-and-forget pattern (never blocks CLI execution)
 * - Silent failures (never breaks user flow)
 * - Session-based tracking with optional user linking
 *
 * Usage:
 *   analytics.setProjectContext({ framework: 'angular', packageCount: 42 });
 *   analytics.track({ event_type: 'analyze_started', event_category: 'analyze' });
 */
class CliAnalytics {
  private projectContext: ProjectContext = {};
  private authManager: AuthManager;
  private isEnabled: boolean = true;

  constructor() {
    this.authManager = new AuthManager();

    // Disable in test environment
    if (process.env.NODE_ENV === 'test' || process.env.DEPFIXER_DISABLE_ANALYTICS === 'true') {
      this.isEnabled = false;
    }
  }

  /**
   * Get the current session ID.
   * Unique per CLI run.
   */
  getSessionId(): string {
    return SESSION_ID;
  }

  /**
   * Set project context for all subsequent events.
   * Call this after detecting framework and package count.
   */
  setProjectContext(ctx: ProjectContext): void {
    this.projectContext = { ...this.projectContext, ...ctx };
  }

  /**
   * Generate a privacy-safe hash of the project.
   * Uses first 16 chars of SHA256 hash of name + deps keys.
   */
  hashProject(packageJson: any): string {
    const deps = Object.keys(packageJson.dependencies || {}).sort().join(',');
    const devDeps = Object.keys(packageJson.devDependencies || {}).sort().join(',');
    const key = `${packageJson.name || ''}:${deps}:${devDeps}`;
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  /**
   * Track an event.
   * Fire-and-forget - never blocks and never throws.
   */
  async track(data: EventData): Promise<void> {
    if (!this.isEnabled || !API_URL) return;

    try {
      // Get auth token if available (optional)
      const token = await this.authManager.getAccessToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Build payload
      const payload = {
        event_type: data.event_type,
        event_category: data.event_category,
        session_id: SESSION_ID,
        cli_version: CLI_VERSION,
        node_version: process.version,
        os_platform: os.platform(),
        is_ci: this.detectCI(),
        project_hash: this.projectContext.projectHash,
        package_count: this.projectContext.packageCount,
        framework: this.projectContext.framework,
        framework_version: this.projectContext.frameworkVersion,
        metadata: data.metadata || {},
      };

      // Fire-and-forget fetch with short timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      fetch(`${API_URL}/cli/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
        .catch(() => {
          // Silent fail - never break CLI for analytics
        })
        .finally(() => {
          clearTimeout(timeout);
        });
    } catch {
      // Silent fail - never break CLI for analytics
    }
  }

  /**
   * Track event synchronously (waits for completion).
   * Use sparingly - only when you need to ensure event is sent
   * before process exits (e.g., session_ended).
   */
  async trackSync(data: EventData): Promise<void> {
    if (!this.isEnabled || !API_URL) return;

    try {
      const token = await this.authManager.getAccessToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const payload = {
        event_type: data.event_type,
        event_category: data.event_category,
        session_id: SESSION_ID,
        cli_version: CLI_VERSION,
        node_version: process.version,
        os_platform: os.platform(),
        is_ci: this.detectCI(),
        project_hash: this.projectContext.projectHash,
        package_count: this.projectContext.packageCount,
        framework: this.projectContext.framework,
        framework_version: this.projectContext.frameworkVersion,
        metadata: data.metadata || {},
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000); // 3 second timeout for sync

      await fetch(`${API_URL}/cli/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).finally(() => {
        clearTimeout(timeout);
      });
    } catch {
      // Silent fail
    }
  }

  /**
   * Convenience methods for common events.
   */

  // Smart command events (default command: npx depfixer)
  analyzeStarted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'analyze_started', event_category: 'smart', metadata });
  }

  projectDetected(metadata?: Record<string, any>): void {
    this.track({ event_type: 'project_detected', event_category: 'smart', metadata });
  }

  analysisCompleted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'analysis_completed', event_category: 'smart', metadata });
  }

  unlockPromptShown(metadata?: Record<string, any>): void {
    this.track({ event_type: 'unlock_prompt_shown', event_category: 'smart', metadata });
  }

  authRequired(metadata?: Record<string, any>): void {
    this.track({ event_type: 'auth_required', event_category: 'smart', metadata });
  }

  unlockAccepted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'unlock_accepted', event_category: 'smart', metadata });
  }

  unlockRejected(metadata?: Record<string, any>): void {
    this.track({ event_type: 'unlock_rejected', event_category: 'smart', metadata });
  }

  unlockFailed(metadata?: Record<string, any>): void {
    this.track({ event_type: 'unlock_failed', event_category: 'smart', metadata });
  }

  resultsShown(metadata?: Record<string, any>): void {
    this.track({ event_type: 'results_shown', event_category: 'smart', metadata });
  }

  fixPromptShown(metadata?: Record<string, any>): void {
    this.track({ event_type: 'fix_prompt_shown', event_category: 'smart', metadata });
  }

  fixAccepted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'fix_accepted', event_category: 'smart', metadata });
  }

  fixDeferred(metadata?: Record<string, any>): void {
    this.track({ event_type: 'fix_deferred', event_category: 'smart', metadata });
  }

  fixApplied(metadata?: Record<string, any>): void {
    this.track({ event_type: 'fix_applied', event_category: 'smart', metadata });
  }

  // Migrate command events
  migrateStarted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'migrate_started', event_category: 'migrate', metadata });
  }

  versionsLoaded(metadata?: Record<string, any>): void {
    this.track({ event_type: 'versions_loaded', event_category: 'migrate', metadata });
  }

  versionSelected(metadata?: Record<string, any>): void {
    this.track({ event_type: 'version_selected', event_category: 'migrate', metadata });
  }

  migrationPromptShown(metadata?: Record<string, any>): void {
    this.track({ event_type: 'migration_prompt_shown', event_category: 'migrate', metadata });
  }

  migrationAccepted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'migration_accepted', event_category: 'migrate', metadata });
  }

  migrationRejected(metadata?: Record<string, any>): void {
    this.track({ event_type: 'migration_rejected', event_category: 'migrate', metadata });
  }

  migrationPlanReady(metadata?: Record<string, any>): void {
    this.track({ event_type: 'migration_plan_ready', event_category: 'migrate', metadata });
  }

  migrationApplyPrompt(metadata?: Record<string, any>): void {
    this.track({ event_type: 'migration_apply_prompt', event_category: 'migrate', metadata });
  }

  migrationApplied(metadata?: Record<string, any>): void {
    this.track({ event_type: 'migration_applied', event_category: 'migrate', metadata });
  }

  migrationDeferred(metadata?: Record<string, any>): void {
    this.track({ event_type: 'migration_deferred', event_category: 'migrate', metadata });
  }

  // Fix command events
  fixStarted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'fix_started', event_category: 'fix', metadata });
  }

  fixCacheFound(metadata?: Record<string, any>): void {
    this.track({ event_type: 'fix_cache_found', event_category: 'fix', metadata });
  }

  fixCacheMissing(metadata?: Record<string, any>): void {
    this.track({ event_type: 'fix_cache_missing', event_category: 'fix', metadata });
  }

  // Auth command events
  loginStarted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'login_started', event_category: 'auth', metadata });
  }

  deviceCodeShown(metadata?: Record<string, any>): void {
    this.track({ event_type: 'device_code_shown', event_category: 'auth', metadata });
  }

  loginSuccess(metadata?: Record<string, any>): void {
    this.track({ event_type: 'login_success', event_category: 'auth', metadata });
  }

  loginFailed(metadata?: Record<string, any>): void {
    this.track({ event_type: 'login_failed', event_category: 'auth', metadata });
  }

  loginCancelled(metadata?: Record<string, any>): void {
    this.track({ event_type: 'login_cancelled', event_category: 'auth', metadata });
  }

  authAbandoned(metadata?: Record<string, any>): void {
    this.track({ event_type: 'auth_abandoned', event_category: 'auth', metadata });
  }

  logoutExecuted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'logout_executed', event_category: 'auth', metadata });
  }

  whoamiExecuted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'whoami_executed', event_category: 'auth', metadata });
  }

  // Payment/Top-up events (REAL CONVERSION)
  topupPromptShown(metadata?: Record<string, any>): void {
    this.track({ event_type: 'topup_prompt_shown', event_category: 'smart', metadata });
  }

  topupStarted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'topup_started', event_category: 'smart', metadata });
  }

  topupAbandoned(metadata?: Record<string, any>): void {
    this.track({ event_type: 'topup_abandoned', event_category: 'smart', metadata });
  }

  topupCompleted(metadata?: Record<string, any>): void {
    this.track({ event_type: 'topup_completed', event_category: 'smart', metadata });
  }

  topupTimeout(metadata?: Record<string, any>): void {
    this.track({ event_type: 'topup_timeout', event_category: 'smart', metadata });
  }

  // Session events
  async sessionEnded(metadata?: Record<string, any>): Promise<void> {
    // Use sync tracking for session end to ensure it's sent before exit
    await this.trackSync({ event_type: 'session_ended', event_category: 'smart', metadata });
  }

  /**
   * Detect if running in a CI environment.
   */
  private detectCI(): boolean {
    return (
      process.env.CI === 'true' ||
      !!process.env.GITHUB_ACTIONS ||
      !!process.env.GITLAB_CI ||
      !!process.env.CIRCLECI ||
      !!process.env.TRAVIS ||
      !!process.env.JENKINS_URL ||
      !!process.env.BITBUCKET_BUILD_NUMBER
    );
  }
}

// Export singleton instance
export const analytics = new CliAnalytics();
