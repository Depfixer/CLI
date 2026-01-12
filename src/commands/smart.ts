/**
 * Smart Command
 *
 * The main analysis and fix command for DepFixer CLI.
 * Handles both interactive (default) and CI modes.
 *
 * Flow:
 * 1. Run audit analysis (FREE)
 * 2. Show issues with cost
 * 3. Prompt to pay and fix
 * 4. If YES: auth → balance check → pay → apply fix
 * 5. If NO: Save to session, user can run `fix` later
 */
import chalk from 'chalk';
import { CLI_AUDIT_SAMPLE_SIZE, CLI_AUDIT_THRESHOLD, FIX_STEPS } from '../constants/analysis.constants.js';
import { ApiClient } from '../services/api-client.js';
import { PackageJsonService } from '../services/package-json.js';
import { SessionManager } from '../services/session-manager.js';
import { PaymentFlowService } from '../services/payment-flow.js';
import { AuthManager } from '../services/auth-manager.js';
import { analytics } from '../services/analytics.js';
import { getDeviceId } from '../services/device-id.js';
import {
  createSpinner,
  createMigrationTable,
  printError,
  printSuccess,
  printInfo,
  runStepSequence,
  sleep,
} from '../utils/output.js';
import {
  colors,
  printCliHeader,
  renderHealthBar,
  getHealthStatus,
  printCostBox,
  printSuccessBox,
  printProjectHeader,
  printDiagnosis,
  printUserDetails,
  printCreditCheck,
} from '../utils/design-system.js';
import { promptYesNo } from '../utils/prompt.js';
import { calculateSummary } from '../utils/framework-utils.js';
import { createTeaserTable, createFullSolutionTable } from '../utils/table-builders.js';

interface SmartOptions {
  json?: boolean;
  ci?: boolean;
  path?: string;
}

interface AnalysisContext {
  projectDir: string;
  options: SmartOptions;
  packageJsonService: PackageJsonService;
  apiClient: ApiClient;
  sessionManager: SessionManager;
  packageJsonContent: string;
  parsed: any;
  sanitized: any;
  framework: string | undefined;
  frameworkInfo: string;
  packageJsonHash: string;
  // From detect-framework API
  creditInfo?: {
    packageCount: number;
    requiredCredits: number;
    tierName: string;
  };
}

interface AuditResult {
  response: any;
  data: any;
  analysisId: string;
  prefetchId: string;
  hasPendingPackages: boolean;
  cost: number;
  tierName: string;
  packageCount: number;
  issueCount: number;
}

// ============================================================================
// MAIN COMMAND
// ============================================================================

/**
 * Smart command (DEFAULT)
 *
 * The main funnel:
 * 1. Run audit analysis (FREE)
 * 2. Show issues with cost
 * 3. Prompt to pay and fix
 * 4. If YES: auth → balance check → pay → apply fix
 * 5. If NO: Save to session, user can run `fix` later
 *
 * Usage:
 *   npx depfixer
 */
export async function smartCommand(options: SmartOptions): Promise<void> {
  const projectDir = options.path || process.cwd();

  // Create device ID early (for anonymous user tracking before login)
  getDeviceId();

  try {
    // Initialize context
    const ctx = await initializeContext(projectDir, options);

    // Handle CI mode separately (non-interactive)
    if (options.ci) {
      await handleCiMode(ctx);
      return;
    }

    // Print CLI header (skip for JSON output)
    if (!options.json) {
      printCliHeader();
    }

    // Track: analyze_started
    analytics.analyzeStarted({ command: 'smart' });

    // Print project info (skip for JSON output)
    if (!options.json) {
      printProjectHeader(ctx.sanitized.name || 'unnamed', ctx.frameworkInfo);
    }

    // Run audit analysis
    const auditResult = await runAuditAnalysis(ctx);

    // JSON output mode - just output and return
    if (options.json) {
      outputJsonResult(auditResult);
      return;
    }

    // Check if there are issues to fix
    if (auditResult.issueCount === 0) {
      await showNoIssuesResult(ctx, auditResult);
      return;
    }

    // Show audit results (teaser mode)
    await displayAuditResults(auditResult);

    // Save session for potential later fix
    await saveSession(ctx, auditResult);

    // Handle payment flow
    const paymentResult = await handlePaymentFlow(ctx, auditResult);
    if (!paymentResult.success) {
      return;
    }

    // Poll for prefetch completion if needed
    const finalData = await pollPrefetchIfNeeded(ctx, auditResult, paymentResult);

    // Show full analysis with solutions
    await displayFullAnalysis(finalData, paymentResult.solution);

    // Ask to apply fix and handle result
    await handleFixApplication(ctx, finalData, paymentResult.solution);

  } catch (error: any) {
    await handleError(error, options);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize context with all required services and data
 */
async function initializeContext(projectDir: string, options: SmartOptions): Promise<AnalysisContext> {
  const packageJsonService = new PackageJsonService();
  const apiClient = new ApiClient();
  const sessionManager = new SessionManager(projectDir);

  // Read and sanitize package.json
  const { content: packageJsonContent, parsed } = await packageJsonService.read(projectDir);
  const sanitized = packageJsonService.sanitize(parsed);

  // Calculate package.json hash for integrity check
  const packageJsonHash = sessionManager.calculateHash(packageJsonContent);

  // Detect framework using server API (more accurate than local detection)
  let framework: string | undefined;
  let frameworkInfo = '';
  let creditInfo: { packageCount: number; requiredCredits: number; tierName: string } | undefined;

  try {
    const detectResponse = await apiClient.detectFramework(sanitized);
    if (detectResponse.success && detectResponse.data) {
      // Use detected framework name (lowercase for consistency)
      framework = detectResponse.data.name;
      frameworkInfo = framework ? `${framework.charAt(0).toUpperCase() + framework.slice(1)}` : '';
    }
    // Credit info is at the top level of the response
    if (detectResponse.packageCount !== undefined && detectResponse.creditInfo) {
      creditInfo = {
        packageCount: detectResponse.packageCount,
        requiredCredits: detectResponse.creditInfo.requiredCredits,
        tierName: detectResponse.creditInfo.tierName,
      };
    }
  } catch {
    // If API fails, continue without framework detection
    // The analysis will still work, just without framework-specific info
  }

  return {
    projectDir,
    options,
    packageJsonService,
    apiClient,
    sessionManager,
    packageJsonContent,
    parsed,
    sanitized,
    framework,
    frameworkInfo,
    packageJsonHash,
    creditInfo,
  };
}

// ============================================================================
// CI MODE
// ============================================================================

/**
 * Handle CI mode analysis (non-interactive, for pipelines)
 */
async function handleCiMode(ctx: AnalysisContext): Promise<void> {
  const { options, apiClient, sanitized, framework } = ctx;
  const authManager = new AuthManager();
  const authHeader = await authManager.getAuthHeader();

  if (!authHeader) {
    outputCiAuthError(options);
    process.exit(2);
  }

  try {
    const ciResponse = await apiClient.analyzeForCi(sanitized, framework);

    if (!ciResponse.success || !ciResponse.data) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: ciResponse.error || 'CI analysis failed' }, null, 2));
      } else {
        console.log(chalk.red(`  ${ciResponse.error || 'CI analysis failed'}`));
      }
      process.exit(2);
    }

    const ciData = ciResponse.data;
    const issueCount = ciData.summary.critical + ciData.summary.high + ciData.summary.medium + ciData.summary.low;

    if (options.json) {
      outputCiJsonResult(ciData, issueCount);
    } else {
      outputCiHumanResult(ciData, issueCount);
    }
  } catch (ciError: any) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: ciError.message }, null, 2));
    } else {
      console.log(chalk.red(`  CI analysis failed: ${ciError.message}`));
    }
    process.exit(2);
  }
}

/**
 * Output CI authentication error
 */
function outputCiAuthError(options: SmartOptions): void {
  if (options.json) {
    console.log(JSON.stringify({
      success: false,
      error: 'Authentication required for CI mode',
      help: 'Set DEPFIXER_TOKEN environment variable',
      docs: 'https://depfixer.com/docs/ci-setup',
    }, null, 2));
  } else {
    console.log();
    console.log(chalk.red('  Authentication required for CI mode'));
    console.log();
    console.log(chalk.bold('  Setup:'));
    console.log('    1. Get API token: https://app.depfixer.com/dashboard/api-keys');
    console.log('    2. Add to GitHub Secrets as DEPFIXER_TOKEN');
    console.log('    3. Use in workflow:');
    console.log();
    console.log(chalk.dim('       - run: npx depfixer --ci'));
    console.log(chalk.dim('         env:'));
    console.log(chalk.dim('           DEPFIXER_TOKEN: ${{ secrets.DEPFIXER_TOKEN }}'));
    console.log();
  }
}

/**
 * Output CI result as JSON
 */
function outputCiJsonResult(ciData: any, issueCount: number): void {
  console.log(JSON.stringify({
    success: true,
    mode: 'ci',
    analysisId: ciData.analysisId,
    healthScore: ciData.healthScore,
    totalPackages: ciData.totalPackages,
    summary: ciData.summary,
    issueCount,
    conflicts: ciData.conflicts,
    framework: ciData.framework,
    requiresAttention: ciData.requiresAttention,
  }, null, 2));
  process.exit(ciData.requiresAttention ? 1 : 0);
}

/**
 * Output CI result for human reading
 */
function outputCiHumanResult(ciData: any, issueCount: number): void {
  console.log();
  console.log(chalk.bold('  CI Mode - Dependency Analysis'));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  console.log(`  Health Score: ${ciData.healthScore}/100`);
  console.log(`  Total Packages: ${ciData.totalPackages}`);
  console.log(`  Issues Found: ${issueCount}`);
  if (ciData.summary.critical > 0) console.log(chalk.red(`    Critical: ${ciData.summary.critical}`));
  if (ciData.summary.high > 0) console.log(chalk.yellow(`    High: ${ciData.summary.high}`));
  if (ciData.summary.medium > 0) console.log(chalk.blue(`    Medium: ${ciData.summary.medium}`));
  if (ciData.summary.low > 0) console.log(chalk.dim(`    Low: ${ciData.summary.low}`));
  console.log();

  if (ciData.requiresAttention) {
    console.log(chalk.red('  Pipeline should fail - critical/high issues detected'));
    process.exit(1);
  } else if (issueCount > 0) {
    console.log(chalk.yellow('  Minor issues detected (medium/low severity)'));
    process.exit(0);
  } else {
    console.log(chalk.green('  No dependency issues found'));
    process.exit(0);
  }
}

// ============================================================================
// AUDIT ANALYSIS
// ============================================================================

/**
 * Run audit analysis with step sequence animation
 */
async function runAuditAnalysis(ctx: AnalysisContext): Promise<AuditResult> {
  const { options, apiClient, sanitized, framework, frameworkInfo } = ctx;

  const analysisSteps = [
    'Parsing dependency tree...',
    `Detecting framework...${frameworkInfo ? ` ${frameworkInfo}` : ''}`,
    'Loading compatibility matrix...',
    'Scanning package versions...',
    'Resolving peer dependencies...',
    'Checking version constraints...',
    'Analyzing transitive dependencies...',
    'Detecting breaking changes...',
    'Evaluating deprecation status...',
    'Calculating version intersections...',
    'Checking cross-package rules...',
    'Generating recommendations...',
  ];

  let response: any;

  if (options.json) {
    // Silent mode for JSON output
    response = await apiClient.analyzeAudit(sanitized, framework);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Unknown error');
    }
  } else {
    await runStepSequence(
      analysisSteps,
      async () => {
        response = await apiClient.analyzeAudit(sanitized, framework);
        if (!response.success || !response.data) {
          throw new Error(response.error || 'Unknown error');
        }
      },
      { successMessage: null, minStepDuration: 300 }
    );
  }

  const data = response.data;
  const { analysisId, prefetchId, hasPendingPackages } = data;

  // Set project context for analytics
  analytics.setProjectContext({
    packageCount: data.totalPackages,
    framework: data.framework?.name,
    frameworkVersion: data.framework?.version,
    projectHash: analytics.hashProject(sanitized),
  });

  // Track: project_detected
  analytics.projectDetected({
    packageCount: data.totalPackages,
    framework: data.framework?.name,
  });

  if (!options.json) {
    console.log(chalk.green('  ✓ Analysis complete'));
  }

  const issueCount = data.summary.critical + data.summary.high + data.summary.medium + data.summary.low;

  // Track: analysis_completed
  analytics.analysisCompleted({
    healthScore: data.healthScore,
    issueCount,
    criticalCount: data.summary.critical,
    highCount: data.summary.high,
  });

  return {
    response,
    data,
    analysisId,
    prefetchId,
    hasPendingPackages,
    cost: data.cost,
    tierName: data.tierName,
    packageCount: data.totalPackages,
    issueCount,
  };
}

/**
 * Output JSON result for audit mode
 */
function outputJsonResult(auditResult: AuditResult): void {
  const { data, analysisId, cost, tierName, issueCount } = auditResult;
  const output = {
    mode: 'audit',
    analysisId,
    healthScore: data.healthScore,
    totalPackages: data.totalPackages,
    summary: data.summary,
    issueCount,
    conflicts: data.conflicts,
    framework: data.framework,
    cost,
    tierName,
    hasCriticalIssues: data.summary.critical > 0,
    hasHighIssues: data.summary.high > 0,
    requiresAttention: data.summary.critical > 0 || data.summary.high > 0,
  };
  console.log(JSON.stringify(output, null, 2));
}

// ============================================================================
// DISPLAY FUNCTIONS
// ============================================================================

/**
 * Show result when no issues are found
 */
async function showNoIssuesResult(ctx: AnalysisContext, auditResult: AuditResult): Promise<void> {
  const { apiClient } = ctx;
  const { data } = auditResult;
  const healthInfo = getHealthStatus(data.healthScore);

  console.log();
  await sleep(100);
  console.log(colors.whiteBold('📊 ANALYSIS REPORT'));
  await sleep(80);
  console.log(colors.gray('─'.repeat(50)));
  await sleep(120);
  console.log(`${colors.whiteBold('🏥 Health:')}  ${renderHealthBar(data.healthScore)} ${healthInfo.color.bold(`${data.healthScore}/100`)} (${healthInfo.color(healthInfo.text)})`);

  await sleep(100);
  console.log();
  printSuccess('No issues found! Your dependencies are healthy.');

  // Check if migration is available (not on latest version)
  if (data.framework?.name && data.framework?.version) {
    await suggestMigrationIfAvailable(apiClient, data);
  }

  console.log();
}

/**
 * Suggest migration if user is not on latest version
 */
async function suggestMigrationIfAvailable(apiClient: ApiClient, data: any): Promise<void> {
  try {
    const currentMajor = parseInt(data.framework.version.split('.')[0], 10);
    const versionsResponse = await apiClient.getFrameworkVersions(data.framework.name, currentMajor);

    if (versionsResponse.success && versionsResponse.data) {
      const recommended = versionsResponse.data.quickOptions?.find(opt => opt.isRecommended);
      const latestMajor = recommended ? parseInt(recommended.value, 10) : null;

      if (latestMajor && latestMajor > currentMajor) {
        const versionsBehind = latestMajor - currentMajor;
        console.log();
        console.log(colors.whiteBold('💡 WHY NOT 100%?'));
        console.log(colors.dim(`    Your ${data.framework.name} version is `) + colors.warning(`${versionsBehind} major version${versionsBehind > 1 ? 's' : ''} behind`) + colors.dim(' the latest.'));
        console.log(colors.dim(`    This affects your health score even without dependency conflicts.`));
        console.log();
        console.log(colors.whiteBold('    👉 UPGRADE:'));
        console.log(`       Run ${colors.brand('npx depfixer migrate')} to upgrade to ${data.framework.name} ${latestMajor}.`);
      }
    }
  } catch {
    // Silently ignore - migration suggestion is optional
  }
}

/**
 * Display audit results in teaser mode (locked)
 */
async function displayAuditResults(auditResult: AuditResult): Promise<void> {
  const { data, issueCount } = auditResult;
  const healthInfo = getHealthStatus(data.healthScore);

  console.log();
  await sleep(100);
  console.log(colors.whiteBold('📊 ANALYSIS REPORT'));
  await sleep(80);
  console.log(colors.gray('─'.repeat(50)));
  await sleep(120);
  console.log(`${colors.whiteBold('🏥 Health:')}  ${renderHealthBar(data.healthScore)} ${healthInfo.color.bold(`${data.healthScore}/100`)} (${healthInfo.color(healthInfo.text)})`);

  await sleep(100);
  console.log(`${colors.whiteBold('⚠️  Issues:')}  ${colors.dangerBold(`${issueCount}`)} Conflicts Found`);
  await sleep(150);
  console.log();

  // Show LIMITED preview - protect small conflict counts from bypass
  await displayConflictPreview(data);

  // Diagnosis section with smooth reveal
  await sleep(150);
  printDiagnosis(issueCount);
}

/**
 * Display conflict preview (teaser table or summary)
 */
async function displayConflictPreview(data: any): Promise<void> {
  if (!data.conflicts || data.conflicts.length === 0) return;

  // Filter out "not installed" packages from audit display
  const installedConflicts = data.conflicts.filter((c: any) =>
    c.currentVersion && c.currentVersion.toLowerCase() !== 'not installed'
  );
  const missingPackagesCount = data.conflicts.length - installedConflicts.length;

  if (installedConflicts.length <= CLI_AUDIT_THRESHOLD) {
    // For small conflict counts, only show severity summary - no package names
    await displaySeveritySummary(data, missingPackagesCount);
  } else {
    // For larger counts, show first CLI_AUDIT_SAMPLE_SIZE installed packages only
    await displayTeaserTable(installedConflicts, missingPackagesCount);
  }
}

/**
 * Display severity summary box (for small conflict counts)
 */
async function displaySeveritySummary(data: any, missingPackagesCount: number): Promise<void> {
  await sleep(80);
  const W = 50; // Inner width
  const row = (label: string, colorFn: (s: string) => string, count: number, desc: string) => {
    const issueWord = count > 1 ? 'issues' : 'issue';
    const content = `  ${label.padEnd(10)}${count} ${issueWord} ${desc}`;
    console.log(colors.gray('│') + colorFn(content.padEnd(W)) + colors.gray('│'));
  };

  console.log(colors.gray('┌' + '─'.repeat(W) + '┐'));
  console.log(colors.gray('│') + colors.whiteBold('  SEVERITY BREAKDOWN'.padEnd(W)) + colors.gray('│'));
  console.log(colors.gray('├' + '─'.repeat(W) + '┤'));
  if (data.summary.critical > 0) row('CRITICAL', colors.dangerBold, data.summary.critical, 'require attention');
  if (data.summary.high > 0) row('HIGH', colors.danger, data.summary.high, 'with compatibility problems');
  if (data.summary.medium > 0) row('MEDIUM', colors.warning, data.summary.medium, 'with version conflicts');
  if (data.summary.low > 0) row('LOW', colors.dim, data.summary.low, 'to review');
  console.log(colors.gray('└' + '─'.repeat(W) + '┘'));
  await sleep(80);

  if (missingPackagesCount > 0) {
    console.log(colors.dim(`    + ${missingPackagesCount} missing peer ${missingPackagesCount > 1 ? 'dependencies' : 'dependency'} to install.`));
  }
  console.log(colors.dim('    Unlock to see details and recommended fixes.'));
}

/**
 * Display teaser table (for larger conflict counts)
 */
async function displayTeaserTable(installedConflicts: any[], missingPackagesCount: number): Promise<void> {
  const tableLines = createTeaserTable(installedConflicts.slice(0, CLI_AUDIT_SAMPLE_SIZE)).split('\n');
  for (const line of tableLines) {
    console.log(line);
    await sleep(40);
  }
  await sleep(80);

  const hiddenCount = installedConflicts.length - CLI_AUDIT_SAMPLE_SIZE;
  if (hiddenCount > 0) {
    console.log(colors.dim(`    + ${hiddenCount} other conflicts hidden.`));
  }
  if (missingPackagesCount > 0) {
    console.log(colors.dim(`    + ${missingPackagesCount} missing peer ${missingPackagesCount > 1 ? 'dependencies' : 'dependency'} to install.`));
  }
}

/**
 * Display full analysis with solutions (after unlock)
 */
async function displayFullAnalysis(data: any, solution: any): Promise<void> {
  console.log();
  await sleep(100);
  console.log(chalk.bold.green('🔓 FULL ANALYSIS'));
  await sleep(80);
  console.log(chalk.dim('─'.repeat(50)));
  await sleep(120);
  console.log();

  // Separate package conflicts from engine conflicts
  const packageConflicts = data.conflicts.filter((c: any) =>
    c.package !== 'Node.js' && c.package !== 'npm' && c.category !== 'engine'
  );
  const engineConflicts = data.conflicts.filter((c: any) =>
    c.package === 'Node.js' || c.package === 'npm' || c.category === 'engine'
  );

  // Show full table with recommended versions
  if (packageConflicts.length > 0) {
    await displayPackageConflictsTable(packageConflicts, solution);
  }

  // Show engine requirements
  await displayEngineRequirements(solution, engineConflicts);

  // Show packages to add
  await displayPackagesToAdd(packageConflicts);

  // Show removals
  await displayRemovals(solution);

  // If no package conflicts and no removals
  if (packageConflicts.length === 0 && (!solution.removals || solution.removals.length === 0)) {
    console.log(colors.dim('   No package version changes needed.'));
    console.log();
  }

  // Track: results_shown
  analytics.resultsShown({
    conflictCount: data.conflicts.length,
    removalsCount: solution.removals?.length || 0,
  });
}

/**
 * Display package conflicts table
 */
async function displayPackageConflictsTable(packageConflicts: any[], solution: any): Promise<void> {
  const fullTableLines = createFullSolutionTable(packageConflicts, solution).split('\n');
  for (const line of fullTableLines) {
    console.log(line);
    await sleep(35);
  }
  console.log();
}

/**
 * Display engine requirements
 */
async function displayEngineRequirements(solution: any, engineConflicts: any[]): Promise<void> {
  if (solution.engines && Object.keys(solution.engines).length > 0) {
    console.log(colors.whiteBold('⚙️  Engine Requirements:'));
    if (solution.engines.node) {
      console.log(`   ${colors.dim('•')} Node.js: ${colors.brand(solution.engines.node)}`);
    }
    if (solution.engines.npm) {
      console.log(`   ${colors.dim('•')} npm: ${colors.brand(solution.engines.npm)}`);
    }
    console.log();
  } else if (engineConflicts.length > 0) {
    console.log(colors.whiteBold('⚙️  Engine Requirements:'));
    for (const ec of engineConflicts) {
      const engine = ec.package || 'Unknown';
      let required = ec.recommendedVersion || ec.requiredVersion;
      if (!required && ec.engineDetails?.requiredVersion) {
        required = ec.engineDetails.requiredVersion.replace(/^>=/, '');
      }
      if (required) {
        console.log(`   ${colors.dim('•')} ${engine}: ${colors.brand('>=' + required)}`);
      }
    }
    console.log();
  }
}

/**
 * Display packages to add
 */
async function displayPackagesToAdd(packageConflicts: any[]): Promise<void> {
  const packagesToAdd = packageConflicts.filter((c: any) =>
    !c.currentVersion || c.currentVersion.toLowerCase() === 'not installed'
  );

  if (packagesToAdd.length === 0) return;

  console.log(colors.whiteBold('📦 Packages to Add:'));
  for (const pkg of packagesToAdd) {
    await sleep(60);
    let message: string;
    if (pkg.requiredBy && Array.isArray(pkg.requiredBy) && pkg.requiredBy.length > 0) {
      const requiredRange = pkg.requiredRange || 'required version';
      message = `Required as peer dependency by ${pkg.requiredBy.join(', ')} (${requiredRange})`;
    } else if (pkg.isPeerDependency && pkg.requiredRange) {
      message = `Missing peer dependency (${pkg.requiredRange})`;
    } else {
      message = pkg.description || 'Required dependency';
    }
    console.log(`   ${colors.brand('+')} ${pkg.package}`);
    console.log(`     ${colors.dim(message)}`);
  }
  console.log();
}

/**
 * Display removals
 */
async function displayRemovals(solution: any): Promise<void> {
  if (!solution.removals || solution.removals.length === 0) return;

  await sleep(100);
  console.log(colors.whiteBold('🗑  Packages to Remove:'));
  const removalLines = createMigrationTable(solution.removals.map((r: any) => ({
    package: r.package,
    currentVersion: '*',
    targetVersion: 'REMOVE',
    changeType: 'deprec',
    isRemoval: true,
  }))).split('\n');
  for (const line of removalLines) {
    console.log(line);
    await sleep(30);
  }
  console.log();
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Save session for potential later fix
 */
async function saveSession(ctx: AnalysisContext, auditResult: AuditResult): Promise<void> {
  const { sessionManager, sanitized, packageJsonHash } = ctx;
  const { analysisId, cost, tierName, packageCount } = auditResult;

  await sessionManager.saveSession({
    analysisId,
    intent: 'ANALYZE',
    originalFileHash: packageJsonHash,
    cost,
    status: 'UNPAID',
    projectName: sanitized.name || 'unnamed',
    packageCount,
    tierName,
  });
}

// ============================================================================
// PAYMENT FLOW
// ============================================================================

interface PaymentFlowResult {
  success: boolean;
  solution?: any;
  hasActivePass?: boolean;
}

/**
 * Handle the complete payment flow (auth check, balance check, deduct credits)
 */
async function handlePaymentFlow(ctx: AnalysisContext, auditResult: AuditResult): Promise<PaymentFlowResult> {
  const { sessionManager } = ctx;
  const { analysisId, cost, tierName } = auditResult;

  const authManager = new AuthManager();
  const isAlreadyLoggedIn = await authManager.isAuthenticated();
  const paymentFlow = new PaymentFlowService();

  let userHasActivePass = false;

  if (isAlreadyLoggedIn) {
    const result = await handleLoggedInPaymentFlow(paymentFlow, cost, tierName);
    if (!result.success) {
      return { success: false };
    }
    userHasActivePass = result.hasActivePass;
  } else {
    const result = await handleAnonymousPaymentFlow(paymentFlow, cost, tierName);
    if (!result.success) {
      return { success: false };
    }
    userHasActivePass = result.hasActivePass;
  }

  // Deduct credits and get solution
  const fixResult = await paymentFlow.deductCredits(analysisId, userHasActivePass);
  if (!fixResult.success || !fixResult.solution) {
    throw new Error(fixResult.error || 'Unknown error');
  }

  // Update session status
  await sessionManager.updateStatus('PAID');

  return {
    success: true,
    solution: fixResult.solution,
    hasActivePass: userHasActivePass,
  };
}

/**
 * Handle payment flow for logged-in users
 */
async function handleLoggedInPaymentFlow(
  paymentFlow: PaymentFlowService,
  cost: number,
  tierName: string
): Promise<{ success: boolean; hasActivePass: boolean }> {
  const balanceInfo = await paymentFlow.getBalanceInfo();
  const userHasActivePass = balanceInfo?.hasActivePass || false;

  // Show user details
  printUserDetails({
    name: balanceInfo?.name,
    email: balanceInfo?.email,
    credits: balanceInfo?.credits || 0,
    hasActivePass: userHasActivePass,
    showHeader: false,
  });

  // Show credit check
  printCreditCheck({
    needed: cost,
    available: balanceInfo?.credits || 0,
    hasActivePass: userHasActivePass,
  });

  // Cost box with prompt
  printCostBox({
    cost,
    tierName,
    prompt: userHasActivePass ? 'Continue? (Enter/Esc)' : `Deduct ${cost} credit${cost > 1 ? 's' : ''} to unlock? (Enter/Esc)`,
    hasActivePass: userHasActivePass,
  });

  // Track: unlock_prompt_shown
  analytics.unlockPromptShown({
    creditsNeeded: cost,
    creditsAvailable: balanceInfo?.credits || 0,
    tier: tierName,
    hasActivePass: userHasActivePass,
  });

  const confirmUnlock = await promptYesNo('');

  if (!confirmUnlock) {
    analytics.unlockRejected({ reason: 'user_cancelled' });
    console.log();
    printInfo('Solution saved. Run `npx depfixer fix` anytime to resume.');
    return { success: false, hasActivePass: userHasActivePass };
  }

  analytics.unlockAccepted({ creditsDeducted: userHasActivePass ? 0 : cost });

  // Check balance is sufficient
  if (!userHasActivePass && (balanceInfo?.credits || 0) < cost) {
    analytics.unlockFailed({
      reason: 'insufficient_credits',
      needed: cost,
      available: balanceInfo?.credits || 0,
    });

    const hasBalance = await paymentFlow.ensureSufficientBalance(cost);
    if (!hasBalance) {
      console.log();
      printInfo('Run `npx depfixer fix` when ready to continue.');
      return { success: false, hasActivePass: userHasActivePass };
    }

    // After top-up, confirm again
    printCostBox({
      cost,
      tierName,
      prompt: `Deduct ${cost} credit${cost > 1 ? 's' : ''} to unlock? (Enter/Esc)`,
    });

    const confirmAfterTopUp = await promptYesNo('');
    if (!confirmAfterTopUp) {
      console.log();
      printInfo('Solution saved. Run `npx depfixer fix` anytime to resume.');
      return { success: false, hasActivePass: userHasActivePass };
    }
  }

  return { success: true, hasActivePass: userHasActivePass };
}

/**
 * Handle payment flow for anonymous users
 */
async function handleAnonymousPaymentFlow(
  paymentFlow: PaymentFlowService,
  cost: number,
  tierName: string
): Promise<{ success: boolean; hasActivePass: boolean }> {
  printCostBox({
    cost,
    tierName,
    prompt: '',
  });

  analytics.unlockPromptShown({
    creditsNeeded: cost,
    creditsAvailable: 0,
    tier: tierName,
    isAnonymous: true,
  });

  analytics.authRequired({ creditsNeeded: cost });

  console.log();
  console.log(colors.warning('⚠️  Login required to unlock'));
  console.log(colors.gray('[?] Continue to login? (Enter/Esc)'));

  const wantsToUnlock = await promptYesNo('');

  if (!wantsToUnlock) {
    analytics.authAbandoned({ reason: 'user_cancelled' });
    console.log();
    printInfo('Solution saved. Run `npx depfixer fix` anytime to resume.');
    return { success: false, hasActivePass: false };
  }

  // Run full auth + balance flow
  const paymentResult = await paymentFlow.ensureReadyToPay(cost);

  if (!paymentResult.ready) {
    analytics.authAbandoned({ reason: 'auth_flow_incomplete' });
    console.log();
    printInfo('Run `npx depfixer fix` when ready to continue.');
    return { success: false, hasActivePass: false };
  }

  const userHasActivePass = paymentResult.hasActivePass || false;

  // Confirm after login
  printCostBox({
    cost,
    tierName,
    prompt: userHasActivePass ? 'Continue? (Enter/Esc)' : `Confirm: Deduct ${cost} credit${cost > 1 ? 's' : ''}? (Enter/Esc)`,
    hasActivePass: userHasActivePass,
  });

  const confirmUnlock = await promptYesNo('');

  if (!confirmUnlock) {
    analytics.unlockRejected({ reason: 'user_cancelled_after_login' });
    console.log();
    printInfo('Solution saved. Run `npx depfixer fix` anytime to resume.');
    return { success: false, hasActivePass: userHasActivePass };
  }

  analytics.unlockAccepted({ creditsDeducted: userHasActivePass ? 0 : cost });

  return { success: true, hasActivePass: userHasActivePass };
}

// ============================================================================
// PREFETCH POLLING
// ============================================================================

/**
 * Poll prefetch status if there are pending packages
 */
async function pollPrefetchIfNeeded(
  ctx: AnalysisContext,
  auditResult: AuditResult,
  paymentResult: PaymentFlowResult
): Promise<any> {
  const { apiClient } = ctx;
  const { hasPendingPackages, prefetchId, analysisId, data } = auditResult;

  if (!hasPendingPackages || !prefetchId) {
    return updateDataWithSolution(data, paymentResult.solution);
  }

  const spinner = createSpinner('Finalizing complete analysis...').start();

  let pollCount = 0;
  const maxPolls = 120; // 2 minutes max
  let updatedData = data;

  while (pollCount < maxPolls) {
    try {
      const status = await apiClient.pollPrefetchStatus(prefetchId);

      if (status.isComplete && status.reanalysisStatus === 'completed') {
        const updatedResponse = await apiClient.getAnalysisById(analysisId);
        if (updatedResponse.success && updatedResponse.data) {
          const updated = updatedResponse.data;
          const analysisResult = updated.analysisResult || {};
          updatedData = {
            ...data,
            conflicts: analysisResult.conflicts || data.conflicts,
            missingDependencies: analysisResult.missingDependencies || data.missingDependencies,
            deprecations: analysisResult.deprecations || data.deprecations,
            healthScore: analysisResult.healthScore || data.healthScore,
            summary: analysisResult.conflicts ? calculateSummary(analysisResult.conflicts) : data.summary,
          };
        }
        break;
      }

      if (status.percentage !== undefined) {
        const percent = Math.round(status.percentage);
        spinner.text = `Finalizing complete analysis... ${percent}%`;
      }

      await sleep(1000);
      pollCount++;
    } catch (err) {
      await sleep(2000);
      pollCount++;
    }
  }

  spinner.succeed('Complete analysis ready');
  return updatedData;
}

/**
 * Update data with solution results
 */
function updateDataWithSolution(data: any, solution: any): any {
  if (!solution) return data;

  return {
    ...data,
    conflicts: solution.conflicts || data.conflicts,
    missingDependencies: solution.missingDependencies || data.missingDependencies,
    deprecations: solution.deprecations || data.deprecations,
    healthScore: solution.healthScore || data.healthScore,
    summary: solution.summary || data.summary,
  };
}

// ============================================================================
// FIX APPLICATION
// ============================================================================

/**
 * Handle fix application prompt and execution
 */
async function handleFixApplication(ctx: AnalysisContext, data: any, solution: any): Promise<void> {
  const { projectDir, packageJsonService, parsed } = ctx;

  // Explain what will be changed
  await sleep(100);
  console.log(colors.gray('────────────────────────────────────────'));
  await sleep(50);
  console.log(colors.gray('  📝 Only ') + colors.white('package.json') + colors.gray(' will be modified'));
  await sleep(50);
  console.log(colors.gray('  💾 A backup (') + colors.white('package.json.bak') + colors.gray(') will be created'));
  await sleep(50);
  console.log(colors.gray('────────────────────────────────────────'));
  await sleep(100);
  console.log();

  // Track: fix_prompt_shown
  analytics.fixPromptShown({
    updatesCount: Object.keys(solution.dependencies || {}).length + Object.keys(solution.devDependencies || {}).length,
    removalsCount: solution.removals?.length || 0,
  });

  const shouldApply = await promptYesNo('Apply fix to package.json?');

  if (!shouldApply) {
    analytics.fixDeferred({ reason: 'user_declined' });
    console.log();
    printInfo('Solution unlocked but not applied. Run `npx depfixer fix` to apply later.');
    return;
  }

  analytics.fixAccepted();

  // Apply the solution
  await applyFixes(projectDir, packageJsonService, parsed, solution, data);
}

/**
 * Apply fixes to package.json
 */
async function applyFixes(
  projectDir: string,
  packageJsonService: PackageJsonService,
  parsed: any,
  solution: any,
  data: any
): Promise<void> {
  console.log();
  console.log(chalk.bold('🔧 Applying fixes...'));
  console.log();

  const changes = packageJsonService.getChanges(parsed, solution);
  const removals = (solution.removals || []).map((r: any) => ({
    package: r.package,
    reason: r.reason || 'Deprecated',
    type: r.type,
  }));

  let fixResult: { backupPath: string; applied: number; removed: number; enginesUpdated: number };

  await runStepSequence(
    [...FIX_STEPS],
    async () => {
      fixResult = await packageJsonService.applySurgicalFixes(
        projectDir,
        changes,
        removals,
        solution.engines
      );
    },
    { successMessage: 'Fix complete', minStepDuration: 100 }
  );

  const { backupPath, applied, removed, enginesUpdated } = fixResult!;

  // Show success
  printSuccessBox({
    updated: applied,
    removed,
    backupPath,
    enginesUpdated,
  });

  // Track: fix_applied
  analytics.fixApplied({
    updatedCount: applied,
    removedCount: removed,
    enginesUpdated,
  });

  // Track: session_ended
  await analytics.sessionEnded({
    outcome: 'fix_applied',
    healthScore: data.healthScore,
  });
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Handle errors and track session end
 */
async function handleError(error: any, options: SmartOptions): Promise<void> {
  await analytics.sessionEnded({
    outcome: 'error',
    error: error.message,
  });

  if (options.json) {
    console.log(JSON.stringify({ error: error.message }, null, 2));
  } else {
    printError(error.message);
  }
  process.exit(options.ci ? 2 : 1);
}
