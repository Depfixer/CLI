/**
 * Framework Detector Service
 *
 * Local framework detection for CLI - no API required.
 * Detects Angular, React (web), and Vue frameworks.
 *
 * NOT supported (treated as generic JS projects):
 * - React Native / Expo
 * - Next.js (meta-framework)
 * - Svelte / SvelteKit
 */
import semver from 'semver';

export interface DetectedFramework {
  name: string;
  version: string;
  majorVersion: number;
  detectedFrom: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Detect framework and version from package.json
 *
 * @param packageJson - Parsed package.json content
 * @returns Detected framework info or null if unsupported/not detected
 */
export function detectFramework(packageJson: any): DetectedFramework | null {
  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};
  const allDeps = { ...dependencies, ...devDependencies };

  // Skip unsupported frameworks - treat as generic JS projects
  const unsupportedMarkers = ['react-native', 'expo', 'next', 'svelte', '@sveltejs/kit'];
  for (const marker of unsupportedMarkers) {
    if (allDeps[marker]) {
      return null;
    }
  }

  // Try Angular first (most specific indicators)
  const angularVersion = detectAngularVersion(allDeps);
  if (angularVersion) {
    return angularVersion;
  }

  // Try React
  const reactVersion = detectReactVersion(allDeps);
  if (reactVersion) {
    return reactVersion;
  }

  // Try Vue
  const vueVersion = detectVueVersion(allDeps);
  if (vueVersion) {
    return vueVersion;
  }

  return null;
}

/**
 * Detect Angular version from dependencies
 */
function detectAngularVersion(dependencies: Record<string, string>): DetectedFramework | null {
  // Primary indicators (high confidence)
  const primaryPackages = ['@angular/core', '@angular/common'];

  for (const pkg of primaryPackages) {
    if (dependencies[pkg]) {
      const version = parseVersion(dependencies[pkg]);
      if (version) {
        return {
          name: 'angular',
          version: version.version,
          majorVersion: version.major,
          detectedFrom: pkg,
          confidence: 'high',
        };
      }
    }
  }

  // Secondary indicators (medium confidence)
  const secondaryPackages = ['@angular/cli', '@angular/platform-browser'];

  for (const pkg of secondaryPackages) {
    if (dependencies[pkg]) {
      const version = parseVersion(dependencies[pkg]);
      if (version) {
        return {
          name: 'angular',
          version: version.version,
          majorVersion: version.major,
          detectedFrom: pkg,
          confidence: 'medium',
        };
      }
    }
  }

  return null;
}

/**
 * Detect React version from dependencies
 */
function detectReactVersion(dependencies: Record<string, string>): DetectedFramework | null {
  // Primary indicators
  const primaryPackages = ['react', 'react-dom'];

  for (const pkg of primaryPackages) {
    if (dependencies[pkg]) {
      const version = parseVersion(dependencies[pkg]);
      if (version) {
        return {
          name: 'react',
          version: version.version,
          majorVersion: version.major,
          detectedFrom: pkg,
          confidence: 'high',
        };
      }
    }
  }

  // Secondary indicators (@types/react)
  if (dependencies['@types/react']) {
    const version = parseVersion(dependencies['@types/react']);
    if (version) {
      return {
        name: 'react',
        version: version.version,
        majorVersion: version.major,
        detectedFrom: '@types/react',
        confidence: 'medium',
      };
    }
  }

  return null;
}

/**
 * Detect Vue version from dependencies
 */
function detectVueVersion(dependencies: Record<string, string>): DetectedFramework | null {
  // Primary indicator
  if (dependencies['vue']) {
    const version = parseVersion(dependencies['vue']);
    if (version) {
      return {
        name: 'vue',
        version: version.version,
        majorVersion: version.major,
        detectedFrom: 'vue',
        confidence: 'high',
      };
    }
  }

  // Secondary indicators
  const secondaryMappings: Record<string, (major: number) => { version: string; major: number }> = {
    '@vue/cli': (major) => {
      if (major >= 5) return { version: '3.0.0', major: 3 };
      return { version: '2.6.0', major: 2 };
    },
    'nuxt': (major) => {
      if (major >= 3) return { version: '3.0.0', major: 3 };
      return { version: '2.6.0', major: 2 };
    },
  };

  for (const [pkg, mapper] of Object.entries(secondaryMappings)) {
    if (dependencies[pkg]) {
      const version = parseVersion(dependencies[pkg]);
      if (version) {
        const inferred = mapper(version.major);
        return {
          name: 'vue',
          version: inferred.version,
          majorVersion: inferred.major,
          detectedFrom: pkg,
          confidence: 'medium',
        };
      }
    }
  }

  return null;
}

/**
 * Parse version from dependency string (handles ~, ^, ranges)
 */
function parseVersion(versionString: string): { version: string; major: number } | null {
  try {
    // Remove workspace protocol if present
    const cleanVersion = versionString.replace(/^workspace:/, '');

    let version: string | null = null;

    if (semver.valid(cleanVersion)) {
      // Exact version: "1.2.3"
      version = cleanVersion;
    } else if (semver.validRange(cleanVersion)) {
      // Range: "^1.2.3", "~1.2.3", ">=1.2.3 <2.0.0"
      const coerced = semver.coerce(cleanVersion);
      if (coerced) {
        version = coerced.version;
      }
    } else {
      // Try to extract version from complex strings
      const match = cleanVersion.match(/(\d+)\.(\d+)\.(\d+)/);
      if (match) {
        version = `${match[1]}.${match[2]}.${match[3]}`;
      }
    }

    if (version && semver.valid(version)) {
      return {
        version,
        major: semver.major(version),
      };
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

/**
 * Extract clean version string from semver range
 */
export function extractVersion(versionString: string | undefined): string | undefined {
  if (!versionString) return undefined;
  const parsed = parseVersion(versionString);
  return parsed?.version;
}

/**
 * Get current framework version from package.json
 */
export function getCurrentVersion(packageJson: any, framework: string): string | undefined {
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

  switch (framework.toLowerCase()) {
    case 'angular':
      return extractVersion(deps['@angular/core']);
    case 'react':
      return extractVersion(deps['react']);
    case 'vue':
      return extractVersion(deps['vue']);
    default:
      return undefined;

  }
}
