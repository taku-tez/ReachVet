/**
 * Dependency Freshness Check
 *
 * Checks how up-to-date dependencies are by comparing installed versions
 * with latest available versions from package registries.
 */

// Local type definitions (not in main types.ts as they're freshness-specific)
export type Ecosystem = 'npm' | 'pypi' | 'cargo' | 'go' | 'rubygems' | 'packagist' | 'nuget' | 'hex' | 'pub' | 'maven' | 'hackage' | 'opam' | 'clojars';

export interface Dependency {
  name: string;
  version: string;
  ecosystem: Ecosystem | string;
}

export interface VersionInfo {
  latest: string;
  published?: string; // ISO date
  deprecated?: boolean;
  deprecationMessage?: string;
}

export interface FreshnessResult {
  dependency: Dependency;
  currentVersion: string;
  latestVersion: string | null;
  versionsBehind: number;
  daysSinceLatest?: number;
  isOutdated: boolean;
  isDeprecated: boolean;
  deprecationMessage?: string;
  severity: 'current' | 'minor' | 'major' | 'critical';
  error?: string;
}

export interface FreshnessReport {
  checkedAt: string;
  totalDependencies: number;
  outdated: number;
  deprecated: number;
  current: number;
  failed: number;
  results: FreshnessResult[];
  summary: {
    byEcosystem: Record<string, { total: number; outdated: number }>;
    bySeverity: Record<string, number>;
  };
}

export interface FreshnessOptions {
  includeDevDependencies?: boolean;
  timeout?: number;
  concurrency?: number;
  registryUrls?: Partial<Record<Ecosystem, string>>;
}

const DEFAULT_REGISTRIES: Partial<Record<Ecosystem, string>> = {
  npm: 'https://registry.npmjs.org',
  pypi: 'https://pypi.org/pypi',
  cargo: 'https://crates.io/api/v1/crates',
  go: 'https://proxy.golang.org',
  rubygems: 'https://rubygems.org/api/v1/gems',
  packagist: 'https://repo.packagist.org/p2',
  nuget: 'https://api.nuget.org/v3-flatcontainer',
  hex: 'https://hex.pm/api/packages',
  pub: 'https://pub.dev/api/packages',
};

/**
 * Parse semver version string
 */
function parseVersion(version: string): { major: number; minor: number; patch: number; prerelease?: string } | null {
  // Remove 'v' prefix if present
  const cleaned = version.replace(/^v/, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  if (!parsedA || !parsedB) {
    // Fallback to string comparison
    return a.localeCompare(b);
  }

  if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor;
  if (parsedA.patch !== parsedB.patch) return parsedA.patch - parsedB.patch;

  // Pre-release versions are considered older
  if (parsedA.prerelease && !parsedB.prerelease) return -1;
  if (!parsedA.prerelease && parsedB.prerelease) return 1;

  return 0;
}

/**
 * Calculate how many major/minor/patch versions behind
 */
function calculateVersionsBehind(current: string, latest: string): number {
  const parsedCurrent = parseVersion(current);
  const parsedLatest = parseVersion(latest);

  if (!parsedCurrent || !parsedLatest) return 0;

  // Major version difference counts as 100 each
  // Minor version difference counts as 10 each
  // Patch version difference counts as 1 each
  const majorDiff = parsedLatest.major - parsedCurrent.major;
  const minorDiff = parsedLatest.minor - parsedCurrent.minor;
  const patchDiff = parsedLatest.patch - parsedCurrent.patch;

  if (majorDiff > 0) {
    return majorDiff * 100 + Math.max(0, minorDiff) * 10 + Math.max(0, patchDiff);
  }
  if (minorDiff > 0) {
    return minorDiff * 10 + Math.max(0, patchDiff);
  }
  return Math.max(0, patchDiff);
}

/**
 * Determine severity based on version difference
 */
function determineSeverity(current: string, latest: string): 'current' | 'minor' | 'major' | 'critical' {
  const parsedCurrent = parseVersion(current);
  const parsedLatest = parseVersion(latest);

  if (!parsedCurrent || !parsedLatest) return 'minor';

  const majorDiff = parsedLatest.major - parsedCurrent.major;
  const minorDiff = parsedLatest.minor - parsedCurrent.minor;

  if (majorDiff >= 2) return 'critical';
  if (majorDiff === 1) return 'major';
  if (minorDiff >= 5) return 'major';
  if (minorDiff >= 1 || parsedLatest.patch > parsedCurrent.patch) return 'minor';
  return 'current';
}

/**
 * Fetch version info from npm registry
 */
async function fetchNpmVersion(packageName: string, registryUrl: string, timeout: number): Promise<VersionInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${registryUrl}/${encodeURIComponent(packageName)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      'dist-tags'?: { latest?: string };
      time?: Record<string, string>;
      deprecated?: string;
    };

    const latest = data['dist-tags']?.latest;
    if (!latest) return null;

    return {
      latest,
      published: data.time?.[latest],
      deprecated: !!data.deprecated,
      deprecationMessage: data.deprecated,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch version info from PyPI
 */
async function fetchPypiVersion(packageName: string, registryUrl: string, timeout: number): Promise<VersionInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${registryUrl}/${encodeURIComponent(packageName)}/json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      info?: { version?: string; yanked?: boolean };
      releases?: Record<string, Array<{ upload_time?: string; yanked?: boolean }>>;
    };

    const latest = data.info?.version;
    if (!latest) return null;

    const releaseInfo = data.releases?.[latest]?.[0];

    return {
      latest,
      published: releaseInfo?.upload_time,
      deprecated: data.info?.yanked || releaseInfo?.yanked,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch version info from crates.io (Rust)
 */
async function fetchCargoVersion(packageName: string, registryUrl: string, timeout: number): Promise<VersionInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${registryUrl}/${encodeURIComponent(packageName)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      crate?: { max_version?: string; updated_at?: string };
      versions?: Array<{ num?: string; yanked?: boolean; updated_at?: string }>;
    };

    const latest = data.crate?.max_version;
    if (!latest) return null;

    const latestVersionInfo = data.versions?.find((v) => v.num === latest);

    return {
      latest,
      published: latestVersionInfo?.updated_at || data.crate?.updated_at,
      deprecated: latestVersionInfo?.yanked,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch version info from Go module proxy
 */
async function fetchGoVersion(packageName: string, registryUrl: string, timeout: number): Promise<VersionInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Go proxy uses lowercase module paths with / escaped as !
    const encodedName = packageName.toLowerCase().replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

    const response = await fetch(`${registryUrl}/${encodedName}/@latest`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as { Version?: string; Time?: string };

    return {
      latest: data.Version || '',
      published: data.Time,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch version info from RubyGems
 */
async function fetchRubyGemsVersion(packageName: string, registryUrl: string, timeout: number): Promise<VersionInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${registryUrl}/${encodeURIComponent(packageName)}.json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      version?: string;
      version_created_at?: string;
      yanked?: boolean;
    };

    return {
      latest: data.version || '',
      published: data.version_created_at,
      deprecated: data.yanked,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch version info from Packagist (PHP)
 */
async function fetchPackagistVersion(packageName: string, registryUrl: string, timeout: number): Promise<VersionInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${registryUrl}/${encodeURIComponent(packageName)}.json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      packages?: Record<string, Array<{ version?: string; time?: string; abandoned?: boolean | string }>>;
    };

    const versions = data.packages?.[packageName];
    if (!versions || versions.length === 0) return null;

    // Find latest non-dev version
    const stableVersions = versions.filter(
      (v) => v.version && !v.version.includes('dev') && !v.version.includes('alpha') && !v.version.includes('beta')
    );
    const latestInfo = stableVersions[0] || versions[0];

    return {
      latest: latestInfo.version || '',
      published: latestInfo.time,
      deprecated: !!latestInfo.abandoned,
      deprecationMessage: typeof latestInfo.abandoned === 'string' ? latestInfo.abandoned : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch version info from NuGet
 */
async function fetchNuGetVersion(packageName: string, registryUrl: string, timeout: number): Promise<VersionInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const lowerName = packageName.toLowerCase();
    const response = await fetch(`${registryUrl}/${lowerName}/index.json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as { versions?: string[] };

    if (!data.versions || data.versions.length === 0) return null;

    // Latest stable version (last one that doesn't contain pre-release suffix)
    const stableVersions = data.versions.filter((v) => !v.includes('-'));
    const latest = stableVersions[stableVersions.length - 1] || data.versions[data.versions.length - 1];

    return {
      latest,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch version info from Hex (Elixir)
 */
async function fetchHexVersion(packageName: string, registryUrl: string, timeout: number): Promise<VersionInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${registryUrl}/${encodeURIComponent(packageName)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      releases?: Array<{ version?: string; inserted_at?: string; retired?: { reason?: string } }>;
    };

    if (!data.releases || data.releases.length === 0) return null;

    const latestRelease = data.releases[0];

    return {
      latest: latestRelease.version || '',
      published: latestRelease.inserted_at,
      deprecated: !!latestRelease.retired,
      deprecationMessage: latestRelease.retired?.reason,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch version info from pub.dev (Dart)
 */
async function fetchPubVersion(packageName: string, registryUrl: string, timeout: number): Promise<VersionInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${registryUrl}/${encodeURIComponent(packageName)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      latest?: { version?: string; published?: string };
      isDiscontinued?: boolean;
    };

    return {
      latest: data.latest?.version || '',
      published: data.latest?.published,
      deprecated: data.isDiscontinued,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch version info for a dependency from its ecosystem's registry
 */
async function fetchVersionInfo(
  dep: Dependency,
  options: FreshnessOptions
): Promise<VersionInfo | null> {
  const timeout = options.timeout || 10000;
  const registries = { ...DEFAULT_REGISTRIES, ...options.registryUrls };

  const ecosystem = dep.ecosystem as Ecosystem;
  const registryUrl = registries[ecosystem];

  if (!registryUrl) return null;

  switch (ecosystem) {
    case 'npm':
      return fetchNpmVersion(dep.name, registryUrl, timeout);
    case 'pypi':
      return fetchPypiVersion(dep.name, registryUrl, timeout);
    case 'cargo':
      return fetchCargoVersion(dep.name, registryUrl, timeout);
    case 'go':
      return fetchGoVersion(dep.name, registryUrl, timeout);
    case 'rubygems':
      return fetchRubyGemsVersion(dep.name, registryUrl, timeout);
    case 'packagist':
      return fetchPackagistVersion(dep.name, registryUrl, timeout);
    case 'nuget':
      return fetchNuGetVersion(dep.name, registryUrl, timeout);
    case 'hex':
      return fetchHexVersion(dep.name, registryUrl, timeout);
    case 'pub':
      return fetchPubVersion(dep.name, registryUrl, timeout);
    default:
      return null;
  }
}

/**
 * Check freshness of a single dependency
 */
async function checkDependencyFreshness(
  dep: Dependency,
  options: FreshnessOptions
): Promise<FreshnessResult> {
  const currentVersion = dep.version || 'unknown';

  try {
    const versionInfo = await fetchVersionInfo(dep, options);

    if (!versionInfo || !versionInfo.latest) {
      return {
        dependency: dep,
        currentVersion,
        latestVersion: null,
        versionsBehind: 0,
        isOutdated: false,
        isDeprecated: false,
        severity: 'current',
        error: 'Could not fetch version info',
      };
    }

    const isOutdated = compareVersions(currentVersion, versionInfo.latest) < 0;
    const versionsBehind = isOutdated ? calculateVersionsBehind(currentVersion, versionInfo.latest) : 0;
    const severity = isOutdated ? determineSeverity(currentVersion, versionInfo.latest) : 'current';

    let daysSinceLatest: number | undefined;
    if (versionInfo.published) {
      const publishedDate = new Date(versionInfo.published);
      const now = new Date();
      daysSinceLatest = Math.floor((now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      dependency: dep,
      currentVersion,
      latestVersion: versionInfo.latest,
      versionsBehind,
      daysSinceLatest,
      isOutdated,
      isDeprecated: versionInfo.deprecated || false,
      deprecationMessage: versionInfo.deprecationMessage,
      severity,
    };
  } catch (error) {
    return {
      dependency: dep,
      currentVersion,
      latestVersion: null,
      versionsBehind: 0,
      isOutdated: false,
      isDeprecated: false,
      severity: 'current',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check freshness of multiple dependencies
 */
export async function checkFreshness(
  dependencies: Dependency[],
  options: FreshnessOptions = {}
): Promise<FreshnessReport> {
  const concurrency = options.concurrency || 10;
  const results: FreshnessResult[] = [];

  // Process in batches for concurrency control
  for (let i = 0; i < dependencies.length; i += concurrency) {
    const batch = dependencies.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((dep) => checkDependencyFreshness(dep, options)));
    results.push(...batchResults);
  }

  // Calculate summary
  const outdated = results.filter((r) => r.isOutdated).length;
  const deprecated = results.filter((r) => r.isDeprecated).length;
  const failed = results.filter((r) => r.error).length;
  const current = results.filter((r) => !r.isOutdated && !r.error).length;

  const byEcosystem: Record<string, { total: number; outdated: number }> = {};
  const bySeverity: Record<string, number> = { current: 0, minor: 0, major: 0, critical: 0 };

  for (const result of results) {
    const eco = result.dependency.ecosystem;
    if (!byEcosystem[eco]) {
      byEcosystem[eco] = { total: 0, outdated: 0 };
    }
    byEcosystem[eco].total++;
    if (result.isOutdated) {
      byEcosystem[eco].outdated++;
    }
    bySeverity[result.severity]++;
  }

  return {
    checkedAt: new Date().toISOString(),
    totalDependencies: dependencies.length,
    outdated,
    deprecated,
    current,
    failed,
    results,
    summary: {
      byEcosystem,
      bySeverity,
    },
  };
}

/**
 * Format freshness result for CLI output
 */
export function formatFreshnessResult(result: FreshnessResult): string {
  const { dependency, currentVersion, latestVersion, isDeprecated, severity } = result;

  const icons: Record<string, string> = {
    current: '✅',
    minor: '🟡',
    major: '🟠',
    critical: '🔴',
  };

  const icon = icons[severity] || '⚪';
  const deprecatedTag = isDeprecated ? ' [DEPRECATED]' : '';
  const versionInfo = latestVersion ? `${currentVersion} → ${latestVersion}` : currentVersion;

  return `${icon} ${dependency.name}@${versionInfo}${deprecatedTag}`;
}

/**
 * Format freshness report as text
 */
export function formatFreshnessReport(report: FreshnessReport): string {
  const lines: string[] = [];

  lines.push('=== Dependency Freshness Report ===');
  lines.push(`Checked: ${report.checkedAt}`);
  lines.push('');
  lines.push(`Total: ${report.totalDependencies}`);
  lines.push(`  ✅ Current: ${report.current}`);
  lines.push(`  🟡 Outdated (minor): ${report.summary.bySeverity.minor}`);
  lines.push(`  🟠 Outdated (major): ${report.summary.bySeverity.major}`);
  lines.push(`  🔴 Outdated (critical): ${report.summary.bySeverity.critical}`);
  lines.push(`  ⚠️  Deprecated: ${report.deprecated}`);
  lines.push(`  ❌ Failed: ${report.failed}`);
  lines.push('');

  // Group by ecosystem
  const ecosystems = Object.keys(report.summary.byEcosystem).sort();
  for (const eco of ecosystems) {
    const stats = report.summary.byEcosystem[eco];
    lines.push(`[${eco}] ${stats.outdated}/${stats.total} outdated`);
  }
  lines.push('');

  // List outdated dependencies
  const outdatedResults = report.results.filter((r) => r.isOutdated || r.isDeprecated);
  if (outdatedResults.length > 0) {
    lines.push('--- Outdated Dependencies ---');
    for (const result of outdatedResults) {
      lines.push(formatFreshnessResult(result));
      if (result.deprecationMessage) {
        lines.push(`   ⚠️  ${result.deprecationMessage}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Convert freshness report to JSON
 */
export function toFreshnessJson(report: FreshnessReport): string {
  return JSON.stringify(report, null, 2);
}

export {
  parseVersion,
  compareVersions,
  calculateVersionsBehind,
  determineSeverity,
  DEFAULT_REGISTRIES,
};
