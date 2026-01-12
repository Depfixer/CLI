import chalk from 'chalk';
import open from 'open';
import { ApiClient } from './api-client.js';
import { AuthManager } from './auth-manager.js';
import { analytics } from './analytics.js';
import { createSpinner, printError } from '../utils/output.js';
import { printUserDetails } from '../utils/design-system.js';

/**
 * Payment Flow Service
 *
 * Handles the payment/credit flow for CLI:
 * - Auth loop (device code login)
 * - Balance checking
 * - Balance polling with timeout
 * - Credit deduction
 */
export class PaymentFlowService {
  private readonly apiClient: ApiClient;
  private readonly authManager: AuthManager;
  private readonly webUrl: string;

  constructor() {
    this.apiClient = new ApiClient();
    this.authManager = new AuthManager();
    this.webUrl = process.env.DEPFIXER_WEB_URL || 'https://app.depfixer.com';
  }

  /**
   * Run the complete payment flow:
   * 1. Check auth (login if needed)
   * 2. Check balance (wait for top-up if needed)
   * 3. Return user info if ready to proceed
   */
  async ensureReadyToPay(cost: number): Promise<{
    ready: boolean;
    name?: string;
    email?: string;
    credits?: number;
    hasActivePass?: boolean;
    wasAlreadyLoggedIn?: boolean;
  }> {
    // Step 1: Ensure authenticated
    const authResult = await this.ensureAuthenticated();
    if (!authResult.success) {
      return { ready: false };
    }

    // Step 2: Ensure sufficient balance
    const hasBalance = await this.ensureSufficientBalance(cost);
    if (!hasBalance) {
      return { ready: false };
    }

    // Get final balance info (includes name and email)
    const balanceInfo = await this.getBalanceInfo();

    return {
      ready: true,
      name: balanceInfo?.name,
      email: balanceInfo?.email || authResult.email,
      credits: balanceInfo?.credits,
      hasActivePass: balanceInfo?.hasActivePass,
      wasAlreadyLoggedIn: authResult.wasAlreadyLoggedIn,
    };
  }

  /**
   * Ensure user is authenticated
   * Runs device code flow if not logged in
   * Returns user info on success
   */
  async ensureAuthenticated(): Promise<{ success: boolean; email?: string; wasAlreadyLoggedIn?: boolean }> {
    if (await this.authManager.isAuthenticated()) {
      return { success: true, wasAlreadyLoggedIn: true };
    }

    console.log();
    console.log(chalk.bold('🔐 AUTHENTICATION REQUIRED'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log();

    // Ask if user has an account
    const authChoice = await this.promptAuthChoice();

    if (authChoice === 'register') {
      // Open registration page
      const registerUrl = `${this.webUrl}/register?from=cli`;
      console.log();
      console.log(chalk.cyan('Opening registration page...'));

      try {
        await open(registerUrl);
        console.log(chalk.dim('Browser opened. Create your account, then return here.'));
      } catch {
        console.log(chalk.yellow(`Please visit: ${registerUrl}`));
      }

      console.log();
      const ready = await this.promptYesNo('Account created? Ready to login?');
      if (!ready) {
        return { success: false };
      }
    }

    // Run device code login flow
    const result = await this.runDeviceCodeFlow();
    return { success: result.success, email: result.email, wasAlreadyLoggedIn: false };
  }

  /**
   * Prompt user to choose login or register with arrow key selection
   */
  private async promptAuthChoice(): Promise<'login' | 'register'> {
    const options = [
      { value: 'login' as const, label: 'Login', description: 'I have an account' },
      { value: 'register' as const, label: 'Register', description: 'Create new account' },
    ];

    return new Promise((resolve) => {
      let selectedIndex = 0;

      const render = () => {
        // Move cursor up to redraw
        process.stdout.write(`\x1b[${options.length + 1}A`);

        console.log(chalk.dim('  Use ↑↓ arrows, Enter to confirm'));
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          const isSelected = i === selectedIndex;
          const prefix = isSelected ? chalk.cyan('❯ ') : '  ';
          const label = isSelected
            ? chalk.bold.white(opt.label) + chalk.dim(` - ${opt.description}`)
            : chalk.dim(opt.label + ` - ${opt.description}`);
          console.log(`${prefix}${label}`);
        }
      };

      // Initial render
      console.log(chalk.dim('  Use ↑↓ arrows, Enter to confirm'));
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? chalk.cyan('❯ ') : '  ';
        const label = isSelected
          ? chalk.bold.white(opt.label) + chalk.dim(` - ${opt.description}`)
          : chalk.dim(opt.label + ` - ${opt.description}`);
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
          console.log(chalk.green(`✓ ${options[selectedIndex].label}`));
          resolve(options[selectedIndex].value);
        }
        // Escape - default to login
        else if (char === '\x1b' && key.length === 1) {
          cleanup();
          console.log(chalk.dim('Cancelled'));
          resolve('login');
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

  /**
   * Get current balance info
   */
  async getBalanceInfo(): Promise<{ credits: number; hasActivePass: boolean; name?: string; email?: string } | null> {
    try {
      const response = await this.apiClient.getBalance();
      if (response.success && response.data) {
        return response.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Run device code authentication flow
   * Returns user info on success
   */
  private async runDeviceCodeFlow(): Promise<{ success: boolean; email?: string }> {
    try {
      // Get device code from server
      const response = await this.apiClient.createDeviceCode();
      if (!response.success || !response.data) {
        printError('Failed to initiate login');
        return { success: false };
      }

      const { deviceCode, userCode, verificationUrl, expiresIn, pollInterval } = response.data;

      // Display instructions - DON'T auto-open browser
      console.log();
      console.log(chalk.bold('🔐 LOGIN REQUIRED'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log();
      console.log(chalk.bold('Your Code: ') + chalk.green.bold(userCode));
      console.log();
      const verificationUrlWithCode = `${verificationUrl}?code=${userCode}`;
      console.log(chalk.dim('Go to: ') + chalk.cyan(verificationUrlWithCode));
      console.log(chalk.dim('Code will be auto-filled. Just click Authorize.'));
      console.log();

      // Ask if user wants to open browser
      const shouldOpen = await this.promptYesNo('Open browser now?');

      if (shouldOpen) {
        try {
          await open(verificationUrlWithCode);
          console.log(chalk.dim('Browser opened.'));
        } catch {
          console.log(chalk.yellow('Could not open browser. Please visit the URL manually.'));
        }
      }

      console.log();

      // Poll for completion
      const spinner = createSpinner(`Waiting for authentication... (expires in ${Math.floor(expiresIn / 60)} min)`).start();

      const startTime = Date.now();
      const expiresAt = startTime + expiresIn * 1000;

      while (Date.now() < expiresAt) {
        await this.sleep(pollInterval * 1000);

        try {
          const pollResponse = await this.apiClient.pollDeviceCode(deviceCode);

          if (pollResponse.success && pollResponse.data) {
            if (pollResponse.data.status === 'approved') {
              // Save tokens
              await this.authManager.saveTokens(
                pollResponse.data.accessToken!,
                pollResponse.data.refreshToken!,
                pollResponse.data.expiresIn || 3600
              );

              spinner.succeed('Logged in successfully');

              // Fetch and show user details
              try {
                const balanceResponse = await this.apiClient.getBalance();
                if (balanceResponse.success && balanceResponse.data) {
                  printUserDetails({
                    name: balanceResponse.data.name,
                    email: balanceResponse.data.email,
                    credits: balanceResponse.data.credits,
                    hasActivePass: balanceResponse.data.hasActivePass,
                  });
                }
              } catch {
                // Continue even if balance fetch fails
              }

              return { success: true, email: pollResponse.data.email };
            } else if (pollResponse.data.status === 'denied') {
              spinner.fail('Login denied');
              return { success: false };
            } else if (pollResponse.data.status === 'expired') {
              spinner.fail('Login expired');
              return { success: false };
            }
            // status === 'pending' - keep polling
          }
        } catch (error: any) {
          // Continue polling on errors
        }
      }

      spinner.fail('Login timed out');
      return { success: false };

    } catch (error: any) {
      printError(`Login failed: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Simple Enter/Esc prompt (Enter = Yes, Esc = No)
   */
  private async promptYesNo(question: string): Promise<boolean> {
    return new Promise((resolve) => {
      process.stdout.write(`${question} ${chalk.dim('(Enter/Esc)')} `);

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
        else if (char === '\x1b') {
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

  /**
   * Ensure user has sufficient credits
   * Opens pricing page and polls if insufficient
   * Note: Credit check UI should be shown before calling this method
   */
  async ensureSufficientBalance(cost: number): Promise<boolean> {
    try {
      const response = await this.apiClient.getBalance();

      if (!response.success || !response.data) {
        printError('Failed to check balance');
        return false;
      }

      const { credits, hasActivePass } = response.data;

      // Active pass covers everything
      if (hasActivePass) {
        return true;
      }

      // Sufficient credits
      if (credits >= cost) {
        return true;
      }

      // Insufficient credits - start top-up flow
      return await this.waitForTopUp(cost);

    } catch (error: any) {
      printError(error.message);
      return false;
    }
  }

  /**
   * Wait for user to top up their balance
   * Opens pricing page and polls for 5 minutes
   */
  private async waitForTopUp(requiredCredits: number): Promise<boolean> {
    console.log();
    console.log(chalk.bold.yellow('💳 CREDITS REQUIRED'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log();
    console.log(chalk.white(`You need ${chalk.bold(requiredCredits)} credits to unlock the full solution.`));
    console.log(chalk.dim('This includes exact version fixes for all detected conflicts.'));
    console.log();

    // Track: topup_prompt_shown (user hit the paywall)
    analytics.topupPromptShown({ creditsNeeded: requiredCredits });

    // Ask before opening pricing page
    const pricingUrl = `${this.webUrl}/dashboard/pricing`;
    const shouldOpen = await this.promptYesNo('Open pricing page to add credits?');

    if (shouldOpen) {
      // Track: topup_started (user clicked to go to pricing)
      analytics.topupStarted({ creditsNeeded: requiredCredits });

      try {
        await open(pricingUrl);
        console.log(chalk.dim('Browser opened.'));
      } catch {
        console.log(chalk.yellow('Could not open browser.'));
        console.log(chalk.dim('Visit: ') + chalk.cyan(pricingUrl));
      }
    } else {
      // Track: topup_abandoned (user declined to go to pricing)
      analytics.topupAbandoned({ reason: 'declined_pricing_page', creditsNeeded: requiredCredits });
      console.log();
      console.log(chalk.dim('Visit: ') + chalk.cyan(pricingUrl));
      console.log(chalk.dim('Run `npx depfixer fix` when ready.'));
      return false;
    }

    console.log();

    // Poll for balance update
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const POLL_INTERVAL_MS = 5000; // 5 seconds
    const startTime = Date.now();

    const spinner = createSpinner('Waiting for payment... (5 min timeout)').start();

    while (Date.now() - startTime < TIMEOUT_MS) {
      await this.sleep(POLL_INTERVAL_MS);

      try {
        const response = await this.apiClient.getBalance();

        if (response.success && response.data) {
          const { credits, hasActivePass } = response.data;

          if (hasActivePass) {
            // Track: topup_completed (purchased pass)
            analytics.topupCompleted({ type: 'panic_pass', creditsNeeded: requiredCredits });
            spinner.succeed('Panic Pass activated! Unlimited fixes unlocked.');
            return true;
          }
          if (credits >= requiredCredits) {
            // Track: topup_completed (purchased credits)
            analytics.topupCompleted({ type: 'credits', creditsNeeded: requiredCredits, creditsPurchased: credits });
            spinner.succeed(`Balance updated! (${credits} credits)`);
            return true;
          }

          // Update spinner with remaining time
          const elapsed = Date.now() - startTime;
          const remaining = Math.ceil((TIMEOUT_MS - elapsed) / 60000);
          spinner.text = `Waiting for payment... (${remaining} min remaining)`;
        }
      } catch {
        // Continue polling on errors
      }
    }

    // Track: topup_timeout (user didn't complete payment in time)
    analytics.topupTimeout({ creditsNeeded: requiredCredits });
    spinner.fail('Payment timeout');
    console.log();
    console.log(chalk.yellow('You can run `npx depfixer fix` later to resume.'));
    return false;
  }

  /**
   * Deduct credits for an analysis
   * Returns solution and full analysis data for CLI display
   */
  async deductCredits(analysisId: string, hasActivePass?: boolean): Promise<{
    success: boolean;
    solution?: {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      removals: Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }>;
      engines?: { node?: string; npm?: string };
    };
    // Full analysis data from DB (unfiltered)
    conflicts?: any[];
    missingDependencies?: any[];
    deprecations?: any[];
    healthScore?: number;
    summary?: { critical: number; high: number; medium: number; low: number };
    error?: string;
  }> {
    const spinnerText = hasActivePass ? 'Unlocking solution...' : 'Deducting credits...';
    const spinner = createSpinner(spinnerText).start();

    try {
      const response = await this.apiClient.executeFix(analysisId);

      if (!response.success) {
        spinner.fail('Failed to unlock solution');
        return { success: false, error: response.error };
      }

      // Check if pass was used (from server response)
      if (response.data?.passUsed) {
        spinner.succeed('Solution unlocked (Panic Pass)');
      } else {
        spinner.succeed('Credits deducted');
      }
      return {
        success: true,
        solution: response.data?.solution,
        // Pass through full analysis data from server
        conflicts: response.data?.conflicts,
        missingDependencies: response.data?.missingDependencies,
        deprecations: response.data?.deprecations,
        healthScore: response.data?.healthScore,
        summary: response.data?.summary,
      };

    } catch (error: any) {
      spinner.fail('Failed to deduct credits');
      return { success: false, error: error.message };
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
