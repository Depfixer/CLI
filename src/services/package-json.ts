import * as fs from 'fs/promises';
import * as path from 'path';
import { VersionUtils } from '../utils/version-utils.js';

/**
 * Package.json Service
 * Handles reading, sanitizing, and writing package.json files
 */
export class PackageJsonService {
  /**
   * Read package.json from directory
   */
  async read(dir: string = process.cwd()): Promise<{
    content: string;
    parsed: any;
    path: string;
  }> {
    const filePath = path.join(dir, 'package.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return { content, parsed, path: filePath };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`No package.json found in ${dir}`);
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in package.json: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Sanitize package.json for sending to server
   * Removes sensitive/irrelevant fields, keeps only dependency-related data
   */
  sanitize(pkg: any): any {
    return {
      name: pkg.name || 'unnamed',
      version: pkg.version,
      private: pkg.private || false, // Keep - affects peer dep strictness
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
      peerDependencies: pkg.peerDependencies || {},
      resolutions: pkg.resolutions || {},
      overrides: pkg.overrides || {},
      engines: pkg.engines || {},
    };
  }

  /**
   * Apply surgical fixes to package.json
   * Only modifies version strings, preserves all formatting
   * Creates backup before modifying
   * Also handles package removals (deprecated packages) and engine updates
   */
  async applySurgicalFixes(
    dir: string,
    changes: Array<{ package: string; from: string; to: string; type: 'dependency' | 'devDependency' }>,
    removals?: Array<{ package: string; reason: string; type: 'dependency' | 'devDependency' }>,
    engines?: { node?: string; npm?: string }
  ): Promise<{ backupPath: string; applied: number; removed: number; enginesUpdated: number }> {
    const filePath = path.join(dir, 'package.json');
    let content = await fs.readFile(filePath, 'utf-8');

    // Create backup first
    const backupPath = path.join(dir, 'package.json.bak');
    await fs.writeFile(backupPath, content, 'utf-8');

    let applied = 0;
    let removed = 0;
    let enginesUpdated = 0;

    // Apply each version change surgically
    for (const change of changes) {
      const section = change.type === 'devDependency' ? 'devDependencies' : 'dependencies';
      const result = this.replaceVersionInSection(content, section, change.package, change.from, change.to);
      if (result.replaced) {
        content = result.content;
        applied++;
      }
    }

    // Apply removals (delete deprecated packages)
    if (removals && removals.length > 0) {
      for (const removal of removals) {
        const section = removal.type === 'devDependency' ? 'devDependencies' : 'dependencies';
        const result = this.removePackageFromSection(content, section, removal.package);
        if (result.removed) {
          content = result.content;
          removed++;
        }
      }
    }

    // Apply engine updates (Node.js/npm requirements)
    if (engines && Object.keys(engines).length > 0) {
      const result = this.updateEngines(content, engines);
      content = result.content;
      enginesUpdated = result.updated;
    }

    // Write back modified content
    await fs.writeFile(filePath, content, 'utf-8');

    return { backupPath, applied, removed, enginesUpdated };
  }

  /**
   * Replace a package version within a specific section of package.json
   * Preserves all formatting and only changes the version string
   */
  private replaceVersionInSection(
    content: string,
    section: 'dependencies' | 'devDependencies',
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): { content: string; replaced: boolean } {
    // Find the section in the content
    const sectionRegex = new RegExp(`"${section}"\\s*:\\s*\\{`, 'g');
    const sectionMatch = sectionRegex.exec(content);

    if (!sectionMatch) {
      return { content, replaced: false };
    }

    const sectionStart = sectionMatch.index;

    // Find the closing brace for this section (handle nested objects)
    let braceCount = 0;
    let sectionEnd = sectionStart;
    let inSection = false;

    for (let i = sectionStart; i < content.length; i++) {
      if (content[i] === '{') {
        braceCount++;
        inSection = true;
      } else if (content[i] === '}') {
        braceCount--;
        if (inSection && braceCount === 0) {
          sectionEnd = i + 1;
          break;
        }
      }
    }

    // Extract the section content
    const sectionContent = content.substring(sectionStart, sectionEnd);

    // Escape special regex characters in package name and version
    const escapedPkgName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedFromVersion = fromVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Pattern to match: "package-name": "version" (with flexible whitespace)
    // Captures the package declaration and replaces only the version
    const packagePattern = new RegExp(
      `("${escapedPkgName}"\\s*:\\s*")${escapedFromVersion}(")`
    );

    const match = packagePattern.exec(sectionContent);
    if (!match) {
      return { content, replaced: false };
    }

    // Replace the version in the section
    const newSectionContent = sectionContent.replace(packagePattern, `$1${toVersion}$2`);

    // Reconstruct the full content
    const newContent = content.substring(0, sectionStart) + newSectionContent + content.substring(sectionEnd);

    return { content: newContent, replaced: true };
  }

  /**
   * Remove a package entry from a specific section of package.json
   * Preserves all formatting and removes only the package line
   */
  private removePackageFromSection(
    content: string,
    section: 'dependencies' | 'devDependencies',
    packageName: string
  ): { content: string; removed: boolean } {
    // Escape special regex characters in package name
    const escapedPkgName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Split content into lines to work line by line
    const lines = content.split('\n');
    let inSection = false;
    let braceCount = 0;
    let packageLineIndex = -1;
    let hasTrailingComma = false;

    // Find the package line within the section
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if entering the section
      if (line.includes(`"${section}"`)) {
        inSection = true;
      }

      if (inSection) {
        // Count braces
        braceCount += (line.match(/\{/g) || []).length;
        braceCount -= (line.match(/\}/g) || []).length;

        // Check if this line contains the package
        const packagePattern = new RegExp(`^\\s*"${escapedPkgName}"\\s*:\\s*"[^"]*"\\s*,?\\s*$`);
        if (packagePattern.test(line)) {
          packageLineIndex = i;
          hasTrailingComma = line.trimEnd().endsWith(',');
          break;
        }

        // Exit section if braces are balanced
        if (braceCount === 0 && i > 0) {
          break;
        }
      }
    }

    if (packageLineIndex === -1) {
      return { content, removed: false };
    }

    // Remove the package line
    lines.splice(packageLineIndex, 1);

    // If this line didn't have a trailing comma, check if we need to remove comma from previous line
    if (!hasTrailingComma && packageLineIndex > 0) {
      const prevLine = lines[packageLineIndex - 1];
      // Only remove comma if the previous line has a value (not opening brace)
      if (prevLine.trimEnd().endsWith(',')) {
        lines[packageLineIndex - 1] = prevLine.replace(/,(\s*)$/, '$1');
      }
    }

    return { content: lines.join('\n'), removed: true };
  }

  /**
   * Update or add engines section in package.json
   * Preserves formatting when updating existing engines
   * Adds engines section after version field if not present
   */
  private updateEngines(
    content: string,
    engines: { node?: string; npm?: string }
  ): { content: string; updated: number } {
    let updated = 0;
    let newContent = content;

    // Check if engines section exists
    const enginesRegex = /"engines"\s*:\s*\{/;
    const hasEngines = enginesRegex.test(content);

    if (hasEngines) {
      // Update existing engines section
      // Find the engines section
      const enginesMatch = enginesRegex.exec(content);
      if (enginesMatch) {
        const enginesStart = enginesMatch.index;

        // Find closing brace for engines section
        let braceCount = 0;
        let enginesEnd = enginesStart;
        let inSection = false;

        for (let i = enginesStart; i < content.length; i++) {
          if (content[i] === '{') {
            braceCount++;
            inSection = true;
          } else if (content[i] === '}') {
            braceCount--;
            if (inSection && braceCount === 0) {
              enginesEnd = i + 1;
              break;
            }
          }
        }

        // Extract engines section content
        const enginesContent = content.substring(enginesStart, enginesEnd);

        // Update each engine value
        let newEnginesContent = enginesContent;

        for (const [key, value] of Object.entries(engines)) {
          if (!value) continue;

          const engineKeyPattern = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`);
          if (engineKeyPattern.test(newEnginesContent)) {
            // Update existing key
            newEnginesContent = newEnginesContent.replace(engineKeyPattern, `$1"${value}"`);
            updated++;
          } else {
            // Add new key to engines section
            // Find position before closing brace
            const closingBraceIndex = newEnginesContent.lastIndexOf('}');
            const beforeBrace = newEnginesContent.substring(0, closingBraceIndex);
            const afterBrace = newEnginesContent.substring(closingBraceIndex);

            // Check if there are existing entries (need comma)
            const hasEntries = /"[^"]+"\s*:\s*"[^"]*"/.test(beforeBrace);
            const indent = '    '; // Standard 2-space indent for nested properties

            if (hasEntries) {
              // Add comma after last entry and new entry
              newEnginesContent = beforeBrace.replace(/(\s*)$/, `,\n${indent}"${key}": "${value}"$1`) + afterBrace;
            } else {
              // First entry
              newEnginesContent = beforeBrace + `\n${indent}"${key}": "${value}"\n  ` + afterBrace;
            }
            updated++;
          }
        }

        newContent = content.substring(0, enginesStart) + newEnginesContent + content.substring(enginesEnd);
      }
    } else {
      // Add new engines section after "version" field (or after "name" if no version)
      const enginesObj: Record<string, string> = {};
      for (const [key, value] of Object.entries(engines)) {
        if (value) {
          enginesObj[key] = value;
          updated++;
        }
      }

      if (updated > 0) {
        // Build engines string with proper formatting
        const enginesEntries = Object.entries(enginesObj)
          .map(([k, v]) => `    "${k}": "${v}"`)
          .join(',\n');
        const enginesStr = `"engines": {\n${enginesEntries}\n  }`;

        // Find insertion point - after "version" or "name"
        const versionPattern = /"version"\s*:\s*"[^"]*"/;
        const namePattern = /"name"\s*:\s*"[^"]*"/;

        let insertMatch = versionPattern.exec(content);
        if (!insertMatch) {
          insertMatch = namePattern.exec(content);
        }

        if (insertMatch) {
          const insertPoint = insertMatch.index + insertMatch[0].length;
          // Check if there's a comma after
          const afterInsert = content.substring(insertPoint);
          const hasCommaAfter = /^\s*,/.test(afterInsert);

          if (hasCommaAfter) {
            // Insert after the comma
            const commaMatch = /^(\s*,)/.exec(afterInsert);
            if (commaMatch) {
              const afterComma = insertPoint + commaMatch[0].length;
              newContent = content.substring(0, afterComma) + '\n  ' + enginesStr + ',' + content.substring(afterComma);
            }
          } else {
            // Add comma and insert
            newContent = content.substring(0, insertPoint) + ',\n  ' + enginesStr + content.substring(insertPoint);
          }
        }
      }
    }

    return { content: newContent, updated };
  }

  /**
   * Write a modified package.json to package.json.fixed
   * Preserves original file, allows user to review before applying
   */
  async writeFixed(dir: string, packageJson: any): Promise<string> {
    const fixedPath = path.join(dir, 'package.json.fixed');
    const content = JSON.stringify(packageJson, null, 2);
    await fs.writeFile(fixedPath, content, 'utf-8');
    return fixedPath;
  }

  /**
   * Get list of changes that would be applied
   * Skips unknown versions and REMOVE versions (matches web algorithm)
   */
  getChanges(
    original: any,
    solution: {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    }
  ): Array<{ package: string; from: string; to: string; type: 'dependency' | 'devDependency' }> {
    const changes: Array<{ package: string; from: string; to: string; type: 'dependency' | 'devDependency' }> = [];

    // Check dependencies
    if (original.dependencies) {
      for (const [pkg, version] of Object.entries(solution.dependencies)) {
        const versionStr = version as string;
        // Skip unknown/invalid versions and REMOVE versions (handled separately)
        if (VersionUtils.isUnknownVersion(versionStr) || VersionUtils.isRemoveVersion(versionStr)) {
          continue;
        }
        if (original.dependencies[pkg] && original.dependencies[pkg] !== versionStr) {
          changes.push({
            package: pkg,
            from: original.dependencies[pkg],
            to: VersionUtils.formatVersion(versionStr),
            type: 'dependency',
          });
        }
      }
    }

    // Check devDependencies
    if (original.devDependencies) {
      for (const [pkg, version] of Object.entries(solution.devDependencies)) {
        const versionStr = version as string;
        // Skip unknown/invalid versions and REMOVE versions (handled separately)
        if (VersionUtils.isUnknownVersion(versionStr) || VersionUtils.isRemoveVersion(versionStr)) {
          continue;
        }
        if (original.devDependencies[pkg] && original.devDependencies[pkg] !== versionStr) {
          changes.push({
            package: pkg,
            from: original.devDependencies[pkg],
            to: VersionUtils.formatVersion(versionStr),
            type: 'devDependency',
          });
        }
      }
    }

    return changes;
  }
}
