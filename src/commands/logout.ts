import chalk from 'chalk';
import { AuthManager } from '../services/auth-manager.js';
import { analytics } from '../services/analytics.js';
import { printSuccess, printInfo } from '../utils/output.js';
import { printCliHeader } from '../utils/design-system.js';

/**
 * Logout command
 *
 * Clears stored credentials
 */
export async function logoutCommand(): Promise<void> {
  const authManager = new AuthManager();

  // Print CLI header
  printCliHeader();

  // Check if logged in
  if (!await authManager.isAuthenticated()) {
    printInfo('You are not logged in.');
    return;
  }

  // Clear credentials
  await authManager.clearCredentials();

  // Track: logout_executed
  analytics.logoutExecuted();

  printSuccess('Successfully logged out.');
  console.log();
  console.log(`Run ${chalk.cyan('npx depfixer login')} to sign in again.`);
}
