/**
 * Fix Command
 *
 * Applies fixes from a previous analysis session.
 *
 * Flow:
 * 1. Load session from ~/.depfixer/projects/{hash}/session.json
 * 2. Verify package.json hash matches
 * 3. Check payment status
 * 4. Run payment flow if needed
 * 5. Fetch solution and apply
 */
import chalk from 'chalk';
import { FIX_STEPS } from '../constants/analysis.constants.js';
import { PackageJsonService } from '../services/package-json.js';
import { SessionManager } from '../services/session-manager.js';
import { PaymentFlowService } from '../services/payment-flow.js';
import { ApiClient, NetworkError } from '../services/api-client.js';
import { analytics } from '../services/analytics.js';
import {
  createSpinner,
  printHeader,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  runStepSequence,
} from '../utils/output.js';
import { printCliHeader } from '../utils/design-system.js';
import { promptYesNo } from '../utils/prompt.js';

interface FixOptions {
  path?: string;
}

/**
 * Fix command
 *
 * Applies fixes from a previous analysis session.
 *
 * Usage:
 *   npx depfixer fix
 */
export async function fixCommand(options: FixOptions): Promise<void> {
  const projectDir = options.path || process.cwd();

  // Print CLI header
  printCliHeader();

  // Track: fix_started
  analytics.fixStarted({ command: 'fix' });

  try {
    const sessionManager = new SessionManager(projectDir);
    const packageJsonService = new PackageJsonService();
    const apiClient = new ApiClient();

    // Check for session
    const hasSession = await sessionManager.hasSession();

    if (!hasSession) {
      // Track: fix_cache_missing
      analytics.fixCacheMissing({ reason: 'no_session' });
      printError('No cached analysis found.');
      console.log();
      console.log('Run one of these commands first:');
      console.log(`  ${chalk.cyan('npx depfixer')}`);
      console.log(`  ${chalk.cyan('npx depfixer migrate')}`);
      process.exit(1);
    }

    // Read current package.json
    const spinner = createSpinner('Reading package.json...').start();
    const { content, parsed } = await packageJsonService.read(projectDir);
    spinner.succeed('Package.json loaded');

    // Track: fix_cache_found
    analytics.fixCacheFound({ isSession: true });

    // Handle session flow
    await handleSessionFlow(
      sessionManager,
      packageJsonService,
      apiClient,
      content,
      parsed,
      projectDir
    );

  } catch (error: any) {
    // Track: session_ended (error)
    await analytics.sessionEnded({
      outcome: 'error',
      error: error.message,
    });

    if (error instanceof NetworkError || error.name === 'NetworkError') {
      console.log();
      printError('Network Error');
      console.log(chalk.yellow('Unable to connect to DepFixer server.'));
      console.log();
      console.log('Please check your internet connection and try again.');
      process.exit(1);
    }

    printError(error.message);
    process.exit(1);
  }
}

/**
 * Handle session-based flow with payment
 */
async function handleSessionFlow(
  sessionManager: SessionManager,
  packageJsonService: PackageJsonService,
  apiClient: ApiClient,
  packageJsonContent: string,
  parsed: any,
  projectDir: string
): Promise<void> {
  const session = await sessionManager.loadSession();
  if (!session) {
    printError('Failed to load session');
    process.exit(1);
  }

  // Show session info
  const timeAgo = sessionManager.getTimeSinceAnalysis(session);
  console.log(chalk.dim(`Found analysis from ${timeAgo}`));
  if (session.intent === 'MIGRATE' && session.args?.target) {
    console.log(chalk.dim(`Migration target: v${session.args.target}`));
  }
  console.log();

  // Verify hash
  const hashSpinner = createSpinner('Verifying package.json...').start();
  const hashValid = await sessionManager.verifyHash(packageJsonContent);

  if (!hashValid) {
    hashSpinner.fail('Hash mismatch');
    console.log();
    printWarning('package.json has changed since analysis.');

    const shouldContinue = await promptYesNo('Apply anyway?');
    if (!shouldContinue) {
      console.log();
      printInfo('Run `npx depfixer` to re-analyze with current package.json.');
      process.exit(0);
    }
    console.log();
  } else {
    hashSpinner.succeed('Package.json verified');
  }

  // Check payment status
  if (session.status === 'UNPAID') {
    await handleUnpaidSession(sessionManager, packageJsonService, parsed, projectDir, session);
  } else {
    // Already paid - just fetch and apply solution
    await handlePaidSession(sessionManager, packageJsonService, apiClient, parsed, projectDir, session);
  }
}

/**
 * Handle unpaid session - run payment flow first
 */
async function handleUnpaidSession(
  sessionManager: SessionManager,
  packageJsonService: PackageJsonService,
  parsed: any,
  projectDir: string,
  session: any
): Promise<void> {
  console.log();
  console.log(chalk.yellow(`💰 Cost: ${session.cost} credit${session.cost > 1 ? 's' : ''} (${session.tierName})`));
  console.log();

  const shouldPay = await promptYesNo(
    `Pay ${session.cost} credit${session.cost > 1 ? 's' : ''} and apply fix?`
  );

  if (!shouldPay) {
    console.log();
    printInfo('Run `npx depfixer fix` when ready.');
    process.exit(0);
  }

  // Payment flow
  const paymentFlow = new PaymentFlowService();
  const paymentResult = await paymentFlow.ensureReadyToPay(session.cost);

  if (!paymentResult.ready) {
    console.log();
    printInfo('Run `npx depfixer fix` when ready.');
    process.exit(0);
  }

  // Execute fix: deduct credits and get solution
  showFixExplanation();
  console.log();
  console.log(chalk.bold('🔧 Applying fixes...'));
  console.log();

  const fixResult = await paymentFlow.deductCredits(session.analysisId, paymentResult.hasActivePass);
  if (!fixResult.success || !fixResult.solution) {
    printError('Failed to apply fixes');
    throw new Error(fixResult.error || 'Unknown error');
  }

  // Apply solution
  const solution = fixResult.solution;
  const changes = packageJsonService.getChanges(parsed, solution);
  const removals = solution.removals || [];

  if (changes.length === 0 && removals.length === 0) {
    printSuccess('No changes needed - package.json is already up to date!');
    await sessionManager.updateStatus('PAID');
    return;
  }

  let applyResult: { backupPath: string; applied: number; removed: number; enginesUpdated: number };

  await runStepSequence(
    [...FIX_STEPS],
    async () => {
      applyResult = await packageJsonService.applySurgicalFixes(
        projectDir,
        changes,
        removals,
        solution.engines
      );
    },
    { successMessage: 'Fix complete', minStepDuration: 100 }
  );

  const { backupPath, applied, removed, enginesUpdated } = applyResult!;

  // Update session
  await sessionManager.updateStatus('PAID');

  // Track: fix_applied
  analytics.fixApplied({
    updatedCount: applied,
    removedCount: removed,
    enginesUpdated,
  });

  // Track: session_ended (successful fix)
  await analytics.sessionEnded({
    outcome: 'fix_applied',
  });

  showSuccessMessage(changes, removals, backupPath, enginesUpdated);
}

/**
 * Handle already-paid session - just fetch and apply
 */
async function handlePaidSession(
  sessionManager: SessionManager,
  packageJsonService: PackageJsonService,
  apiClient: ApiClient,
  parsed: any,
  projectDir: string,
  session: any
): Promise<void> {
  const solutionSpinner = createSpinner('Fetching solution...').start();

  try {
    const response = await apiClient.getSolution(session.analysisId);
    if (!response.success || !response.data?.solution) {
      solutionSpinner.fail('Failed to fetch solution');
      printError('Could not retrieve solution. The analysis may have expired.');
      console.log();
      console.log(`Run ${chalk.cyan('npx depfixer')} to create a new analysis.`);
      process.exit(1);
    }

    const solution = response.data.solution;
    if (!solution.removals) solution.removals = [];

    solutionSpinner.succeed('Solution fetched');

    // Apply solution
    const changes = packageJsonService.getChanges(parsed, solution);
    const removals = solution.removals || [];

    if (changes.length === 0 && removals.length === 0) {
      printSuccess('No changes needed - package.json is already up to date!');
      return;
    }

    showChangesPreview(changes, removals);
    showFixExplanation();

    console.log();
    console.log(chalk.bold('🔧 Applying fixes...'));
    console.log();

    let applyResult: { backupPath: string; applied: number; removed: number; enginesUpdated: number };

    await runStepSequence(
      [...FIX_STEPS],
      async () => {
        applyResult = await packageJsonService.applySurgicalFixes(
          projectDir,
          changes,
          removals,
          solution.engines
        );
      },
      { successMessage: 'Fix complete', minStepDuration: 100 }
    );

    const { backupPath, applied, removed, enginesUpdated } = applyResult!;

    // Track: fix_applied
    analytics.fixApplied({
      updatedCount: applied,
      removedCount: removed,
      enginesUpdated,
    });

    // Track: session_ended (successful fix)
    await analytics.sessionEnded({
      outcome: 'fix_applied',
    });

    showSuccessMessage(changes, removals, backupPath, enginesUpdated);

  } catch (error: any) {
    if (error instanceof NetworkError || error.name === 'NetworkError') {
      throw error;
    }

    printError(error.message);
    process.exit(1);
  }
}

/**
 * Show explanation of what will be changed
 */
function showFixExplanation(): void {
  console.log();
  console.log(chalk.dim('────────────────────────────────────────'));
  console.log(chalk.dim('  📝 Only ') + chalk.white('package.json') + chalk.dim(' will be modified'));
  console.log(chalk.dim('  💾 A backup (') + chalk.white('package.json.bak') + chalk.dim(') will be created'));
  console.log(chalk.dim('────────────────────────────────────────'));
}

/**
 * Show preview of changes
 */
function showChangesPreview(
  changes: Array<{ package: string; from: string; to: string; type: string }>,
  removals: Array<{ package: string; reason: string; type: string }>
): void {
  const totalOperations = changes.length + removals.length;
  printHeader(`Applying ${totalOperations} fixes`);
  console.log();

  const depChanges = changes.filter(c => c.type === 'dependency');
  const devDepChanges = changes.filter(c => c.type === 'devDependency');

  if (depChanges.length > 0) {
    console.log(chalk.bold('  dependencies:'));
    for (const change of depChanges) {
      console.log(`    ${change.package}: ${chalk.red(change.from)} → ${chalk.green(change.to)}`);
    }
  }

  if (devDepChanges.length > 0) {
    if (depChanges.length > 0) console.log();
    console.log(chalk.bold('  devDependencies:'));
    for (const change of devDepChanges) {
      console.log(`    ${change.package}: ${chalk.red(change.from)} → ${chalk.green(change.to)}`);
    }
  }

  if (removals.length > 0) {
    if (depChanges.length > 0 || devDepChanges.length > 0) console.log();
    console.log(chalk.bold('  Packages to remove (deprecated):'));
    for (const removal of removals) {
      const typeLabel = removal.type === 'devDependency' ? 'dev' : 'dep';
      console.log(`    ${chalk.red('✗')} ${removal.package} ${chalk.dim(`(${typeLabel})`)} - ${chalk.yellow(removal.reason)}`);
    }
  }
  console.log();
}

/**
 * Show success message
 */
function showSuccessMessage(
  changes: Array<any>,
  removals: Array<any>,
  backupPath: string,
  enginesUpdated?: number
): void {
  console.log();
  printSuccess('Fixes applied successfully!');
  console.log();
  console.log(`  ${chalk.green('✓')} ${changes.length} package${changes.length === 1 ? '' : 's'} updated`);
  if (removals.length > 0) {
    console.log(`  ${chalk.green('✓')} ${removals.length} package${removals.length === 1 ? '' : 's'} removed`);
  }
  if (enginesUpdated && enginesUpdated > 0) {
    console.log(`  ${chalk.green('✓')} ${enginesUpdated} engine${enginesUpdated === 1 ? '' : 's'} updated (Node.js/npm)`);
  }
  console.log();
  printInfo(`Backup created: ${chalk.cyan(backupPath)}`);
  console.log();
  console.log('Next steps:');
  console.log(`  1. Review changes in ${chalk.cyan('package.json')}`);
  console.log(`  2. Run ${chalk.cyan('npm install')} to update node_modules`);
  console.log();
  console.log(`To restore the original: ${chalk.cyan('mv package.json.bak package.json')}`);
}
