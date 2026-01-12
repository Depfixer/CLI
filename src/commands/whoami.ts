import { ApiClient } from '../services/api-client.js';
import { AuthManager } from '../services/auth-manager.js';
import { analytics } from '../services/analytics.js';
import {
  printError,
  printInfo,
  createSpinner,
} from '../utils/output.js';
import {
  colors,
  printCliHeader,
  printUserDetails,
} from '../utils/design-system.js';

/**
 * Whoami command
 *
 * Shows the currently connected user's details:
 * - Name
 * - Email
 * - Credit balance
 * - Active pass status
 *
 * Usage:
 *   npx depfixer whoami
 */
export async function whoamiCommand(): Promise<void> {
  const apiClient = new ApiClient();
  const authManager = new AuthManager();

  // Track: whoami_executed
  analytics.whoamiExecuted();

  // Print CLI header
  printCliHeader();

  // Check if authenticated
  if (!(await authManager.isAuthenticated())) {
    console.log();
    printInfo('Not logged in.');
    console.log();
    console.log(colors.dim('Run the following command to sign in:'));
    console.log(`    ${colors.brand('npx depfixer login')}`);
    console.log();
    return;
  }

  // Fetch user details
  const spinner = createSpinner('Fetching account details...').start();

  try {
    const response = await apiClient.getBalance();

    if (!response.success || !response.data) {
      spinner.fail('Failed to fetch account details');
      printError(response.error || 'Could not fetch account details');
      return;
    }

    spinner.succeed('Account details loaded');

    const { name, email, credits, hasActivePass } = response.data;

    // Show user details
    printUserDetails({
      name,
      email,
      credits,
      hasActivePass,
      showHeader: false,
    });

    console.log();
    console.log(colors.dim('Commands:'));
    console.log(`    ${colors.brand('npx depfixer logout')}  Sign out`);
    console.log(`    ${colors.brand('npx depfixer')}         Run smart analysis`);
    console.log();

  } catch (error: any) {
    spinner.fail('Failed to fetch account details');
    printError(error.message);
  }
}
