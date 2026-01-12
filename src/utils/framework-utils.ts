/**
 * Framework Utilities
 *
 * Helper functions for framework version analysis.
 * Framework detection is done via API (see ApiClient.detectFramework).
 */

/**
 * Determine change type for migration display
 *
 * Compares current and target versions to determine upgrade type.
 *
 * @param current - Current version
 * @param target - Target version
 * @returns 'major', 'minor', 'patch', or 'none'
 */
export function getChangeType(
  current: string | undefined,
  target: string | undefined
): 'major' | 'minor' | 'patch' | 'none' {
  if (!current || !target) return 'none';

  const currentMajor = parseInt(current.replace(/[~^]/g, '').split('.')[0], 10);
  const targetMajor = parseInt(target.replace(/[~^]/g, '').split('.')[0], 10);

  if (isNaN(currentMajor) || isNaN(targetMajor)) return 'none';
  if (targetMajor > currentMajor) return 'major';

  const currentMinor = parseInt(current.replace(/[~^]/g, '').split('.')[1] || '0', 10);
  const targetMinor = parseInt(target.replace(/[~^]/g, '').split('.')[1] || '0', 10);

  if (targetMinor > currentMinor) return 'minor';

  return 'patch';
}

/**
 * Calculate severity summary from conflicts array
 *
 * @param conflicts - Array of conflict objects with severity field
 * @returns Summary counts by severity level
 */
export function calculateSummary(
  conflicts: any[]
): { critical: number; high: number; medium: number; low: number } {
  return {
    critical: conflicts.filter(c => c.severity === 'critical').length,
    high: conflicts.filter(c => c.severity === 'high').length,
    medium: conflicts.filter(c => c.severity === 'medium').length,
    low: conflicts.filter(c => c.severity === 'low').length,
  };
}
