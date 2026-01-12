/**
 * Version utility functions for CLI
 * Local copy of required methods from @depfixer/shared to avoid npm dependency
 */

export class VersionUtils {
  /**
   * Check if a version is unknown/invalid (cannot be auto-fixed)
   * Used to determine which packages to skip
   */
  static isUnknownVersion(version: string | undefined): boolean {
    if (!version) return true;
    const lower = version.toLowerCase();
    // Check for known invalid version strings
    if (lower === 'unknown' || lower.includes('unknown')) return true;
    if (lower.includes('not available')) return true;
    if (lower === 'pending') return true;
    if (lower === 'manualreviewrequired') return true;
    // Version should start with a digit, ^, ~, >=, >, <=, <, or be a range
    const validVersionPattern = /^[\^~>=<]?\d|^\d|\*|latest/;
    return !validVersionPattern.test(lower);
  }

  /**
   * Check if a version indicates the package should be removed
   */
  static isRemoveVersion(version: string | undefined): boolean {
    if (!version) return false;
    const lower = version.toLowerCase();
    return lower === 'remove' ||
           lower === 'remove or replace' ||
           version === 'REMOVE';
  }

  /**
   * Format version - preserve existing prefixes, only add ^ if no prefix exists
   */
  static formatVersion(version: string): string {
    if (!version) return version;
    // If version already has a range prefix, use as-is
    if (version.startsWith('^') || version.startsWith('~') || version.startsWith('>=') ||
        version.startsWith('>') || version.startsWith('<=') || version.startsWith('<') ||
        version.includes(' ') || version.includes('||')) {
      return version;
    }
    // Plain version number - add ^ prefix
    return `^${version}`;
  }
}
