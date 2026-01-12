/**
 * CLI Table Builder Utilities
 *
 * Functions for building formatted tables in CLI output.
 * Used for teaser (locked) and full (unlocked) analysis displays.
 */
import { colors } from './design-system.js';

/**
 * Create teaser table (limited info, no solutions)
 *
 * Shows only severity and package name with generic issue type.
 * Used in audit mode before payment to preview issues.
 *
 * @param conflicts - Array of conflict objects
 * @returns Formatted table string
 */
export function createTeaserTable(conflicts: any[]): string {
  const COL1 = 12; // SEVERITY
  const COL2 = 30; // PACKAGE
  const COL3 = 14; // ISSUE
  const TOTAL_WIDTH = COL1 + COL2 + COL3;

  const lines: string[] = [];

  // Header row
  lines.push(
    colors.whiteBold('SEVERITY'.padEnd(COL1)) +
    colors.whiteBold('PACKAGE'.padEnd(COL2)) +
    colors.whiteBold('ISSUE'.padEnd(COL3))
  );

  // Separator line
  lines.push(colors.gray('─'.repeat(TOTAL_WIDTH)));

  for (const conflict of conflicts) {
    const severity = conflict.severity?.toUpperCase() || 'UNKNOWN';
    const severityColor = severity === 'CRITICAL' ? colors.dangerBold :
                          severity === 'HIGH' ? colors.danger :
                          severity === 'MEDIUM' ? colors.warning :
                          colors.dim;

    // Truncate package name if too long
    const pkg = (conflict.package || '').substring(0, COL2 - 1).padEnd(COL2);

    // Generic issue description (no details to prevent bypass)
    const issueType = severity === 'CRITICAL' ? 'Peer Clash' :
                      severity === 'HIGH' ? 'Version Gap' :
                      severity === 'MEDIUM' ? 'Conflict' : 'Minor';

    lines.push(
      severityColor(severity.padEnd(COL1)) +
      pkg +
      issueType
    );
  }

  return lines.join('\n');
}

/**
 * Create full solution table (shows recommended versions)
 *
 * Displays package name, current version, target version, and change type.
 * Used after payment to show complete solution.
 *
 * @param conflicts - Array of conflict objects
 * @param solution - Solution object with dependencies, devDependencies, and removals
 * @returns Formatted table string
 */
export function createFullSolutionTable(
  conflicts: any[],
  solution: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    removals?: Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }>;
  }
): string {
  const COL1 = 35; // PACKAGE
  const COL2 = 14; // CURRENT
  const COL3 = 14; // TARGET
  const COL4 = 10; // TYPE
  const TOTAL_WIDTH = COL1 + COL2 + COL3 + COL4;

  const lines: string[] = [];

  // Header row
  lines.push(
    colors.whiteBold('PACKAGE'.padEnd(COL1)) +
    colors.whiteBold('CURRENT'.padEnd(COL2)) +
    colors.whiteBold('TARGET'.padEnd(COL3)) +
    colors.whiteBold('TYPE'.padEnd(COL4))
  );

  // Separator line
  lines.push(colors.gray('─'.repeat(TOTAL_WIDTH)));

  // Merge solution deps
  const allSolutions = { ...solution.dependencies, ...solution.devDependencies };

  // Separate conflicts into updates vs adds
  const updates: Array<{ conflict: any; recommended: string; changeType: string }> = [];
  const adds: Array<{ conflict: any; recommended: string }> = [];

  for (const conflict of conflicts) {
    const recommended = allSolutions[conflict.package] || conflict.recommendedVersion || '';
    const currentRaw = conflict.currentVersion || '';
    const isNotInstalled = !currentRaw || currentRaw.toLowerCase() === 'not installed';

    if (isNotInstalled) {
      adds.push({ conflict, recommended });
    } else if (recommended) {
      // Determine change type
      let changeType = 'patch';
      const cleanCurrent = currentRaw.replace(/[~^]/g, '');
      const cleanRec = recommended.replace(/[~^]/g, '');
      const currMajor = parseInt(cleanCurrent.split('.')[0], 10);
      const recMajor = parseInt(cleanRec.split('.')[0], 10);
      if (!isNaN(currMajor) && !isNaN(recMajor)) {
        if (recMajor > currMajor) changeType = 'major';
        else if (recMajor === currMajor) {
          const currMinor = parseInt(cleanCurrent.split('.')[1] || '0', 10);
          const recMinor = parseInt(cleanRec.split('.')[1] || '0', 10);
          if (recMinor > currMinor) changeType = 'minor';
        }
      }
      updates.push({ conflict, recommended, changeType });
    }
  }

  // Render updates first
  for (const { conflict, recommended, changeType } of updates) {
    const pkg = (conflict.package || '').substring(0, COL1 - 1).padEnd(COL1);
    let currentRaw = (conflict.currentVersion || '').replace(/[~^]/g, '').substring(0, COL2 - 1);
    if (currentRaw.toLowerCase() === 'installed') currentRaw = '—';
    const currentPadded = currentRaw.padEnd(COL2);
    const recommendedClean = recommended.replace(/[~^]/g, '').substring(0, COL3 - 1);
    const recommendedPadded = recommendedClean.padEnd(COL3);

    const typeLabel = changeType === 'major' ? 'Major' :
                      changeType === 'minor' ? 'Minor' : 'Patch';
    const typeColor = changeType === 'major' ? colors.danger :
                      changeType === 'minor' ? colors.warning : colors.success;

    lines.push(
      pkg +
      colors.versionOld(currentPadded) +
      colors.version(recommendedPadded) +
      typeColor(typeLabel)
    );
  }

  // Render adds
  for (const { conflict, recommended } of adds) {
    const pkg = (conflict.package || '').substring(0, COL1 - 1).padEnd(COL1);
    const currentPadded = '—'.padEnd(COL2);
    const recommendedClean = recommended ? recommended.replace(/[~^]/g, '').substring(0, COL3 - 1) : 'Add';
    const recommendedPadded = recommendedClean.padEnd(COL3);

    lines.push(
      pkg +
      colors.dim(currentPadded) +
      colors.version(recommendedPadded) +
      colors.brand('+ Add')
    );
  }

  // Render removals
  if (solution.removals && solution.removals.length > 0) {
    for (const removal of solution.removals) {
      const pkg = (removal.package || '').substring(0, COL1 - 1).padEnd(COL1);
      const currentPadded = 'installed'.padEnd(COL2);
      const targetPadded = '—'.padEnd(COL3);

      lines.push(
        pkg +
        colors.versionOld(currentPadded) +
        colors.dim(targetPadded) +
        colors.danger('Remove')
      );
    }
  }

  return lines.join('\n');
}

/**
 * Wrap text to specified width
 *
 * Breaks text at word boundaries to fit within max width.
 *
 * @param text - Text to wrap
 * @param maxWidth - Maximum line width
 * @returns Array of wrapped lines
 */
export function wrapText(text: string, maxWidth: number): string[] {
  if (!text) return [];
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}
