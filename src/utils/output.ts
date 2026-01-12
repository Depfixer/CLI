import chalk from 'chalk';
import Table from 'cli-table3';
import ora, { Ora } from 'ora';

/**
 * CLI Output Utilities
 * Provides consistent styling and formatting for CLI output
 */

// Severity colors
const severityColors = {
  critical: chalk.red.bold,
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.blue,
};

/**
 * Get colored severity text
 */
export function colorSeverity(severity: string): string {
  const colorFn = severityColors[severity as keyof typeof severityColors] || chalk.white;
  return colorFn(severity.toUpperCase());
}

/**
 * Print a styled header
 */
export function printHeader(text: string): void {
  console.log();
  console.log(chalk.bold.cyan(text));
  console.log(chalk.dim('-'.repeat(text.length)));
}

/**
 * Print success message
 */
export function printSuccess(message: string): void {
  console.log(chalk.green('✓ ') + message);
}

/**
 * Print error message
 */
export function printError(message: string): void {
  console.log(chalk.red('✗ ') + message);
}

/**
 * Print warning message
 */
export function printWarning(message: string): void {
  console.log(chalk.yellow('⚠ ') + message);
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(chalk.blue('ℹ ') + message);
}

/**
 * Create a spinner
 */
export function createSpinner(text: string): Ora {
  return ora({
    text,
    spinner: 'dots',
  });
}

/**
 * Print health score with color coding
 */
export function printHealthScore(score: number): void {
  let color = chalk.green;
  if (score < 50) color = chalk.red;
  else if (score < 70) color = chalk.yellow;
  else if (score < 85) color = chalk.blue;

  console.log();
  console.log(chalk.bold('Health Score: ') + color.bold(`${score}/100`));
}

/**
 * Print severity summary
 */
export function printSeveritySummary(summary: {
  critical: number;
  high: number;
  medium: number;
  low: number;
}): void {
  const parts = [];
  if (summary.critical > 0) parts.push(chalk.red.bold(`${summary.critical} critical`));
  if (summary.high > 0) parts.push(chalk.red(`${summary.high} high`));
  if (summary.medium > 0) parts.push(chalk.yellow(`${summary.medium} medium`));
  if (summary.low > 0) parts.push(chalk.blue(`${summary.low} low`));

  if (parts.length === 0) {
    console.log(chalk.green('No issues found!'));
  } else {
    console.log(`Issues: ${parts.join(', ')}`);
  }
}

/**
 * Create audit mode conflicts table (no recommendedVersion)
 */
export function createAuditTable(conflicts: Array<{
  package: string;
  currentVersion: string;
  severity: string;
  description: string;
}>): string {
  const table = new Table({
    head: [
      chalk.bold('Severity'),
      chalk.bold('Package'),
      chalk.bold('Current'),
      chalk.bold('Issue'),
    ],
    colWidths: [12, 25, 15, 50],
    wordWrap: true,
    chars: {
      'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '',
    },
  });

  for (const conflict of conflicts) {
    table.push([
      colorSeverity(conflict.severity),
      conflict.package,
      conflict.currentVersion,
      conflict.description,
    ]);
  }

  return table.toString();
}

/**
 * Create full mode conflicts table (with recommendedVersion)
 */
export function createFullTable(conflicts: Array<{
  package: string;
  currentVersion: string;
  recommendedVersion: string;
  severity: string;
  description: string;
}>): string {
  const table = new Table({
    head: [
      chalk.bold('Severity'),
      chalk.bold('Package'),
      chalk.bold('Current'),
      chalk.bold('Recommended'),
      chalk.bold('Issue'),
    ],
    colWidths: [12, 22, 13, 13, 40],
    wordWrap: true,
    chars: {
      'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '',
    },
  });

  for (const conflict of conflicts) {
    table.push([
      colorSeverity(conflict.severity),
      conflict.package,
      conflict.currentVersion,
      chalk.green(conflict.recommendedVersion),
      conflict.description,
    ]);
  }

  return table.toString();
}

/**
 * Format change type with symbols and colors
 */
function formatChangeType(type: string, isRemoval?: boolean): string {
  if (isRemoval) {
    return chalk.yellow('✗ Deprec.');
  }
  switch (type?.toLowerCase()) {
    case 'major':
      return chalk.red('▲ Major');
    case 'minor':
      return chalk.cyan('~ Minor');
    case 'patch':
      return chalk.green('• Patch');
    default:
      return chalk.gray(type || '');
  }
}

/**
 * Create migration table (clean, without Reason column)
 */
export function createMigrationTable(corePackages: Array<{
  package: string;
  currentVersion: string;
  targetVersion: string;
  changeType: string;
  isRemoval?: boolean;
}>): string {
  const table = new Table({
    head: [
      chalk.bold('PACKAGE'),
      chalk.bold('CURRENT'),
      chalk.bold('TARGET'),
      chalk.bold('TYPE'),
    ],
    colWidths: [35, 14, 14, 14],
    style: {
      head: [],
      border: ['gray'],
    },
    chars: {
      'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '',
    },
  });

  for (const pkg of corePackages) {
    // Handle target display
    let targetDisplay: string;
    if (pkg.isRemoval) {
      targetDisplay = chalk.red('🗑  REMOVE');
    } else if (!pkg.targetVersion || pkg.targetVersion === pkg.currentVersion) {
      targetDisplay = chalk.dim('Pinned');
    } else {
      targetDisplay = chalk.green(pkg.targetVersion);
    }

    table.push([
      pkg.package,
      pkg.currentVersion,
      targetDisplay,
      formatChangeType(pkg.changeType, pkg.isRemoval),
    ]);
  }

  return table.toString();
}

/**
 * Print upgrade call-to-action box
 */
export function printUpgradeBox(issueCount: number): void {
  const box = `
┌──────────────────────────────────────────────────────────────┐
│  ${chalk.bold.cyan('UPGRADE TO FULL MODE')}                                        │
│  Found ${chalk.bold(issueCount)} issue${issueCount !== 1 ? 's' : ''}. Get specific version recommendations:       │
│                                                              │
│    ${chalk.cyan('npx depfixer login')}                                        │
│    ${chalk.cyan('npx depfixer')}                                              │
└──────────────────────────────────────────────────────────────┘`;
  console.log(box);
}

/**
 * Print cached solution info
 */
export function printCacheInfo(cacheFile: string): void {
  console.log();
  console.log(chalk.green('✨ Solution cached to ') + chalk.cyan(cacheFile));
  console.log(chalk.dim('   Run `npx depfixer fix` anytime to apply (FREE, uses cached solution).'));
}

/**
 * Create a text-based progress bar
 */
export function createProgressBar(percentage: number, width: number = 30): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return `[${bar}] ${percentage}%`;
}

/**
 * Print prefetch progress status
 */
export function printPrefetchProgress(fetchedCount: number, totalPackages: number, percentage: number): void {
  const bar = createProgressBar(percentage);
  process.stdout.write(`\r  Fetching package data: ${bar} (${fetchedCount}/${totalPackages})`);
}

/**
 * Clear the current line (for progress updates)
 */
export function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

/**
 * Run an animated step sequence with spinner
 * Each step displays for a short time before moving to the next
 * For long-running tasks, shows elapsed time after steps complete
 */
export async function runStepSequence(
  steps: string[],
  task: () => Promise<void>,
  options: {
    successMessage?: string | null;
    minStepDuration?: number;
  }
): Promise<void> {
  const startTime = Date.now();
  const minStepDuration = options.minStepDuration || 200;

  let currentStep = 0;
  let completed = false;

  // Start the spinner with first step
  const spinner = ora({
    text: steps[0],
    spinner: 'dots',
    indent: 2,
  }).start();

  // Advance steps periodically, then show elapsed time for long tasks
  const stepInterval = setInterval(() => {
    if (completed) return;
    currentStep++;
    if (currentStep < steps.length) {
      spinner.text = steps[currentStep];
    } else {
      // All steps exhausted - show elapsed time for long-running tasks
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed >= 3) {
        spinner.text = `Processing large project... ${elapsed}s`;
      }
    }
  }, minStepDuration);

  try {
    await task();
    completed = true;
    clearInterval(stepInterval);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (options.successMessage) {
      spinner.succeed(`${options.successMessage} (${elapsed}s)`);
    } else {
      // No success message - just stop the spinner silently
      spinner.stop();
    }
  } catch (error) {
    completed = true;
    clearInterval(stepInterval);
    spinner.fail('Failed');
    throw error;
  }
}

/**
 * Print project info header for analysis
 */
export function printProjectInfo(projectName: string, fileSize: string): void {
  console.log();
  console.log(chalk.dim(`  📦 Project: ${chalk.white(projectName)}`));
  console.log(chalk.dim(`  📋 File:    package.json (${fileSize})`));
  console.log();
}

/**
 * Print migration target header
 */
export function printMigrationHeader(projectName: string, targetFramework: string, targetVersion: string): void {
  console.log();
  console.log(chalk.dim(`  📦 Project: ${chalk.white(projectName)}`));
  console.log(chalk.dim(`  🎯 Target:  ${chalk.cyan(`${targetFramework} ${targetVersion}`)}`));
  console.log();
}

// ============================================================================
// SMOOTH REVEAL UTILITIES
// ============================================================================

/**
 * Sleep helper for delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Print content with a delay before it
 */
export async function printWithDelay(content: string | (() => void), delayMs: number = 100): Promise<void> {
  await sleep(delayMs);
  if (typeof content === 'function') {
    content();
  } else {
    console.log(content);
  }
}

/**
 * Reveal multiple sections with staggered delays
 * Each section is a function that prints content
 */
export async function revealSections(
  sections: Array<() => void>,
  options: { delayBetween?: number; initialDelay?: number } = {}
): Promise<void> {
  const { delayBetween = 150, initialDelay = 50 } = options;

  await sleep(initialDelay);

  for (let i = 0; i < sections.length; i++) {
    sections[i]();
    if (i < sections.length - 1) {
      await sleep(delayBetween);
    }
  }
}

/**
 * Print lines one by one with a typing effect
 */
export async function printLinesAnimated(
  lines: string[],
  options: { delayPerLine?: number; indent?: string } = {}
): Promise<void> {
  const { delayPerLine = 50, indent = '' } = options;

  for (const line of lines) {
    console.log(indent + line);
    await sleep(delayPerLine);
  }
}

/**
 * Animate table rows appearing one by one
 */
export async function printTableAnimated(
  headerFn: () => void,
  rows: Array<() => void>,
  footerFn?: () => void,
  options: { delayPerRow?: number } = {}
): Promise<void> {
  const { delayPerRow = 30 } = options;

  headerFn();

  for (const row of rows) {
    await sleep(delayPerRow);
    row();
  }

  if (footerFn) {
    footerFn();
  }
}
