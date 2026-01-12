/**
 * CLI Prompt Utilities
 *
 * Provides keyboard-based prompts for CLI interactions.
 * Uses raw mode stdin for immediate key response.
 */
import chalk from 'chalk';
import { colors } from './design-system.js';

/**
 * Simple Enter/Esc prompt (Enter = Yes, Esc = No)
 *
 * Supports:
 * - Enter or 'y'/'Y' → Yes
 * - Esc or 'n'/'N' → No
 * - Ctrl+C → Exit process
 *
 * @param question - Optional question text (can be empty if shown elsewhere)
 * @returns Promise<boolean> - true for yes, false for no
 */
export async function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (question) {
      process.stdout.write(`${question} ${colors.dim('(Enter/Esc)')} `);
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeyPress = (key: Buffer) => {
      const char = key.toString();

      // Enter key
      if (char === '\r' || char === '\n') {
        cleanup();
        console.log(chalk.green('Yes'));
        resolve(true);
      }
      // Escape key
      else if (char === '\x1b' && key.length === 1) {
        cleanup();
        console.log(chalk.red('No'));
        resolve(false);
      }
      // 'y' or 'Y'
      else if (char.toLowerCase() === 'y') {
        cleanup();
        console.log(chalk.green('Yes'));
        resolve(true);
      }
      // 'n' or 'N'
      else if (char.toLowerCase() === 'n') {
        cleanup();
        console.log(chalk.red('No'));
        resolve(false);
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
