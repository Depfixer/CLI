/**
 * Migrate Command
 *
 * Interactive migration planner for framework upgrades.
 * Supports Angular and React framework migrations.
 *
 * Flow:
 * 1. Detect framework and current version
 * 2. Fetch available versions from server
 * 3. Show version selector (minor patches vs major upgrades)
 * 4. User selects target version
 * 5. Show migration plan with cost
 * 6. Confirm and execute
 */
import chalk from 'chalk';
import { ApiClient } from '../services/api-client.js';
import { PackageJsonService } from '../services/package-json.js';
import { SessionManager } from '../services/session-manager.js';
import { PaymentFlowService } from '../services/payment-flow.js';
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
  printMigrationPlanHeader,
  printProjectionStats,
  printCostBox,
  printSuccessBox,
  renderHealthBar,
  getHealthStatus,
  printUserDetails,
} from '../utils/design-system.js';
import { promptYesNo } from '../utils/prompt.js';
import { getChangeType } from '../utils/framework-utils.js';

interface MigrateOptions {
  path?: string;
}

interface VersionOption {
  version: string;
  major: number;
  label: string;
  type: 'minor' | 'major';
  isLatest?: boolean;
}

interface MigrationContext {
  projectDir: string;
  packageJsonService: PackageJsonService;
  apiClient: ApiClient;
  sessionManager: SessionManager;
  packageJsonContent: string;
  parsed: any;
  sanitized: any;
  framework: string;
  frameworkName: string;
  currentVersion: string | undefined;
  currentMajor: number;
  packageJsonHash: string;
}

interface CostEstimate {
  cost: number;
  tierName: string;
  packageCount: number;
  healthScore: number;
  auditData: any;
}

// ============================================================================
// MAIN COMMAND
// ============================================================================

/**
 * Migrate command
 *
 * Interactive migration with version selection:
 * 1. Detect framework and current version
 * 2. Fetch available versions from server
 * 3. Show version selector (minor patches vs major upgrades)
 * 4. User selects target version
 * 5. Show migration plan with cost
 * 6. Confirm and execute
 *
 * Usage:
 *   npx depfixer migrate
 */
export async function migrateCommand(options: MigrateOptions): Promise<void> {
  const projectDir = options.path || process.cwd();

  // Create device ID early (for anonymous user tracking before login)
  getDeviceId();

  try {
    // Initialize context
    const ctx = await initializeMigrationContext(projectDir);

    // Print CLI header
    printCliHeader('migrate');

    // Track: migrate_started
    analytics.migrateStarted({ command: 'migrate' });

    // Show project info
    console.log();
    console.log(colors.whiteBold(`📦 Project: ${colors.brand(ctx.sanitized.name || 'unnamed')}`));
    console.log(colors.dim(`   Framework: ${ctx.frameworkName} ${ctx.currentVersion || 'unknown'}`));
    console.log();

    // Fetch versions and let user select target
    const targetVersion = await fetchAndSelectVersion(ctx);
    if (!targetVersion) {
      return; // User cancelled or already on latest
    }

    // Get cost estimate
    const costEstimate = await getCostEstimate(ctx);

    // Show project overview with migration plan
    await showProjectOverview(ctx, costEstimate, targetVersion);

    // Handle payment flow
    const paymentFlow = new PaymentFlowService();
    const paymentReady = await handleMigrationPaymentFlow(ctx, costEstimate, paymentFlow, targetVersion);
    if (!paymentReady.success) {
      return;
    }

    // Run migration analysis
    const migrationResult = await runMigrationAnalysis(ctx, targetVersion, costEstimate);

    // Deduct credits and get solution
    const fixResult = await paymentFlow.deductCredits(migrationResult.analysisId, paymentReady.hasActivePass);
    if (!fixResult.success || !fixResult.solution) {
      throw new Error(fixResult.error || 'Unknown error');
    }

    // Save session as PAID
    await saveMigrationSession(ctx, migrationResult.analysisId, targetVersion, costEstimate);

    // Show full migration plan
    const changes = ctx.packageJsonService.getChanges(ctx.parsed, fixResult.solution);
    const removals = mapRemovals(fixResult.solution.removals);

    await showMigrationPlan(ctx, costEstimate, targetVersion, migrationResult.data, fixResult.solution, changes, removals);

    // Ask to apply and execute
    await applyMigrationFix(ctx, changes, removals, fixResult.solution, targetVersion);

  } catch (error: any) {
    await handleMigrationError(error);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize migration context with all required services and data
 */
async function initializeMigrationContext(projectDir: string): Promise<MigrationContext> {
  const packageJsonService = new PackageJsonService();
  const apiClient = new ApiClient();
  const sessionManager = new SessionManager(projectDir);

  // Read and sanitize package.json
  const { content: packageJsonContent, parsed } = await packageJsonService.read(projectDir);
  const sanitized = packageJsonService.sanitize(parsed);

  // Detect framework using server API (more accurate than local detection)
  let framework: string | undefined;
  let currentVersion: string | undefined;
  let currentMajor = 0;

  const spinner = createSpinner('Detecting framework...').start();

  try {
    const detectResponse = await apiClient.detectFramework(sanitized);
    if (detectResponse.success && detectResponse.data) {
      framework = detectResponse.data.name;
      currentVersion = detectResponse.data.version;
      currentMajor = detectResponse.data.majorVersion || 0;
      spinner.succeed(`Detected ${framework} ${currentVersion}`);
    } else {
      spinner.fail('Framework detection failed');
    }
  } catch {
    spinner.fail('Framework detection failed');
    // If API fails, framework will be undefined
  }

  if (!framework) {
    printError('Could not detect framework. Migration requires Angular, React, or Vue project.');
    printInfo('Note: Next.js, React Native, Expo, and Svelte are not supported for migration.');
    process.exit(1);
  }

  const frameworkName = framework.charAt(0).toUpperCase() + framework.slice(1);

  // Calculate package.json hash
  const packageJsonHash = sessionManager.calculateHash(packageJsonContent);

  return {
    projectDir,
    packageJsonService,
    apiClient,
    sessionManager,
    packageJsonContent,
    parsed,
    sanitized,
    framework,
    frameworkName,
    currentVersion,
    currentMajor,
    packageJsonHash,
  };
}

// ============================================================================
// VERSION SELECTION
// ============================================================================

/**
 * Fetch available versions and let user select target
 */
async function fetchAndSelectVersion(ctx: MigrationContext): Promise<string | null> {
  const { apiClient, sanitized, framework, frameworkName, currentVersion, currentMajor } = ctx;

  const spinner = createSpinner('Fetching available versions...').start();

  try {
    const versionsResponse = await apiClient.getFrameworkVersions(framework, currentMajor);

    // Check if already on latest version
    if (!versionsResponse.success) {
      const errorMsg = versionsResponse.error || '';
      if (errorMsg.includes('No newer versions') || errorMsg.includes('No supported versions')) {
        spinner.succeed('Version check complete');
        await showLatestVersionInfo(apiClient, sanitized, framework, frameworkName, currentVersion);
        return null;
      }
      spinner.fail('Failed to fetch versions');
      throw new Error(errorMsg || 'Could not fetch available versions');
    }

    spinner.succeed('Versions loaded');

    // Track: versions_loaded
    analytics.versionsLoaded({
      framework,
      currentVersion,
      groupCount: versionsResponse.data?.groups?.length || 0,
    });

    const groups = versionsResponse.data?.groups;

    if (!groups || groups.length === 0) {
      await showLatestVersionInfo(apiClient, sanitized, framework, frameworkName, currentVersion);
      return null;
    }

    // Build version options
    const versionOptions = buildVersionOptions(groups, frameworkName, currentMajor);

    // Show version selector
    displayVersionOptions(versionOptions);

    // Interactive selection
    const selectedVersion = await selectVersion(versionOptions, frameworkName);
    if (!selectedVersion) {
      console.log();
      printInfo('Migration cancelled.');
      return null;
    }

    // Track: version_selected
    analytics.versionSelected({
      framework,
      currentVersion,
      targetVersion: selectedVersion.version,
      isMajorUpgrade: selectedVersion.type === 'major',
    });

    console.log();
    console.log(colors.success(`✓ Selected: ${frameworkName} ${selectedVersion.version}`));

    // Validate version format
    if (!/^\d+(\.\d+)?(\.\d+)?$/.test(selectedVersion.version)) {
      printError('Invalid version format. Use major version (e.g., "19") or semver (e.g., "19.0.0")');
      process.exit(1);
    }

    return selectedVersion.version;

  } catch (error: any) {
    spinner.fail('Failed to fetch versions');
    throw error;
  }
}

/**
 * Build version options from API response groups
 */
function buildVersionOptions(groups: any[], frameworkName: string, currentMajor: number): VersionOption[] {
  const versionOptions: VersionOption[] = [];

  for (const group of groups) {
    const latestInGroup = group.options[0];
    if (latestInGroup) {
      const major = parseInt(latestInGroup.value.split('.')[0], 10);
      const isMajorUpgrade = major > currentMajor;
      versionOptions.push({
        version: latestInGroup.value,
        major,
        label: `${frameworkName} ${latestInGroup.value}` + (latestInGroup.badge ? ` (${latestInGroup.badge})` : ''),
        type: isMajorUpgrade ? 'major' : 'minor',
        isLatest: latestInGroup.badge === 'Latest',
      });
    }
  }

  return versionOptions;
}

/**
 * Display version options grouped by type
 */
function displayVersionOptions(versionOptions: VersionOption[]): void {
  console.log();
  console.log(colors.whiteBold('🎯 Select target version:'));
  console.log();

  const minorOptions = versionOptions.filter(v => v.type === 'minor');
  const majorOptions = versionOptions.filter(v => v.type === 'major');

  if (minorOptions.length > 0) {
    console.log(colors.dim('  Minor Patches:'));
    for (const opt of minorOptions) {
      console.log(colors.brand(`    ${opt.label}`));
    }
    console.log();
  }

  if (majorOptions.length > 0) {
    console.log(colors.dim('  Major Upgrades:'));
    for (const opt of majorOptions) {
      console.log(colors.action(`    ${opt.label}`));
    }
    console.log();
  }
}

// ============================================================================
// COST ESTIMATION
// ============================================================================

/**
 * Get cost estimate from server
 */
async function getCostEstimate(ctx: MigrationContext): Promise<CostEstimate> {
  const { apiClient, sanitized, framework, currentVersion } = ctx;

  const costSpinner = createSpinner('Getting cost estimate...').start();

  try {
    const auditResponse = await apiClient.analyzeAudit(sanitized, framework);
    if (!auditResponse.success || !auditResponse.data) {
      costSpinner.fail('Failed to get cost estimate');
      throw new Error(auditResponse.error || 'Could not get cost estimate');
    }

    const auditData = auditResponse.data;
    costSpinner.succeed('Cost estimate ready');

    // Set project context for analytics
    analytics.setProjectContext({
      packageCount: auditData.totalPackages,
      framework,
      frameworkVersion: currentVersion,
      projectHash: analytics.hashProject(sanitized),
    });

    // Track: project_detected
    analytics.projectDetected({
      packageCount: auditData.totalPackages,
      framework,
      currentVersion,
    });

    return {
      cost: auditData.cost,
      tierName: auditData.tierName,
      packageCount: auditData.totalPackages,
      healthScore: auditData.healthScore || 0,
      auditData,
    };

  } catch (error: any) {
    costSpinner.fail('Failed to get cost estimate');
    throw error;
  }
}

// ============================================================================
// PROJECT OVERVIEW
// ============================================================================

/**
 * Show project overview with migration plan
 */
async function showProjectOverview(
  ctx: MigrationContext,
  costEstimate: CostEstimate,
  targetVersion: string
): Promise<void> {
  const { frameworkName, currentVersion, currentMajor } = ctx;
  const { packageCount, healthScore } = costEstimate;
  const healthInfo = getHealthStatus(healthScore);

  console.log();
  await sleep(100);
  console.log(colors.whiteBold('📊 PROJECT OVERVIEW'));
  await sleep(80);
  console.log(colors.gray('─'.repeat(50)));
  await sleep(120);
  console.log(`${colors.whiteBold('🏥 Health:')}  ${renderHealthBar(healthScore)} ${healthInfo.color.bold(`${healthScore}/100`)} (${healthInfo.color(healthInfo.text)})`);
  await sleep(100);
  console.log(`${colors.whiteBold('📦 Packages:')} ${colors.brand(`${packageCount}`)} to migrate`);
  await sleep(150);
  console.log();
  console.log(colors.whiteBold('🚀 MIGRATION PLAN:'));
  await sleep(80);
  console.log(colors.dim(`    ${frameworkName} ${currentVersion || '?'} → ${targetVersion}`));
  await sleep(60);
  console.log(colors.dim('    All dependencies will be aligned to the target version.'));

  // Migration highlight box
  const targetMajor = parseInt(targetVersion.split('.')[0], 10);
  const majorJump = targetMajor - currentMajor;
  await displayMigrationHighlight(majorJump);
}

/**
 * Display migration highlight box
 */
async function displayMigrationHighlight(majorJump: number): Promise<void> {
  await sleep(150);
  console.log();
  console.log(colors.brandBold('┌─────────────────────────────────────────────────┐'));
  await sleep(40);
  console.log(colors.brandBold('│') + colors.whiteBold('  MIGRATION HIGHLIGHT                            ') + colors.brandBold('│'));
  await sleep(40);
  console.log(colors.brandBold('├─────────────────────────────────────────────────┤'));
  await sleep(60);

  if (majorJump > 1) {
    console.log(colors.brandBold('│') + colors.warning(`  ${majorJump} major versions jump - Full ecosystem update `.padEnd(49)) + colors.brandBold('│'));
  } else if (majorJump === 1) {
    console.log(colors.brandBold('│') + colors.success('  Single major version upgrade                   ') + colors.brandBold('│'));
  } else {
    console.log(colors.brandBold('│') + colors.success('  Minor/patch update - Low risk                  ') + colors.brandBold('│'));
  }

  await sleep(50);
  console.log(colors.brandBold('│') + colors.dim('  - TypeScript alignment included                ') + colors.brandBold('│'));
  await sleep(50);
  console.log(colors.brandBold('│') + colors.dim('  - Peer dependency conflicts auto-resolved      ') + colors.brandBold('│'));
  await sleep(50);
  console.log(colors.brandBold('│') + colors.dim('  - Deprecated packages flagged for removal      ') + colors.brandBold('│'));
  await sleep(40);
  console.log(colors.brandBold('└─────────────────────────────────────────────────┘'));
}

// ============================================================================
// PAYMENT FLOW
// ============================================================================

interface PaymentResult {
  success: boolean;
  hasActivePass: boolean;
}

/**
 * Handle migration payment flow
 */
async function handleMigrationPaymentFlow(
  ctx: MigrationContext,
  costEstimate: CostEstimate,
  paymentFlow: PaymentFlowService,
  targetVersion: string
): Promise<PaymentResult> {
  const { cost, tierName } = costEstimate;

  // Check authentication
  console.log();
  const authResult = await paymentFlow.ensureAuthenticated();
  if (!authResult.success) {
    console.log();
    printInfo('Run `npx depfixer migrate` when ready to continue.');
    return { success: false, hasActivePass: false };
  }

  // Get balance info
  const balanceInfo = await paymentFlow.getBalanceInfo();

  // Show user details if already logged in
  if (authResult.wasAlreadyLoggedIn && balanceInfo) {
    printUserDetails({
      name: balanceInfo.name,
      email: balanceInfo.email,
      credits: balanceInfo.credits,
      hasActivePass: balanceInfo.hasActivePass,
      showHeader: false,
    });
  }

  console.log();

  // Show cost and confirm payment
  const hasPass = balanceInfo?.hasActivePass;
  printCostBox({
    cost,
    tierName,
    prompt: hasPass ? 'Execute migration? (Enter/Esc)' : 'Execute migration? (Enter/Esc)',
    isMigration: true,
    hasActivePass: hasPass,
  });

  // Track: migration_prompt_shown
  analytics.migrationPromptShown({
    creditsNeeded: cost,
    creditsAvailable: balanceInfo?.credits || 0,
    tier: tierName,
    hasActivePass: hasPass,
    targetVersion,
  });

  const shouldExecute = await promptYesNo('');

  if (!shouldExecute) {
    analytics.migrationRejected({ reason: 'user_cancelled' });
    console.log();
    printInfo('Migration cancelled.');
    return { success: false, hasActivePass: hasPass || false };
  }

  analytics.migrationAccepted({ creditsDeducted: hasPass ? 0 : cost });

  // Check balance
  const readyToPay = await paymentFlow.ensureSufficientBalance(cost);
  if (!readyToPay) {
    console.log();
    printInfo('Run `npx depfixer migrate` when ready to continue.');
    return { success: false, hasActivePass: hasPass || false };
  }

  return { success: true, hasActivePass: hasPass || false };
}

// ============================================================================
// MIGRATION ANALYSIS
// ============================================================================

interface MigrationResult {
  analysisId: string;
  data: any;
}

/**
 * Run migration analysis
 */
async function runMigrationAnalysis(
  ctx: MigrationContext,
  targetVersion: string,
  costEstimate: CostEstimate
): Promise<MigrationResult> {
  const { apiClient, sanitized, framework, frameworkName, currentVersion } = ctx;

  console.log();
  console.log(colors.whiteBold(`🔄 Analyzing Migration → ${frameworkName} ${targetVersion}`));
  console.log(colors.gray('─'.repeat(50)));

  const migrationSteps = [
    'Analyzing current state...',
    `Mapping migration path: ${currentVersion || '?'} → ${targetVersion}`,
    'Checking ecosystem compatibility...',
    'Calculating optimal versions...',
    'Resolving dependency conflicts...',
    'Building migration plan...',
  ];

  let response: any;

  await runStepSequence(
    migrationSteps,
    async () => {
      response = await apiClient.analyzeMigrate(sanitized, targetVersion, framework);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Unknown error');
      }
    },
    { successMessage: 'Migration plan ready', minStepDuration: 200 }
  );

  const data = response.data;

  // Track: migration_plan_ready
  analytics.migrationPlanReady({
    analysisId: data.analysisId,
    targetVersion,
    conflictCount: (data.conflicts || []).length,
  });

  return {
    analysisId: data.analysisId,
    data,
  };
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Save migration session
 */
async function saveMigrationSession(
  ctx: MigrationContext,
  analysisId: string,
  targetVersion: string,
  costEstimate: CostEstimate
): Promise<void> {
  const { sessionManager, sanitized, packageJsonHash } = ctx;
  const { cost, tierName, packageCount } = costEstimate;

  await sessionManager.saveSession({
    analysisId,
    intent: 'MIGRATE',
    args: { target: targetVersion },
    originalFileHash: packageJsonHash,
    cost,
    status: 'PAID',
    projectName: sanitized.name || 'unnamed',
    packageCount,
    tierName,
  });
}

// ============================================================================
// MIGRATION PLAN DISPLAY
// ============================================================================

/**
 * Map removals to expected format
 */
function mapRemovals(removals: any[] | undefined): Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }> {
  return (removals || []).map(r => ({
    package: r.package,
    reason: r.reason || 'Deprecated',
    type: r.type as 'dependency' | 'devDependency',
  }));
}

/**
 * Show full migration plan
 */
async function showMigrationPlan(
  ctx: MigrationContext,
  costEstimate: CostEstimate,
  targetVersion: string,
  migrationData: any,
  solution: any,
  changes: any[],
  removals: Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }>
): Promise<void> {
  const { frameworkName, currentVersion } = ctx;
  const { healthScore } = costEstimate;

  // Calculate projected health score
  const projectedHealthScore = typeof migrationData.healthScore === 'object'
    ? (migrationData.healthScore.after || migrationData.healthScore.projected || 0)
    : (typeof migrationData.healthScore === 'number' ? migrationData.healthScore : 0);

  const breakingChanges = (migrationData.conflicts || []).filter(
    (c: any) => c.severity === 'critical' || c.severity === 'high'
  ).length;

  // Show migration plan header
  await sleep(100);
  printMigrationPlanHeader(frameworkName, currentVersion || '?', targetVersion);

  // Show projection stats
  await sleep(150);
  printProjectionStats({
    currentHealth: healthScore,
    projectedHealth: projectedHealthScore,
    packageCount: changes.length,
    breakingChanges,
  });

  // Show package updates
  if (changes.length > 0) {
    await displayPackageUpdates(changes);
  }

  // Show engine requirements
  await displayEngineRequirements(solution);

  // Show packages to add
  await displayPackagesToAdd(migrationData);

  // Show packages to remove
  await displayRemovals(removals);
}

/**
 * Display package updates table
 */
async function displayPackageUpdates(changes: any[]): Promise<void> {
  await sleep(150);
  console.log();
  console.log(colors.whiteBold('📦 Package Updates:'));

  // Map and sort changes
  const mappedChanges = changes.map((c: any) => ({
    package: c.package,
    currentVersion: c.from,
    targetVersion: c.to,
    changeType: getChangeType(c.from, c.to),
  }));

  const changeTypeOrder = { major: 0, minor: 1, patch: 2, none: 3 };
  mappedChanges.sort((a: any, b: any) => {
    const orderA = changeTypeOrder[a.changeType as keyof typeof changeTypeOrder] ?? 3;
    const orderB = changeTypeOrder[b.changeType as keyof typeof changeTypeOrder] ?? 3;
    return orderA - orderB;
  });

  const tableLines = createMigrationTable(mappedChanges).split('\n');
  for (const line of tableLines) {
    console.log(line);
    await sleep(30);
  }
}

/**
 * Display engine requirements
 */
async function displayEngineRequirements(solution: any): Promise<void> {
  if (!solution.engines || Object.keys(solution.engines).length === 0) return;

  await sleep(100);
  console.log();
  console.log(colors.whiteBold('⚙️  Engine Requirements:'));
  if (solution.engines.node) {
    console.log(`   ${colors.dim('•')} Node.js: ${colors.brand(solution.engines.node)}`);
  }
  if (solution.engines.npm) {
    console.log(`   ${colors.dim('•')} npm: ${colors.brand(solution.engines.npm)}`);
  }
}

/**
 * Display packages to add
 */
async function displayPackagesToAdd(migrationData: any): Promise<void> {
  const packagesToAdd = (migrationData.conflicts || []).filter((c: any) =>
    !c.currentVersion || c.currentVersion.toLowerCase() === 'not installed'
  );

  if (packagesToAdd.length === 0) return;

  await sleep(100);
  console.log();
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
}

/**
 * Display removals
 */
async function displayRemovals(removals: Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }>): Promise<void> {
  if (removals.length === 0) return;

  await sleep(100);
  console.log();
  console.log(colors.whiteBold('🗑  Packages to Remove:'));

  const removalLines = createMigrationTable(removals.map(r => ({
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
}

// ============================================================================
// FIX APPLICATION
// ============================================================================

/**
 * Apply migration fix to package.json
 */
async function applyMigrationFix(
  ctx: MigrationContext,
  changes: any[],
  removals: Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }>,
  solution: any,
  targetVersion: string
): Promise<void> {
  const { projectDir, packageJsonService } = ctx;

  // Show what will be changed
  await sleep(200);
  console.log();
  console.log(colors.gray('────────────────────────────────────────'));
  await sleep(50);
  console.log(colors.gray('  📝 Only ') + colors.white('package.json') + colors.gray(' will be modified'));
  await sleep(50);
  console.log(colors.gray('  💾 A backup (') + colors.white('package.json.bak') + colors.gray(') will be created'));
  await sleep(50);
  console.log(colors.gray('────────────────────────────────────────'));
  await sleep(100);
  console.log();

  // Track: migration_apply_prompt
  analytics.migrationApplyPrompt({
    changeCount: changes.length,
    removalCount: removals.length,
  });

  console.log(colors.gray('[?] Apply changes now? (Enter/Esc)'));
  const shouldApplyFix = await promptYesNo('');

  if (!shouldApplyFix) {
    analytics.migrationDeferred({ reason: 'user_declined_apply' });
    console.log();
    printInfo('Solution saved. Run `npx depfixer fix` anytime to apply.');
    return;
  }

  // Apply fix
  await executeMigrationFix(projectDir, packageJsonService, changes, removals, solution, targetVersion);
}

/**
 * Execute migration fix
 */
async function executeMigrationFix(
  projectDir: string,
  packageJsonService: PackageJsonService,
  changes: any[],
  removals: Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }>,
  solution: any,
  targetVersion: string
): Promise<void> {
  await sleep(150);
  console.log();
  console.log(colors.whiteBold(`🔧 Applying Migration...`));
  await sleep(80);
  console.log(colors.gray('─'.repeat(50)));

  const upgradeCount = changes.length;
  const removalCount = removals.length;

  const migrationFixSteps = [
    'Reading package.json...',
    `Applying ${upgradeCount} upgrade${upgradeCount !== 1 ? 's' : ''}...`,
    'Resolving peer conflicts...',
    removalCount > 0 ? `Removing ${removalCount} deprecated package${removalCount !== 1 ? 's' : ''}...` : 'Checking for deprecated packages...',
    'Validating final state...',
    'Writing package.json...',
  ];

  let applyResult: { backupPath: string; applied: number; removed: number; enginesUpdated: number };

  await sleep(100);
  await runStepSequence(
    migrationFixSteps,
    async () => {
      applyResult = await packageJsonService.applySurgicalFixes(
        projectDir,
        changes,
        removals,
        solution.engines
      );
    },
    { successMessage: 'Migration complete', minStepDuration: 150 }
  );

  const { backupPath, applied, removed, enginesUpdated } = applyResult!;

  // Show success
  await sleep(200);
  printSuccessBox({
    updated: applied,
    removed,
    backupPath,
    enginesUpdated,
  });

  // Track: migration_applied
  analytics.migrationApplied({
    updatedCount: applied,
    removedCount: removed,
    enginesUpdated,
    targetVersion,
  });

  // Track: session_ended
  await analytics.sessionEnded({
    outcome: 'migration_applied',
    targetVersion,
  });
}

// ============================================================================
// VERSION SELECTOR
// ============================================================================

/**
 * Interactive version selector using arrow keys
 */
async function selectVersion(options: VersionOption[], frameworkName: string): Promise<VersionOption | null> {
  return new Promise((resolve) => {
    let selectedIndex = 0;

    const render = () => {
      // Move cursor up and clear previous render
      if (selectedIndex > 0 || options.length > 0) {
        process.stdout.write(`\x1b[${options.length + 2}A`);
      }

      console.log(colors.dim('  Use ↑↓ arrows to select, Enter to confirm, Esc to cancel'));
      console.log();

      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? colors.brand('❯ ') : '  ';
        const color = opt.type === 'major' ? colors.action : colors.brand;
        const label = isSelected ? chalk.bold(color(opt.label)) : colors.dim(opt.label);
        console.log(`${prefix}${label}`);
      }
    };

    // Initial render
    console.log(colors.dim('  Use ↑↓ arrows to select, Enter to confirm, Esc to cancel'));
    console.log();
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const isSelected = i === selectedIndex;
      const prefix = isSelected ? colors.brand('❯ ') : '  ';
      const color = opt.type === 'major' ? colors.action : colors.brand;
      const label = isSelected ? chalk.bold(color(opt.label)) : colors.dim(opt.label);
      console.log(`${prefix}${label}`);
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeyPress = (key: Buffer) => {
      const char = key.toString();

      // Up arrow
      if (char === '\x1b[A') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
      }
      // Down arrow
      else if (char === '\x1b[B') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      }
      // Enter
      else if (char === '\r' || char === '\n') {
        cleanup();
        resolve(options[selectedIndex]);
      }
      // Escape
      else if (char === '\x1b' && key.length === 1) {
        cleanup();
        resolve(null);
      }
      // Ctrl+C
      else if (char === '\x03') {
        cleanup();
        process.exit(0);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };

    process.stdin.on('data', onKeyPress);
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Show project info when already on latest version
 */
async function showLatestVersionInfo(
  apiClient: any,
  sanitized: any,
  framework: string,
  frameworkName: string,
  currentVersion: string | undefined
): Promise<void> {
  try {
    const auditResponse = await apiClient.analyzeAudit(sanitized, framework);
    if (auditResponse.success && auditResponse.data) {
      const healthScore = auditResponse.data.healthScore || 0;
      const packageCount = auditResponse.data.totalPackages || 0;
      const conflicts = auditResponse.data.conflicts || [];
      const issueCount = conflicts.length;
      const healthInfo = getHealthStatus(healthScore);

      console.log();
      console.log(colors.whiteBold('📊 PROJECT OVERVIEW'));
      console.log(colors.gray('─'.repeat(50)));
      console.log(`${colors.whiteBold('🏥 Health:')}  ${renderHealthBar(healthScore)} ${healthInfo.color.bold(`${healthScore}/100`)} (${healthInfo.color(healthInfo.text)})`);
      console.log(`${colors.whiteBold('📦 Packages:')} ${colors.brand(`${packageCount}`)} total`);
      console.log(`${colors.whiteBold('🎯 Version:')} ${colors.success(`${frameworkName} ${currentVersion || 'latest'}`)}`);
      console.log();
      console.log(colors.successBold('✓ You\'re already on the latest supported version!'));
      console.log(colors.dim('  No migration needed.'));

      if (issueCount > 0) {
        console.log();
        console.log(colors.warningBold(`⚠️  ${issueCount} issue${issueCount !== 1 ? 's' : ''} detected in your dependencies`));
        console.log(colors.dim('  Run the following command to analyze and fix:'));
        console.log();
        console.log(`  ${colors.brand('npx depfixer')}`);
      }
    } else {
      console.log();
      printSuccess(`You're already on the latest supported version of ${frameworkName}!`);
    }
  } catch {
    console.log();
    printSuccess(`You're already on the latest supported version of ${frameworkName}!`);
  }
}

/**
 * Handle migration error
 */
async function handleMigrationError(error: any): Promise<void> {
  await analytics.sessionEnded({
    outcome: 'error',
    error: error.message,
  });

  printError(error.message);
  process.exit(1);
}
