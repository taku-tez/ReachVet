/**
 * Vulnerability Fix Suggestions Module
 * 
 * Analyzes vulnerable dependencies and suggests fixes based on OSV data.
 * Generates upgrade commands for various package managers.
 */

import { OSVClient, OSVVulnerability } from '../osv/index.js';

// =============================================================================
// Types
// =============================================================================

export interface VulnerablePackage {
  name: string;
  version: string;
  ecosystem: string;
  vulnerabilities: string[];  // CVE/GHSA IDs
}

export interface FixSuggestion {
  package: string;
  currentVersion: string;
  ecosystem: string;
  vulnerabilities: VulnerabilityFix[];
  suggestedVersion: string | null;  // Highest version that fixes all vulns
  upgradeCommand: string | null;
  risk: 'low' | 'medium' | 'high';  // Based on semver jump
  breaking: boolean;  // Major version bump
  notes: string[];
}

export interface VulnerabilityFix {
  id: string;  // CVE or GHSA ID
  fixedIn: string | null;  // First fixed version
  severity: string | null;
}

export interface FixReport {
  timestamp: string;
  summary: {
    totalVulnerable: number;
    fixable: number;
    unfixable: number;
    breakingChanges: number;
  };
  suggestions: FixSuggestion[];
  unfixable: UnfixablePackage[];
}

export interface UnfixablePackage {
  package: string;
  version: string;
  ecosystem: string;
  reason: string;
  vulnerabilities: string[];
}

export interface FixOptions {
  osvClient?: OSVClient;
  includePrerelease?: boolean;
  maxMajorBump?: number;  // Max major version jumps allowed (default: 1)
}

// =============================================================================
// Package Manager Commands
// =============================================================================

const UPGRADE_COMMANDS: Record<string, (pkg: string, version: string) => string> = {
  npm: (pkg, ver) => `npm install ${pkg}@${ver}`,
  'npm-dev': (pkg, ver) => `npm install -D ${pkg}@${ver}`,
  yarn: (pkg, ver) => `yarn add ${pkg}@${ver}`,
  'yarn-dev': (pkg, ver) => `yarn add -D ${pkg}@${ver}`,
  pnpm: (pkg, ver) => `pnpm add ${pkg}@${ver}`,
  'pnpm-dev': (pkg, ver) => `pnpm add -D ${pkg}@${ver}`,
  pip: (pkg, ver) => `pip install "${pkg}>=${ver}"`,
  pipenv: (pkg, ver) => `pipenv install "${pkg}>=${ver}"`,
  poetry: (pkg, ver) => `poetry add "${pkg}@^${ver}"`,
  cargo: (pkg, _ver) => `cargo update -p ${pkg}`,  // Cargo.toml needs manual edit
  gem: (pkg, ver) => `gem install ${pkg} -v '>= ${ver}'`,
  bundler: (pkg, _ver) => `bundle update ${pkg}`,
  composer: (pkg, ver) => `composer require ${pkg}:^${ver}`,
  go: (pkg, ver) => `go get ${pkg}@v${ver}`,
  maven: (_pkg, ver) => `# Update pom.xml: <version>${ver}</version>`,
  gradle: (_pkg, ver) => `# Update build.gradle: implementation '...:${ver}'`,
  nuget: (pkg, ver) => `dotnet add package ${pkg} --version ${ver}`,
  hex: (pkg, _ver) => `mix deps.update ${pkg}`,
  pub: (pkg, _ver) => `dart pub upgrade ${pkg}`,
  hackage: (pkg, ver) => `cabal install ${pkg}-${ver}`,
  opam: (pkg, ver) => `opam install ${pkg}.${ver}`,
};

// Ecosystem to package manager mapping
const ECOSYSTEM_TO_PM: Record<string, string> = {
  npm: 'npm',
  pypi: 'pip',
  'crates.io': 'cargo',
  go: 'go',
  rubygems: 'gem',
  packagist: 'composer',
  maven: 'maven',
  nuget: 'nuget',
  hex: 'hex',
  pub: 'pub',
  hackage: 'hackage',
  opam: 'opam',
};

// =============================================================================
// Version Utilities
// =============================================================================

/**
 * Parse a semver-like version string
 */
export function parseVersion(version: string): { major: number; minor: number; patch: number; prerelease: string | null } | null {
  // Handle v prefix
  const v = version.replace(/^v/, '');
  
  // Match semver pattern
  const match = v.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/);
  if (!match) return null;
  
  return {
    major: parseInt(match[1], 10),
    minor: match[2] ? parseInt(match[2], 10) : 0,
    patch: match[3] ? parseInt(match[3], 10) : 0,
    prerelease: match[4] || null,
  };
}

/**
 * Compare two versions (-1: a < b, 0: a == b, 1: a > b)
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  
  if (!va || !vb) {
    // Fallback to string comparison
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }
  
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  if (va.patch !== vb.patch) return va.patch - vb.patch;
  
  // Prerelease versions come before release
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;
  if (va.prerelease && vb.prerelease) {
    return va.prerelease.localeCompare(vb.prerelease, undefined, { numeric: true });
  }
  
  return 0;
}

/**
 * Calculate the version bump type
 */
export function getVersionBumpType(from: string, to: string): 'patch' | 'minor' | 'major' | 'unknown' {
  const vFrom = parseVersion(from);
  const vTo = parseVersion(to);
  
  if (!vFrom || !vTo) return 'unknown';
  
  if (vTo.major > vFrom.major) return 'major';
  if (vTo.minor > vFrom.minor) return 'minor';
  return 'patch';
}

/**
 * Calculate risk level based on version jump
 */
export function calculateRisk(from: string, to: string): 'low' | 'medium' | 'high' {
  const bumpType = getVersionBumpType(from, to);
  
  switch (bumpType) {
    case 'patch': return 'low';
    case 'minor': return 'medium';
    case 'major': return 'high';
    default: return 'medium';
  }
}

// =============================================================================
// Fix Suggestion Logic
// =============================================================================

/**
 * Extract fixed version from OSV vulnerability data
 */
export function extractFixedVersion(vuln: OSVVulnerability, packageName: string, ecosystem: string): string | null {
  if (!vuln.affected) return null;
  
  for (const affected of vuln.affected) {
    // Match by package name and ecosystem
    const pkg = affected.package;
    if (!pkg) continue;
    
    const pkgName = pkg.name?.toLowerCase();
    const pkgEco = pkg.ecosystem?.toLowerCase();
    
    if (pkgName !== packageName.toLowerCase()) continue;
    if (pkgEco && ecosystem && pkgEco !== ecosystem.toLowerCase()) continue;
    
    // Look for fixed version in ranges
    if (affected.ranges) {
      for (const range of affected.ranges) {
        if (range.events) {
          for (const event of range.events) {
            if (event.fixed) {
              return event.fixed;
            }
          }
        }
      }
    }
    
    // Check versions array for explicit version list
    if (affected.versions && affected.versions.length > 0) {
      // If there are specific affected versions, we can't determine fixed version
      // from this data alone
      continue;
    }
  }
  
  return null;
}

/**
 * Get the highest version that fixes all vulnerabilities
 */
export function getHighestFixedVersion(fixedVersions: (string | null)[], includePrerelease = false): string | null {
  const valid = fixedVersions.filter((v): v is string => {
    if (!v) return false;
    if (!includePrerelease && parseVersion(v)?.prerelease) return false;
    return true;
  });
  
  if (valid.length === 0) return null;
  
  // Sort in descending order and return highest
  valid.sort((a, b) => compareVersions(b, a));
  return valid[0];
}

/**
 * Generate fix suggestion for a vulnerable package
 */
export async function generateFixSuggestion(
  pkg: VulnerablePackage,
  options: FixOptions = {}
): Promise<FixSuggestion | UnfixablePackage> {
  const { osvClient = new OSVClient(), includePrerelease = false, maxMajorBump = 1 } = options;
  
  const vulnerabilityFixes: VulnerabilityFix[] = [];
  const fixedVersions: (string | null)[] = [];
  
  // Query OSV for each vulnerability
  for (const vulnId of pkg.vulnerabilities) {
    try {
      const vuln = await osvClient.getVulnerability(vulnId);
      if (vuln) {
        const fixedIn = extractFixedVersion(vuln, pkg.name, pkg.ecosystem);
        fixedVersions.push(fixedIn);
        
        // Get severity from database_specific or severity array
        let severity: string | null = null;
        if (vuln.severity && vuln.severity.length > 0) {
          severity = vuln.severity[0].type === 'CVSS_V3' 
            ? `CVSS ${vuln.severity[0].score}`
            : vuln.severity[0].score;
        }
        if (!severity && vuln.database_specific) {
          severity = (vuln.database_specific as Record<string, unknown>).severity as string || null;
        }
        
        vulnerabilityFixes.push({
          id: vulnId,
          fixedIn,
          severity,
        });
      } else {
        vulnerabilityFixes.push({
          id: vulnId,
          fixedIn: null,
          severity: null,
        });
      }
    } catch {
      vulnerabilityFixes.push({
        id: vulnId,
        fixedIn: null,
        severity: null,
      });
    }
  }
  
  // Determine suggested version
  const suggestedVersion = getHighestFixedVersion(fixedVersions, includePrerelease);
  
  // Check if unfixable
  if (!suggestedVersion) {
    return {
      package: pkg.name,
      version: pkg.version,
      ecosystem: pkg.ecosystem,
      reason: 'No fixed version available in OSV database',
      vulnerabilities: pkg.vulnerabilities,
    };
  }
  
  // Check major version bump limit
  const currentParsed = parseVersion(pkg.version);
  const suggestedParsed = parseVersion(suggestedVersion);
  
  if (currentParsed && suggestedParsed) {
    const majorDiff = suggestedParsed.major - currentParsed.major;
    if (majorDiff > maxMajorBump) {
      return {
        package: pkg.name,
        version: pkg.version,
        ecosystem: pkg.ecosystem,
        reason: `Fix requires ${majorDiff} major version bumps (max allowed: ${maxMajorBump})`,
        vulnerabilities: pkg.vulnerabilities,
      };
    }
  }
  
  // Generate upgrade command
  const pm = ECOSYSTEM_TO_PM[pkg.ecosystem.toLowerCase()] || pkg.ecosystem.toLowerCase();
  const cmdGenerator = UPGRADE_COMMANDS[pm];
  const upgradeCommand = cmdGenerator ? cmdGenerator(pkg.name, suggestedVersion) : null;
  
  // Calculate risk
  const risk = calculateRisk(pkg.version, suggestedVersion);
  const breaking = getVersionBumpType(pkg.version, suggestedVersion) === 'major';
  
  // Generate notes
  const notes: string[] = [];
  if (breaking) {
    notes.push('⚠️  Major version bump - review breaking changes');
  }
  if (vulnerabilityFixes.some(v => v.fixedIn === null)) {
    notes.push('⚠️  Some vulnerabilities may not be fixed by this upgrade');
  }
  
  return {
    package: pkg.name,
    currentVersion: pkg.version,
    ecosystem: pkg.ecosystem,
    vulnerabilities: vulnerabilityFixes,
    suggestedVersion,
    upgradeCommand,
    risk,
    breaking,
    notes,
  };
}

/**
 * Generate fix suggestions for multiple packages
 */
export async function suggestFixes(
  packages: VulnerablePackage[],
  options: FixOptions = {}
): Promise<FixReport> {
  const suggestions: FixSuggestion[] = [];
  const unfixable: UnfixablePackage[] = [];
  
  for (const pkg of packages) {
    const result = await generateFixSuggestion(pkg, options);
    
    if ('reason' in result) {
      unfixable.push(result);
    } else {
      suggestions.push(result);
    }
  }
  
  // Sort suggestions by risk (high first)
  const riskOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);
  
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalVulnerable: packages.length,
      fixable: suggestions.length,
      unfixable: unfixable.length,
      breakingChanges: suggestions.filter(s => s.breaking).length,
    },
    suggestions,
    unfixable,
  };
}

// =============================================================================
// Report Formatting
// =============================================================================

/**
 * Format fix report as text
 */
export function formatFixReport(report: FixReport): string {
  const lines: string[] = [];
  
  // Header
  lines.push('═══════════════════════════════════════════════════════════════════');
  lines.push('                    ReachVet Fix Suggestions');
  lines.push('═══════════════════════════════════════════════════════════════════');
  lines.push('');
  
  // Summary
  lines.push('📊 Summary');
  lines.push('───────────────────────────────────────────────────────────────────');
  lines.push(`  Total vulnerable packages: ${report.summary.totalVulnerable}`);
  lines.push(`  Fixable:                   ${report.summary.fixable}`);
  lines.push(`  No fix available:          ${report.summary.unfixable}`);
  lines.push(`  Breaking changes:          ${report.summary.breakingChanges}`);
  lines.push('');
  
  // Fixable packages
  if (report.suggestions.length > 0) {
    lines.push('✅ Suggested Fixes');
    lines.push('───────────────────────────────────────────────────────────────────');
    
    for (const fix of report.suggestions) {
      const riskIcon = fix.risk === 'high' ? '🔴' : fix.risk === 'medium' ? '🟡' : '🟢';
      lines.push(`  ${riskIcon} ${fix.package} ${fix.currentVersion} → ${fix.suggestedVersion}`);
      lines.push(`     Ecosystem: ${fix.ecosystem}`);
      
      if (fix.vulnerabilities.length > 0) {
        const vulnList = fix.vulnerabilities
          .map(v => v.id + (v.severity ? ` (${v.severity})` : ''))
          .join(', ');
        lines.push(`     Fixes: ${vulnList}`);
      }
      
      if (fix.upgradeCommand) {
        lines.push(`     Command: ${fix.upgradeCommand}`);
      }
      
      for (const note of fix.notes) {
        lines.push(`     ${note}`);
      }
      
      lines.push('');
    }
  }
  
  // Unfixable packages
  if (report.unfixable.length > 0) {
    lines.push('❌ No Fix Available');
    lines.push('───────────────────────────────────────────────────────────────────');
    
    for (const pkg of report.unfixable) {
      lines.push(`  • ${pkg.package}@${pkg.version} (${pkg.ecosystem})`);
      lines.push(`    Reason: ${pkg.reason}`);
      lines.push(`    Vulnerabilities: ${pkg.vulnerabilities.join(', ')}`);
      lines.push('');
    }
  }
  
  // Quick commands section
  const allCommands = report.suggestions
    .filter(s => s.upgradeCommand)
    .map(s => s.upgradeCommand!);
  
  if (allCommands.length > 0) {
    lines.push('🚀 Quick Fix Commands');
    lines.push('───────────────────────────────────────────────────────────────────');
    lines.push('  # Run all suggested upgrades:');
    for (const cmd of allCommands) {
      lines.push(`  ${cmd}`);
    }
    lines.push('');
  }
  
  lines.push('═══════════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Format fix report as JSON
 */
export function toFixJson(report: FixReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Generate a shell script with all fix commands
 */
export function generateFixScript(report: FixReport, options: { shell?: 'bash' | 'powershell' } = {}): string {
  const { shell = 'bash' } = options;
  const lines: string[] = [];
  
  if (shell === 'bash') {
    lines.push('#!/bin/bash');
    lines.push('# ReachVet Auto-Fix Script');
    lines.push(`# Generated: ${report.timestamp}`);
    lines.push('set -e');
    lines.push('');
    
    for (const fix of report.suggestions) {
      if (fix.upgradeCommand) {
        if (fix.breaking) {
          lines.push(`# ⚠️  Breaking change: ${fix.package}`);
        }
        lines.push(`echo "Upgrading ${fix.package} to ${fix.suggestedVersion}..."`);
        lines.push(fix.upgradeCommand);
        lines.push('');
      }
    }
    
    lines.push('echo "✅ All fixes applied!"');
  } else {
    lines.push('# ReachVet Auto-Fix Script (PowerShell)');
    lines.push(`# Generated: ${report.timestamp}`);
    lines.push('$ErrorActionPreference = "Stop"');
    lines.push('');
    
    for (const fix of report.suggestions) {
      if (fix.upgradeCommand) {
        if (fix.breaking) {
          lines.push(`# ⚠️  Breaking change: ${fix.package}`);
        }
        lines.push(`Write-Host "Upgrading ${fix.package} to ${fix.suggestedVersion}..."`);
        lines.push(fix.upgradeCommand);
        lines.push('');
      }
    }
    
    lines.push('Write-Host "✅ All fixes applied!"');
  }
  
  return lines.join('\n');
}
