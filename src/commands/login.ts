import open from 'open';
import { ApiClient } from '../services/api-client.js';
import { AuthManager } from '../services/auth-manager.js';
import { analytics } from '../services/analytics.js';
import {
  createSpinner,
  printError,
  printInfo,
} from '../utils/output.js';
import { colors, printCliHeader, printUserDetails } from '../utils/design-system.js';

/**
 * Login command
 *
 * Implements Vercel-style device authorization flow:
 * 1. Generate device code + user code
 * 2. Open browser for user to enter code
 * 3. Poll until approved
 * 4. Save tokens locally
 */
export async function loginCommand(): Promise<void> {
  const apiClient = new ApiClient();
  const authManager = new AuthManager();

  // Track: login_started
  analytics.loginStarted({ command: 'login' });

  // Check if already logged in
  if (await authManager.isAuthenticated()) {
    printInfo('You are already logged in.');
    console.log(`Run ${colors.brand('npx depfixer logout')} to sign out.`);
    return;
  }

  // Show CLI header
  printCliHeader();

  try {
    // Step 1: Generate device code
    const spinner = createSpinner('Generating login code...').start();
    const response = await apiClient.createDeviceCode();

    if (!response.success || !response.data) {
      spinner.fail('Failed to generate login code');
      throw new Error(response.error || 'Unknown error');
    }

    spinner.succeed('Login code generated');

    const { deviceCode, userCode, verificationUrl, expiresIn, pollInterval } = response.data;

    // Step 2: Show user code and open browser
    // Append code to URL for auto-fill
    const verificationUrlWithCode = `${verificationUrl}?code=${userCode}`;

    console.log();
    console.log(colors.whiteBold('🔐 LOGIN'));
    console.log(colors.gray('─'.repeat(40)));
    console.log();
    console.log(colors.whiteBold('Your Code: ') + colors.brandBold(userCode));
    console.log();
    console.log(colors.dim('Go to: ') + colors.brand(verificationUrlWithCode));
    console.log(colors.dim('Code will be auto-filled. Just click Authorize.'));
    console.log();

    // Track: device_code_shown
    analytics.deviceCodeShown({ expiresIn });

    // Ask before opening browser
    const shouldOpen = await promptYesNo('Open browser now?');

    if (shouldOpen) {
      try {
        await open(verificationUrlWithCode);
        console.log(colors.dim('Browser opened.'));
      } catch {
        console.log(colors.warning('Could not open browser. Please visit the URL manually.'));
      }
    }

    console.log();

    // Step 3: Poll for approval
    console.log();
    const pollSpinner = createSpinner('Waiting for approval...').start();
    const expiresAt = Date.now() + expiresIn * 1000;

    while (Date.now() < expiresAt) {
      // Wait for poll interval
      await sleep(pollInterval * 1000);

      try {
        const pollResponse = await apiClient.pollDeviceCode(deviceCode);

        if (!pollResponse.success) {
          continue; // Keep polling
        }

        const status = pollResponse.data?.status;

        if (status === 'approved') {
          pollSpinner.succeed('Login approved!');

          // Save tokens
          const { accessToken, refreshToken, expiresIn: tokenExpiresIn } = pollResponse.data!;
          await authManager.saveTokens(accessToken!, refreshToken!, tokenExpiresIn!);

          // Track: login_success
          analytics.loginSuccess();

          // Link anonymous analyses from this device to the logged-in user (silent - no error shown)
          try {
            await apiClient.linkDeviceToUser();
          } catch {
            // Ignore errors - linking is not critical
          }

          // Fetch and show user details
          try {
            const balanceResponse = await apiClient.getBalance();
            if (balanceResponse.success && balanceResponse.data) {
              printUserDetails({
                name: balanceResponse.data.name,
                email: balanceResponse.data.email,
                credits: balanceResponse.data.credits,
                hasActivePass: balanceResponse.data.hasActivePass,
              });
            }
          } catch {
            // Fallback if balance fetch fails
            console.log();
            console.log(colors.successBold('✓ Logged in successfully'));
          }

          console.log();
          console.log(colors.whiteBold('Try these commands:'));
          console.log(`  ${colors.brand('npx depfixer')}            Smart analysis with fix`);
          console.log(`  ${colors.brand('npx depfixer migrate 19')} Migration to Angular 19`);
          console.log(`  ${colors.brand('npx depfixer whoami')}     View account details`);
          return;
        }

        if (status === 'expired') {
          // Track: login_failed
          analytics.loginFailed({ reason: 'expired' });
          pollSpinner.fail('Login code expired');
          throw new Error('Login code expired. Please try again.');
        }

        if (status === 'denied') {
          // Track: login_failed
          analytics.loginFailed({ reason: 'denied' });
          pollSpinner.fail('Login denied');
          throw new Error('Login was denied. Please try again.');
        }

        // status === 'pending', keep polling
      } catch (error: any) {
        // Network error, keep polling
        if (error.message.includes('expired') || error.message.includes('denied')) {
          throw error;
        }
      }
    }

    // Timeout
    // Track: login_failed
    analytics.loginFailed({ reason: 'timeout' });
    pollSpinner.fail('Login timed out');
    throw new Error('Login timed out. Please try again.');

  } catch (error: any) {
    // Track: login_cancelled (if not already tracked as failed)
    if (!error.message.includes('expired') && !error.message.includes('denied') && !error.message.includes('timed out')) {
      analytics.loginCancelled({ reason: error.message });
    }
    printError(error.message);
    process.exit(1);
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simple Enter/Esc prompt (Enter = Yes, Esc = No)
 */
async function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(`${question} ${colors.dim('(Enter/Esc)')} `);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeyPress = (key: Buffer) => {
      const char = key.toString();

      // Enter key
      if (char === '\r' || char === '\n') {
        cleanup();
        console.log(colors.success('Yes'));
        resolve(true);
      }
      // Escape key
      else if (char === '\x1b') {
        cleanup();
        console.log(colors.danger('No'));
        resolve(false);
      }
      // 'y' or 'Y'
      else if (char.toLowerCase() === 'y') {
        cleanup();
        console.log(colors.success('Yes'));
        resolve(true);
      }
      // 'n' or 'N'
      else if (char.toLowerCase() === 'n') {
        cleanup();
        console.log(colors.danger('No'));
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
