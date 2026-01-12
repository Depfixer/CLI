#!/usr/bin/env node

/**
 * DepFixer CLI - Entry Point
 *
 * A command-line tool for analyzing and fixing JavaScript/TypeScript
 * dependency conflicts in your projects.
 *
 * Available Commands:
 *   (default)  - Analyze dependencies and show issues (free audit)
 *   migrate    - Interactive migration to newer framework version
 *   fix        - Apply fixes from a previous analysis
 *   login      - Authenticate with your DepFixer account
 *   logout     - Sign out and clear credentials
 *   whoami     - Show current account details
 *
 * @see https://depfixer.com
 * @see https://docs.depfixer.com
 */

import { program } from 'commander';
import chalk from 'chalk';
import { smartCommand } from './commands/smart.js';
import { migrateCommand } from './commands/migrate.js';
import { fixCommand } from './commands/fix.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';
import { printCliHeader } from './utils/design-system.js';
import { CLI_VERSION } from './version.js';

// ============================================================================
// COMMAND DEFINITIONS
// ============================================================================

/**
 * List of all available commands (used for validation and help)
 */
const AVAILABLE_COMMANDS = ['migrate', 'fix', 'login', 'logout', 'whoami', 'analyze'] as const;

/**
 * Options that require a value (used when parsing arguments)
 */
const OPTIONS_WITH_VALUES = ['--path'];

// ============================================================================
// MAIN PROGRAM SETUP
// ============================================================================

program
  .name('depfixer')
  .description('CLI tool for analyzing and fixing JavaScript/TypeScript dependency conflicts')
  .version(CLI_VERSION, '-v, --version', 'Display version number')
  .helpOption('-h, --help', 'Display help information')
  .addHelpText('beforeAll', () => {
    printCliHeader();
    return '';
  })
  .addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.cyan('npx depfixer')}                   Analyze dependencies (free audit)
  ${chalk.cyan('npx depfixer migrate')}           Interactive migration to newer version
  ${chalk.cyan('npx depfixer fix')}               Apply cached fixes

${chalk.bold('Account:')}
  ${chalk.cyan('npx depfixer login')}             Authenticate with your DepFixer account
  ${chalk.cyan('npx depfixer logout')}            Sign out and clear credentials
  ${chalk.cyan('npx depfixer whoami')}            Show current account details

${chalk.bold('Credit Cost (by project size):')}
  Micro:      0-24 packages     =   5 credits
  Small:      25-49 packages    =  15 credits
  Standard:   50-99 packages    =  35 credits
  Heavy:      100-149 packages  =  55 credits
  Large:      150-499 packages  =  85 credits
  Enterprise: 500-999 packages  = 150 credits
  Titan:      1000+ packages    = 250 credits

${chalk.bold('More info:')}
  Website: ${chalk.blue('https://depfixer.com')}
  Docs:    ${chalk.blue('https://docs.depfixer.com')}
`);

// ============================================================================
// DEFAULT COMMAND OPTIONS
// ============================================================================

/**
 * Default command (no subcommand) - runs the smart analysis
 * Options: --json, --ci, --path
 */
program
  .option('--json', 'Output results as JSON')
  .option('--ci', 'CI mode - exit code 1 if critical/high issues found')
  .option('--path <dir>', 'Path to project directory (default: current directory)');

// ============================================================================
// SUBCOMMANDS
// ============================================================================

/**
 * Migrate Command
 * Interactive migration wizard to upgrade your framework version.
 * Supports Angular and React with version selection UI.
 */
program
  .command('migrate')
  .description('Interactive migration to newer framework version')
  .option('--path <dir>', 'Path to project directory (default: current directory)')
  .addHelpText('after', `
${chalk.bold('Example:')}
  ${chalk.cyan('npx depfixer migrate')}
`)
  .action(migrateCommand);

/**
 * Fix Command
 * Applies fixes from a previous analysis session.
 * Requires running 'depfixer' or 'depfixer migrate' first.
 */
program
  .command('fix')
  .description('Apply fixes from cached analysis')
  .option('--path <dir>', 'Path to project directory (default: current directory)')
  .addHelpText('after', `
${chalk.bold('Note:')}
  Requires a prior ${chalk.cyan('npx depfixer')} or ${chalk.cyan('npx depfixer migrate')} run.

${chalk.bold('Example:')}
  ${chalk.cyan('npx depfixer fix')}
`)
  .action(fixCommand);

/**
 * Login Command
 * Authenticates using device code flow (similar to GitHub CLI).
 * Opens browser for secure authentication.
 */
program
  .command('login')
  .description('Authenticate with DepFixer (device code flow)')
  .addHelpText('after', `
${chalk.bold('How it works:')}
  1. Generates a unique code
  2. Opens browser for you to enter the code
  3. Links your CLI to your DepFixer account

${chalk.bold('Example:')}
  ${chalk.cyan('npx depfixer login')}
`)
  .action(loginCommand);

/**
 * Logout Command
 * Clears stored credentials from ~/.depfixer/
 */
program
  .command('logout')
  .description('Sign out and clear stored credentials')
  .action(logoutCommand);

/**
 * Whoami Command
 * Shows current authenticated user info and credit balance.
 */
program
  .command('whoami')
  .description('Show current user account details')
  .action(whoamiCommand);

/**
 * Analyze Command (Hidden)
 * Backward compatibility alias for the default smart command.
 */
program
  .command('analyze', { hidden: true })
  .description('Analyze dependencies (alias for default command)')
  .option('--json', 'Output results as JSON')
  .option('--ci', 'CI mode - exit code 1 if critical/high issues found')
  .option('--path <dir>', 'Path to project directory (default: current directory)')
  .action(smartCommand);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Displays error message for unknown commands with available options.
 * @param command - The unknown command that was entered
 */
function showUnknownCommandError(command: string): void {
  printCliHeader();
  console.error(chalk.red(`\n  Error: Unknown command '${command}'`));
  console.log();
  console.log(chalk.bold('  Available commands:'));
  console.log(`    ${chalk.cyan('depfixer')}          Analyze dependencies (default)`);
  console.log(`    ${chalk.cyan('depfixer migrate')}  Interactive migration`);
  console.log(`    ${chalk.cyan('depfixer fix')}      Apply cached fixes`);
  console.log(`    ${chalk.cyan('depfixer login')}    Authenticate`);
  console.log(`    ${chalk.cyan('depfixer logout')}   Sign out`);
  console.log(`    ${chalk.cyan('depfixer whoami')}   Account details`);
  console.log();
  console.log(`  Run ${chalk.cyan('depfixer --help')} for more information.`);
  console.log();
  process.exit(1);
}

/**
 * Displays error for unexpected positional arguments.
 * @param command - The command that received unexpected args
 * @param arg - The unexpected argument
 */
function showUnexpectedArgError(command: string, arg: string): void {
  printCliHeader();
  console.error(chalk.red(`\n  Error: Unexpected argument '${arg}' for command '${command}'`));
  console.log();
  console.log(`  The ${chalk.cyan(command)} command does not accept positional arguments.`);
  console.log(`  Run ${chalk.cyan(`depfixer ${command} --help`)} for usage information.`);
  console.log();
  process.exit(1);
}

// Handle unknown commands from Commander
program.on('command:*', (operands) => {
  showUnknownCommandError(operands[0]);
});

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

/**
 * Extracts positional arguments from command args (excluding option values).
 * Used to detect when user passes unexpected arguments like "migrate 12".
 *
 * @param cmdArgs - Array of command line arguments
 * @returns Array of positional (non-option) arguments
 */
function getPositionalArgs(cmdArgs: string[]): string[] {
  const positional: string[] = [];
  let skipNext = false;

  for (const arg of cmdArgs) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (OPTIONS_WITH_VALUES.includes(arg)) {
      skipNext = true;
      continue;
    }
    if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  return positional;
}

/**
 * Parses command line options manually for the default command.
 * @param args - Raw command line arguments
 * @returns Parsed options object
 */
function parseDefaultOptions(args: string[]): Record<string, any> {
  const opts: Record<string, any> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--ci') opts.ci = true;
    else if (arg === '--path' && args[i + 1]) {
      opts.path = args[++i];
    }
  }
  return opts;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

const args = process.argv.slice(2);
const firstArg = args[0];

// No arguments - run default smart command
if (args.length === 0) {
  smartCommand({}).catch((err) => {
    console.error(chalk.red('Error:'), err.message);
    process.exit(1);
  });
}
// Help or version flags - let Commander handle
else if (args.includes('-h') || args.includes('--help') || args.includes('-v') || args.includes('--version')) {
  program.parse();
}
// Known subcommand
else if (AVAILABLE_COMMANDS.includes(firstArg as any)) {
  const positionalArgs = getPositionalArgs(args.slice(1));
  if (positionalArgs.length > 0) {
    showUnexpectedArgError(firstArg, positionalArgs[0]);
  }
  program.parse();
}
// Unknown command (not an option)
else if (!firstArg.startsWith('-')) {
  showUnknownCommandError(firstArg);
}
// Options only (--json, --ci, --path) - run default smart command
else {
  const opts = parseDefaultOptions(args);
  smartCommand(opts).catch((err) => {
    console.error(chalk.red('Error:'), err.message);
    process.exit(1);
  });
}
