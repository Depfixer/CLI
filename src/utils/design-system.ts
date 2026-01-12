/**
 * DepFixer CLI Design System
 *
 * A consistent visual language for the premium "hacker-chic" CLI experience.
 */
import chalk from 'chalk';
import boxen from 'boxen';
import { CLI_VERSION } from '../version.js';

// ============================================================================
// BRAND COLORS
// ============================================================================
export const colors = {
  // Primary brand color (matches web logo)
  brand: chalk.hex('#00D4FF'),
  brandBold: chalk.bold.hex('#00D4FF'),

  // Secondary
  dim: chalk.dim,
  gray: chalk.gray,
  white: chalk.white,
  whiteBold: chalk.bold.white,

  // Actions
  action: chalk.yellow,
  actionBold: chalk.bold.yellow,

  // Status
  success: chalk.green,
  successBold: chalk.bold.green,
  danger: chalk.red,
  dangerBold: chalk.bold.red,
  warning: chalk.yellow,
  warningBold: chalk.bold.yellow,

  // Semantic
  version: chalk.green,
  versionOld: chalk.red,
  major: chalk.red,
  minor: chalk.yellow,
  patch: chalk.blue,
};

// ============================================================================
// HEADER
// ============================================================================

// ASCII art logo - DepFixer text (medium size)
function getDepFixerLogo(tagline: string): string {
  const c = chalk.hex('#00D4FF'); // cyan brand color

  return `
  ${c('██████╗  ███████╗ ██████╗ ███████╗██╗██╗  ██╗███████╗██████╗')}
  ${c('██╔══██╗ ██╔════╝ ██╔══██╗██╔════╝██║╚██╗██╔╝██╔════╝██╔══██╗')}
  ${c('██║  ██║ █████╗   ██████╔╝█████╗  ██║ ╚███╔╝ █████╗  ██████╔╝')}
  ${c('██║  ██║ ██╔══╝   ██╔═══╝ ██╔══╝  ██║ ██╔██╗ ██╔══╝  ██╔══██╗')}
  ${c('██████╔╝ ███████╗ ██║     ██║     ██║██╔╝ ██╗███████╗██║  ██║')}
  ${c('╚═════╝  ╚══════╝ ╚═╝     ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝')}
  ${chalk.dim('         ' + tagline)}`;
}

export function printCliHeader(mode: 'analyze' | 'migrate' = 'analyze'): void {
  const tagline = mode === 'migrate'
    ? 'Upgrade Fearlessly. We Handle the Rest.'
    : 'Dependency Hell? We\'ve Got the Cure.';
  console.log(getDepFixerLogo(tagline));
  console.log();
  console.log(colors.brandBold('⚡ DepFixer CLI') + colors.gray(` v${CLI_VERSION}`));
  console.log(colors.gray('─'.repeat(50)));
}

export function printSectionHeader(title: string, icon = ''): void {
  console.log();
  console.log(colors.whiteBold(`${icon ? icon + ' ' : ''}${title}`));
  console.log(colors.gray('─'.repeat(50)));
}

// ============================================================================
// HEALTH BAR
// ============================================================================
export function renderHealthBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;

  let barColor: typeof chalk;
  if (score >= 70) {
    barColor = chalk.green;
  } else if (score >= 40) {
    barColor = chalk.yellow;
  } else {
    barColor = chalk.red;
  }

  const bar = barColor('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return `[${bar}]`;
}

export function getHealthStatus(score: number): { text: string; color: typeof chalk } {
  // Thresholds aligned with renderHealthBar: green >= 70, yellow >= 40, red < 40
  if (score >= 70) return { text: 'HEALTHY', color: chalk.green };
  if (score >= 40) return { text: 'WARNING', color: chalk.yellow };
  if (score >= 20) return { text: 'POOR', color: chalk.red };
  return { text: 'CRITICAL', color: chalk.red };
}

// ============================================================================
// COST BOX (The "Receipt")
// ============================================================================
export function printCostBox(options: {
  cost: number;
  tierName: string;
  prompt?: string;
  isMigration?: boolean;
  hasActivePass?: boolean;
}): void {
  const { cost, tierName, prompt, isMigration, hasActivePass } = options;

  const label = isMigration ? 'MIGRATION COST' : 'COST TO ANALYZE';
  const tierLabel = tierName.includes('Tier') ? tierName : `Tier: ${tierName}`;

  let content: string;

  if (hasActivePass) {
    // Panic Pass - show unlimited access (gold theme)
    content =
      `🎫 PANIC PASS:    ${chalk.yellow.bold('UNLIMITED ACCESS')}\n` +
      `📦 PLAN SIZE:     ${colors.white(tierLabel)}\n\n` +
      `${colors.dim('No credits will be deducted.')}`;
  } else {
    content =
      `💰 ${label}:   ${colors.actionBold(`${cost} CREDITS`)}\n` +
      `📦 PLAN SIZE:     ${colors.white(tierLabel)}`;
  }

  console.log();
  console.log(boxen(content, {
    padding: 1,
    margin: { top: 0, bottom: 0, left: 1, right: 1 },
    borderStyle: 'round',
    borderColor: hasActivePass ? 'yellow' : 'cyan',
  }));

  // Add prompt outside the box
  if (prompt) {
    console.log(colors.gray(`[?] ${prompt}`));
  }
}

// ============================================================================
// SUCCESS BOX
// ============================================================================
export function printSuccessBox(options: {
  updated: number;
  removed: number;
  backupPath: string;
  enginesUpdated?: number;
}): void {
  const { updated, removed, backupPath, enginesUpdated } = options;

  console.log();
  console.log(colors.successBold('✨ SUCCESS'));
  console.log(colors.gray('─'.repeat(50)));
  console.log();

  if (updated > 0) {
    console.log(colors.success(`    ✓ ${updated} Package${updated === 1 ? '' : 's'} Updated`));
  }
  if (removed > 0) {
    console.log(colors.success(`    ✓ ${removed} Package${removed === 1 ? '' : 's'} Removed`));
  }
  if (enginesUpdated && enginesUpdated > 0) {
    console.log(colors.success(`    ✓ ${enginesUpdated} Engine${enginesUpdated === 1 ? '' : 's'} Updated (Node.js/npm)`));
  }
  console.log(colors.success(`    ✓ Backup: `) + colors.dim(backupPath));
  console.log();
  console.log(colors.actionBold('    👉 NEXT STEP:'));
  console.log(colors.dim('    Run the following command to finalize changes:'));
  console.log();
  console.log(`    ${colors.brand('$ npm install')}`);
  console.log();
}

// ============================================================================
// PROJECT INFO
// ============================================================================
export function printProjectHeader(name: string, framework?: string, version?: string): void {
  console.log();
  console.log(colors.whiteBold(`📦 PROJECT: ${colors.brand(name)}`));
  if (framework && version) {
    console.log(colors.dim(`   Framework: ${framework} ${version}`));
  } else if (framework) {
    console.log(colors.dim(`   Framework: ${framework}`));
  }
}

// ============================================================================
// MIGRATION HEADER
// ============================================================================
export function printMigrationPlanHeader(
  framework: string,
  fromVersion: string,
  toVersion: string
): void {
  console.log();
  console.log(colors.brandBold(`🚀 MIGRATION PLAN: ${framework} ${fromVersion} → ${toVersion}`));
  console.log(colors.gray('─'.repeat(50)));
}

// ============================================================================
// PROJECTION STATS
// ============================================================================
export function printProjectionStats(options: {
  currentHealth: number;
  projectedHealth: number;
  packageCount: number;
  breakingChanges: number;
}): void {
  const { currentHealth, projectedHealth, packageCount, breakingChanges } = options;

  console.log();
  console.log(colors.whiteBold('📊 Projection:'));

  const currentColor = currentHealth < 40 ? colors.danger : colors.warning;
  const projectedColor = projectedHealth >= 70 ? colors.success : colors.warning;

  console.log(`    • Health:     ${currentColor(`${currentHealth}/100`)} → ${projectedColor(`${projectedHealth}/100`)} (Estimated)`);
  console.log(`    • Packages:   ${packageCount} updates`);

  if (breakingChanges > 0) {
    console.log(`    • Breaking:   ${colors.warning(`⚠️  ${breakingChanges} Major Change${breakingChanges > 1 ? 's' : ''}`)}`);
  }
}

// ============================================================================
// DIAGNOSIS BOX
// ============================================================================
export function printDiagnosis(issueCount: number): void {
  console.log();
  console.log(colors.whiteBold('💡 DIAGNOSIS:'));
  console.log(colors.dim('    Deep dependency graph conflicts detected.'));
  console.log(colors.dim('    Manual resolution is likely to fail.'));
  console.log();
  console.log(colors.whiteBold('🔒 SOLUTION:'));
  console.log(colors.success('    ✓ Deterministic fix calculated.'));
  console.log(colors.dim('    [?] Unlock recommended versions?'));
}

// ============================================================================
// ACCOUNT INFO
// ============================================================================
export function printAccountInfo(options: {
  name?: string;
  email?: string;
  credits: number;
}): void {
  const { name, email, credits } = options;

  console.log();
  console.log(colors.whiteBold('👤 ACCOUNT'));
  console.log(colors.gray('─'.repeat(40)));
  if (name) {
    console.log(`    Name:    ${colors.white(name)}`);
  }
  if (email) {
    console.log(`    Email:   ${colors.brand(email)}`);
  }
  console.log(`    Balance: ${colors.success(`${credits} credits`)}`);
}

/**
 * Print user details after login/register
 * Shows name, email, and current credit balance
 */
export function printUserDetails(options: {
  name?: string;
  email?: string;
  credits: number;
  hasActivePass?: boolean;
  showHeader?: boolean;
}): void {
  const { name, email, credits, hasActivePass, showHeader = true } = options;

  if (showHeader) {
    console.log();
    console.log(colors.successBold('✓ Logged in successfully'));
  }
  console.log();
  console.log(colors.whiteBold('👤 ACCOUNT DETAILS'));
  console.log(colors.gray('─'.repeat(40)));
  if (name) {
    console.log(`    Name:     ${colors.white(name)}`);
  }
  if (email) {
    console.log(`    Email:    ${colors.brand(email)}`);
  }
  if (hasActivePass) {
    console.log(`    Plan:     ${colors.success('24H Unlimited Pass')} ${colors.successBold('✓')}`);
  }
  console.log(`    Credits:  ${colors.actionBold(`${credits}`)} available`);
}

/**
 * Print credit check info showing both needed and available credits
 */
export function printCreditCheck(options: {
  needed: number;
  available: number;
  hasActivePass?: boolean;
}): void {
  const { needed, available, hasActivePass } = options;

  console.log();
  console.log(colors.whiteBold('💳 CREDITS'));
  console.log(colors.gray('─'.repeat(40)));

  if (hasActivePass) {
    console.log(`    Plan:      ${colors.success('24H Unlimited Pass')} ${colors.successBold('✓')}`);
    console.log(`    Cost:      ${colors.dim('Covered by pass')}`);
  } else {
    console.log(`    Available: ${colors.actionBold(`${available}`)} credits`);
    console.log(`    Needed:    ${colors.white(`${needed}`)} credits`);

    if (available >= needed) {
      console.log(`    Status:    ${colors.success('Sufficient balance')} ${colors.successBold('✓')}`);
    } else {
      console.log(`    Status:    ${colors.danger('Insufficient balance')} ${colors.dangerBold('✗')}`);
      console.log(`    Shortfall: ${colors.danger(`${needed - available}`)} credits`);
    }
  }
}

// ============================================================================
// APPLYING CHANGES
// ============================================================================
export function printApplyingHeader(): void {
  console.log();
  console.log(colors.whiteBold('🔧 Applying Patches...'));
}

export function printAppliedChange(packageName: string, action: 'updated' | 'removed'): void {
  const icon = action === 'updated' ? colors.success('✔') : colors.danger('✗');
  const actionText = action === 'updated' ? 'updated' : 'removed';
  console.log(`    ${icon} ${packageName} ${actionText}`);
}

// ============================================================================
// NOTES SECTION
// ============================================================================
export function printNotes(notes: string[]): void {
  if (notes.length === 0) return;

  console.log();
  console.log(colors.whiteBold('💡 NOTES:'));
  for (const note of notes) {
    console.log(`    ${colors.dim(note)}`);
  }
}

// ============================================================================
// SEVERITY BADGE
// ============================================================================
export function getSeverityBadge(severity: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return colors.dangerBold('CRIT');
    case 'high':
      return colors.danger('HIGH');
    case 'medium':
      return colors.warning('MED ');
    case 'low':
      return colors.dim('LOW ');
    default:
      return colors.dim('INFO');
  }
}

// ============================================================================
// CHANGE TYPE BADGE
// ============================================================================
export function getChangeTypeBadge(changeType: string): string {
  switch (changeType?.toLowerCase()) {
    case 'major':
      return colors.major('Major ⚠️');
    case 'minor':
      return colors.minor('Minor');
    case 'patch':
      return colors.patch('Patch');
    case 'deprec':
    case 'deprecated':
      return colors.warning('Deprec.');
    default:
      return colors.dim(changeType || '');
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Truncate text to max length with ellipsis
 */
export function truncateReason(text: string, maxLength: number = 40): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
