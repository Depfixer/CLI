/**
 * Analysis Constants
 *
 * Shared constants used across CLI commands.
 * Keep values consistent across the codebase.
 *
 * @see https://docs.depfixer.com
 */

// ============================================================================
// AUDIT MODE CONSTANTS
// ============================================================================

/** Number of packages to show in audit preview */
export const CLI_AUDIT_SAMPLE_SIZE = 2;

/** Threshold for showing severity summary vs package list */
export const CLI_AUDIT_THRESHOLD = 3;

// ============================================================================
// FIX STEPS (shared across smart.ts, fix.ts, migrate.ts)
// ============================================================================

/**
 * Steps displayed during fix application.
 * Used with runStepSequence() for consistent UX.
 */
export const FIX_STEPS = [
  'Reading package.json...',
  'Calculating safe versions...',
  'Updating dependencies...',
  'Updating devDependencies...',
  'Validating changes...',
  'Writing package.json...',
] as const;
