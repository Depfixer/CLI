/**
 * Animated Print Utilities
 *
 * Centralized, reusable print functions with AI-style typing effects.
 * Use these for a smooth, step-by-step reveal experience.
 */

import chalk from 'chalk';

// Default timing configuration
const DEFAULT_CHAR_DELAY = 8;      // ms per character
const DEFAULT_WORD_DELAY = 30;     // ms per word
const DEFAULT_LINE_DELAY = 50;     // ms per line
const DEFAULT_SECTION_DELAY = 150; // ms between sections

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Print text character by character (typewriter effect)
 */
export async function printChars(
  text: string,
  options: { delay?: number; newline?: boolean } = {}
): Promise<void> {
  const { delay = DEFAULT_CHAR_DELAY, newline = true } = options;

  for (const char of text) {
    process.stdout.write(char);
    if (delay > 0) await sleep(delay);
  }

  if (newline) {
    console.log();
  }
}

/**
 * Print text word by word
 */
export async function printWords(
  text: string,
  options: { delay?: number; newline?: boolean } = {}
): Promise<void> {
  const { delay = DEFAULT_WORD_DELAY, newline = true } = options;
  const words = text.split(' ');

  for (let i = 0; i < words.length; i++) {
    process.stdout.write(words[i]);
    if (i < words.length - 1) {
      process.stdout.write(' ');
    }
    if (delay > 0) await sleep(delay);
  }

  if (newline) {
    console.log();
  }
}

/**
 * Print a single line with optional delay before
 */
export async function printLine(
  text: string,
  options: { delayBefore?: number; delayAfter?: number } = {}
): Promise<void> {
  const { delayBefore = 0, delayAfter = 0 } = options;

  if (delayBefore > 0) await sleep(delayBefore);
  console.log(text);
  if (delayAfter > 0) await sleep(delayAfter);
}

/**
 * Print multiple lines with staggered delays
 */
export async function printLines(
  lines: string[],
  options: { delay?: number; initialDelay?: number } = {}
): Promise<void> {
  const { delay = DEFAULT_LINE_DELAY, initialDelay = 0 } = options;

  if (initialDelay > 0) await sleep(initialDelay);

  for (let i = 0; i < lines.length; i++) {
    console.log(lines[i]);
    if (i < lines.length - 1 && delay > 0) {
      await sleep(delay);
    }
  }
}

/**
 * Print a section with header and content
 */
export async function printSection(
  header: string,
  content: string | string[],
  options: {
    headerDelay?: number;
    contentDelay?: number;
    icon?: string;
  } = {}
): Promise<void> {
  const {
    headerDelay = DEFAULT_SECTION_DELAY,
    contentDelay = DEFAULT_LINE_DELAY,
    icon = ''
  } = options;

  // Print header
  await sleep(headerDelay);
  console.log(icon ? `${icon} ${header}` : header);

  // Print content
  const lines = Array.isArray(content) ? content : [content];
  for (const line of lines) {
    await sleep(contentDelay);
    console.log(line);
  }
}

/**
 * Print table rows one by one
 */
export async function printTableAnimated(
  rows: string[],
  options: { rowDelay?: number; headerRows?: number } = {}
): Promise<void> {
  const { rowDelay = 35, headerRows = 3 } = options;

  for (let i = 0; i < rows.length; i++) {
    console.log(rows[i]);
    // Faster for header rows, slower for data rows
    if (i < headerRows) {
      await sleep(rowDelay / 2);
    } else {
      await sleep(rowDelay);
    }
  }
}

/**
 * Print with a reveal effect (fade in simulation via delay)
 */
export async function printReveal(
  text: string,
  options: { delay?: number } = {}
): Promise<void> {
  const { delay = 100 } = options;
  await sleep(delay);
  console.log(text);
}

/**
 * Print a progress indicator while waiting
 */
export async function printProgress(
  items: string[],
  options: { delay?: number; prefix?: string } = {}
): Promise<void> {
  const { delay = 200, prefix = '  ' } = options;

  for (const item of items) {
    console.log(`${prefix}${item}`);
    await sleep(delay);
  }
}

/**
 * Print a key-value pair with animation
 */
export async function printKeyValue(
  key: string,
  value: string,
  options: {
    delay?: number;
    keyWidth?: number;
    keyColor?: (s: string) => string;
    valueColor?: (s: string) => string;
  } = {}
): Promise<void> {
  const {
    delay = 50,
    keyWidth = 12,
    keyColor = chalk.dim,
    valueColor = chalk.white
  } = options;

  await sleep(delay);
  console.log(`    ${keyColor(key.padEnd(keyWidth))} ${valueColor(value)}`);
}

/**
 * Print multiple key-value pairs
 */
export async function printKeyValues(
  pairs: Array<{ key: string; value: string }>,
  options: {
    delay?: number;
    keyWidth?: number;
    keyColor?: (s: string) => string;
    valueColor?: (s: string) => string;
  } = {}
): Promise<void> {
  for (const { key, value } of pairs) {
    await printKeyValue(key, value, options);
  }
}

/**
 * Print a boxed message with animation
 */
export async function printBox(
  lines: string[],
  options: {
    width?: number;
    borderColor?: (s: string) => string;
    delay?: number;
  } = {}
): Promise<void> {
  const {
    width = 50,
    borderColor = chalk.gray,
    delay = 40
  } = options;

  const top = borderColor('┌' + '─'.repeat(width - 2) + '┐');
  const bottom = borderColor('└' + '─'.repeat(width - 2) + '┘');

  console.log(top);
  await sleep(delay);

  for (const line of lines) {
    const paddedLine = line.padEnd(width - 4);
    console.log(borderColor('│') + ' ' + paddedLine + ' ' + borderColor('│'));
    await sleep(delay);
  }

  console.log(bottom);
}

/**
 * Print a divider line
 */
export async function printDivider(
  options: {
    char?: string;
    width?: number;
    color?: (s: string) => string;
    delay?: number;
  } = {}
): Promise<void> {
  const {
    char = '─',
    width = 50,
    color = chalk.gray,
    delay = 30
  } = options;

  await sleep(delay);
  console.log(color(char.repeat(width)));
}

/**
 * Print an empty line with optional delay
 */
export async function printEmpty(delay: number = 0): Promise<void> {
  if (delay > 0) await sleep(delay);
  console.log();
}

/**
 * Batch print - print multiple items with a consistent rhythm
 */
export async function printBatch(
  items: Array<string | (() => void) | (() => Promise<void>)>,
  options: { delay?: number } = {}
): Promise<void> {
  const { delay = 50 } = options;

  for (const item of items) {
    if (typeof item === 'string') {
      console.log(item);
    } else {
      await item();
    }
    await sleep(delay);
  }
}

// Re-export sleep for convenience
export { sleep };
