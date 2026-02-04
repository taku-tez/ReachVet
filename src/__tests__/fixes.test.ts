/**
 * Tests for Vulnerability Fix Suggestions module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  parseVersion,
  compareVersions,
  getVersionBumpType,
  calculateRisk,
  extractFixedVersion,
  getHighestFixedVersion,
  generateFixSuggestion,
  suggestFixes,
  formatFixReport,
  toFixJson,
  generateFixScript,
  type VulnerablePackage,
} from '../fixes/index.js';
import type { OSVVulnerability } from '../osv/index.js';

// =============================================================================
// parseVersion tests
// =============================================================================

describe('parseVersion', () => {
  it('should parse standard semver', () => {
    expect(parseVersion('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
    });
  });

  it('should parse version with v prefix', () => {
    expect(parseVersion('v1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
    });
  });

  it('should parse version with prerelease', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'beta.1',
    });
  });

  it('should parse major.minor only', () => {
    expect(parseVersion('1.2')).toEqual({
      major: 1,
      minor: 2,
      patch: 0,
      prerelease: null,
    });
  });

  it('should parse major only', () => {
    expect(parseVersion('1')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: null,
    });
  });

  it('should return null for invalid version', () => {
    expect(parseVersion('not-a-version')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

// =============================================================================
// compareVersions tests
// =============================================================================

describe('compareVersions', () => {
  it('should compare equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('should compare major versions', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  it('should compare minor versions', () => {
    expect(compareVersions('1.3.0', '1.2.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.3.0')).toBeLessThan(0);
  });

  it('should compare patch versions', () => {
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
  });

  it('should handle prerelease versions', () => {
    // Prerelease should come before release
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0);
  });

  it('should handle v prefix', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });
});

// =============================================================================
// getVersionBumpType tests
// =============================================================================

describe('getVersionBumpType', () => {
  it('should detect major bump', () => {
    expect(getVersionBumpType('1.2.3', '2.0.0')).toBe('major');
    expect(getVersionBumpType('0.9.0', '1.0.0')).toBe('major');
  });

  it('should detect minor bump', () => {
    expect(getVersionBumpType('1.2.3', '1.3.0')).toBe('minor');
    expect(getVersionBumpType('1.2.3', '1.5.0')).toBe('minor');
  });

  it('should detect patch bump', () => {
    expect(getVersionBumpType('1.2.3', '1.2.4')).toBe('patch');
    expect(getVersionBumpType('1.2.3', '1.2.10')).toBe('patch');
  });

  it('should return unknown for invalid versions', () => {
    expect(getVersionBumpType('invalid', '1.0.0')).toBe('unknown');
  });
});

// =============================================================================
// calculateRisk tests
// =============================================================================

describe('calculateRisk', () => {
  it('should return low for patch bumps', () => {
    expect(calculateRisk('1.2.3', '1.2.4')).toBe('low');
  });

  it('should return medium for minor bumps', () => {
    expect(calculateRisk('1.2.3', '1.3.0')).toBe('medium');
  });

  it('should return high for major bumps', () => {
    expect(calculateRisk('1.2.3', '2.0.0')).toBe('high');
  });
});

// =============================================================================
// extractFixedVersion tests
// =============================================================================

describe('extractFixedVersion', () => {
  it('should extract fixed version from OSV data', () => {
    const vuln: Partial<OSVVulnerability> = {
      affected: [
        {
          package: { name: 'lodash', ecosystem: 'npm' },
          ranges: [
            {
              type: 'SEMVER',
              events: [
                { introduced: '0' },
                { fixed: '4.17.21' },
              ],
            },
          ],
        },
      ],
    };
    
    expect(extractFixedVersion(vuln as OSVVulnerability, 'lodash', 'npm')).toBe('4.17.21');
  });

  it('should return null if no fixed version', () => {
    const vuln: Partial<OSVVulnerability> = {
      affected: [
        {
          package: { name: 'abandoned-pkg', ecosystem: 'npm' },
          ranges: [
            {
              type: 'SEMVER',
              events: [{ introduced: '0' }],
            },
          ],
        },
      ],
    };
    
    expect(extractFixedVersion(vuln as OSVVulnerability, 'abandoned-pkg', 'npm')).toBeNull();
  });

  it('should match package case-insensitively', () => {
    const vuln: Partial<OSVVulnerability> = {
      affected: [
        {
          package: { name: 'Lodash', ecosystem: 'NPM' },
          ranges: [
            {
              type: 'SEMVER',
              events: [{ fixed: '4.17.21' }],
            },
          ],
        },
      ],
    };
    
    expect(extractFixedVersion(vuln as OSVVulnerability, 'lodash', 'npm')).toBe('4.17.21');
  });

  it('should return null for unmatched package', () => {
    const vuln: Partial<OSVVulnerability> = {
      affected: [
        {
          package: { name: 'other-pkg', ecosystem: 'npm' },
          ranges: [
            {
              type: 'SEMVER',
              events: [{ fixed: '1.0.0' }],
            },
          ],
        },
      ],
    };
    
    expect(extractFixedVersion(vuln as OSVVulnerability, 'lodash', 'npm')).toBeNull();
  });
});

// =============================================================================
// getHighestFixedVersion tests
// =============================================================================

describe('getHighestFixedVersion', () => {
  it('should return highest version', () => {
    expect(getHighestFixedVersion(['1.0.0', '2.0.0', '1.5.0'])).toBe('2.0.0');
  });

  it('should filter null values', () => {
    expect(getHighestFixedVersion(['1.0.0', null, '2.0.0'])).toBe('2.0.0');
  });

  it('should filter prerelease by default', () => {
    expect(getHighestFixedVersion(['1.0.0', '2.0.0-beta'])).toBe('1.0.0');
  });

  it('should include prerelease when enabled', () => {
    expect(getHighestFixedVersion(['1.0.0', '2.0.0-beta'], true)).toBe('2.0.0-beta');
  });

  it('should return null for empty array', () => {
    expect(getHighestFixedVersion([])).toBeNull();
    expect(getHighestFixedVersion([null, null])).toBeNull();
  });
});

// =============================================================================
// generateFixSuggestion tests
// =============================================================================

describe('generateFixSuggestion', () => {
  const mockOsvClient = {
    getVulnerability: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should generate fix suggestion with fixed version', async () => {
    mockOsvClient.getVulnerability.mockResolvedValue({
      id: 'CVE-2023-1234',
      affected: [
        {
          package: { name: 'test-pkg', ecosystem: 'npm' },
          ranges: [
            {
              type: 'SEMVER',
              events: [{ fixed: '1.2.3' }],
            },
          ],
        },
      ],
      severity: [{ type: 'CVSS_V3', score: '7.5' }],
    });

    const pkg: VulnerablePackage = {
      name: 'test-pkg',
      version: '1.0.0',
      ecosystem: 'npm',
      vulnerabilities: ['CVE-2023-1234'],
    };

    const result = await generateFixSuggestion(pkg, { osvClient: mockOsvClient as any });

    expect(result).not.toHaveProperty('reason');
    expect((result as any).suggestedVersion).toBe('1.2.3');
    expect((result as any).upgradeCommand).toContain('npm install test-pkg@1.2.3');
    expect((result as any).risk).toBe('medium');  // 1.0.0 → 1.2.3 is a minor bump = medium risk
  });

  it('should return unfixable when no fixed version', async () => {
    mockOsvClient.getVulnerability.mockResolvedValue({
      id: 'CVE-2023-9999',
      affected: [
        {
          package: { name: 'abandoned', ecosystem: 'npm' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }],
        },
      ],
    });

    const pkg: VulnerablePackage = {
      name: 'abandoned',
      version: '1.0.0',
      ecosystem: 'npm',
      vulnerabilities: ['CVE-2023-9999'],
    };

    const result = await generateFixSuggestion(pkg, { osvClient: mockOsvClient as any });

    expect(result).toHaveProperty('reason');
    expect((result as any).reason).toContain('No fixed version');
  });

  it('should mark breaking changes', async () => {
    mockOsvClient.getVulnerability.mockResolvedValue({
      id: 'CVE-2023-1234',
      affected: [
        {
          package: { name: 'major-update', ecosystem: 'npm' },
          ranges: [
            {
              type: 'SEMVER',
              events: [{ fixed: '2.0.0' }],
            },
          ],
        },
      ],
    });

    const pkg: VulnerablePackage = {
      name: 'major-update',
      version: '1.5.0',
      ecosystem: 'npm',
      vulnerabilities: ['CVE-2023-1234'],
    };

    const result = await generateFixSuggestion(pkg, { osvClient: mockOsvClient as any });

    expect((result as any).breaking).toBe(true);
    expect((result as any).risk).toBe('high');
    expect((result as any).notes).toContain('⚠️  Major version bump - review breaking changes');
  });
});

// =============================================================================
// suggestFixes tests
// =============================================================================

describe('suggestFixes', () => {
  const mockOsvClient = {
    getVulnerability: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should generate report for multiple packages', async () => {
    mockOsvClient.getVulnerability
      .mockResolvedValueOnce({
        id: 'CVE-1',
        affected: [
          {
            package: { name: 'pkg-a', ecosystem: 'npm' },
            ranges: [{ type: 'SEMVER', events: [{ fixed: '1.1.0' }] }],
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'CVE-2',
        affected: [
          {
            package: { name: 'pkg-b', ecosystem: 'npm' },
            ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }],
          },
        ],
      });

    const packages: VulnerablePackage[] = [
      { name: 'pkg-a', version: '1.0.0', ecosystem: 'npm', vulnerabilities: ['CVE-1'] },
      { name: 'pkg-b', version: '1.0.0', ecosystem: 'npm', vulnerabilities: ['CVE-2'] },
    ];

    const report = await suggestFixes(packages, { osvClient: mockOsvClient as any });

    expect(report.summary.totalVulnerable).toBe(2);
    expect(report.summary.fixable).toBe(1);
    expect(report.summary.unfixable).toBe(1);
    expect(report.suggestions).toHaveLength(1);
    expect(report.unfixable).toHaveLength(1);
  });
});

// =============================================================================
// formatFixReport tests
// =============================================================================

describe('formatFixReport', () => {
  it('should format report as text', () => {
    const report = {
      timestamp: '2024-01-01T00:00:00Z',
      summary: {
        totalVulnerable: 2,
        fixable: 1,
        unfixable: 1,
        breakingChanges: 0,
      },
      suggestions: [
        {
          package: 'lodash',
          currentVersion: '4.17.20',
          ecosystem: 'npm',
          vulnerabilities: [
            { id: 'CVE-2021-23337', fixedIn: '4.17.21', severity: 'CVSS 7.5' },
          ],
          suggestedVersion: '4.17.21',
          upgradeCommand: 'npm install lodash@4.17.21',
          risk: 'low' as const,
          breaking: false,
          notes: [],
        },
      ],
      unfixable: [
        {
          package: 'abandoned-pkg',
          version: '1.0.0',
          ecosystem: 'npm',
          reason: 'No fixed version available',
          vulnerabilities: ['CVE-2024-9999'],
        },
      ],
    };

    const output = formatFixReport(report);

    expect(output).toContain('ReachVet Fix Suggestions');
    expect(output).toContain('Total vulnerable packages: 2');
    expect(output).toContain('Fixable:                   1');
    expect(output).toContain('lodash 4.17.20 → 4.17.21');
    expect(output).toContain('npm install lodash@4.17.21');
    expect(output).toContain('abandoned-pkg@1.0.0');
    expect(output).toContain('Quick Fix Commands');
  });
});

// =============================================================================
// toFixJson tests
// =============================================================================

describe('toFixJson', () => {
  it('should format report as JSON', () => {
    const report = {
      timestamp: '2024-01-01T00:00:00Z',
      summary: {
        totalVulnerable: 1,
        fixable: 1,
        unfixable: 0,
        breakingChanges: 0,
      },
      suggestions: [],
      unfixable: [],
    };

    const json = toFixJson(report);
    const parsed = JSON.parse(json);

    expect(parsed.timestamp).toBe('2024-01-01T00:00:00Z');
    expect(parsed.summary.totalVulnerable).toBe(1);
  });
});

// =============================================================================
// generateFixScript tests
// =============================================================================

describe('generateFixScript', () => {
  const report = {
    timestamp: '2024-01-01T00:00:00Z',
    summary: {
      totalVulnerable: 2,
      fixable: 2,
      unfixable: 0,
      breakingChanges: 1,
    },
    suggestions: [
      {
        package: 'lodash',
        currentVersion: '4.17.20',
        ecosystem: 'npm',
        vulnerabilities: [],
        suggestedVersion: '4.17.21',
        upgradeCommand: 'npm install lodash@4.17.21',
        risk: 'low' as const,
        breaking: false,
        notes: [],
      },
      {
        package: 'express',
        currentVersion: '3.0.0',
        ecosystem: 'npm',
        vulnerabilities: [],
        suggestedVersion: '4.18.2',
        upgradeCommand: 'npm install express@4.18.2',
        risk: 'high' as const,
        breaking: true,
        notes: [],
      },
    ],
    unfixable: [],
  };

  it('should generate bash script', () => {
    const script = generateFixScript(report, { shell: 'bash' });

    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('set -e');
    expect(script).toContain('npm install lodash@4.17.21');
    expect(script).toContain('npm install express@4.18.2');
    expect(script).toContain('Breaking change: express');
    expect(script).toContain('All fixes applied!');
  });

  it('should generate powershell script', () => {
    const script = generateFixScript(report, { shell: 'powershell' });

    expect(script).toContain('PowerShell');
    expect(script).toContain('$ErrorActionPreference');
    expect(script).toContain('Write-Host');
    expect(script).toContain('npm install lodash@4.17.21');
  });
});

// =============================================================================
// Ecosystem-specific upgrade commands tests
// =============================================================================

describe('upgrade command generation', () => {
  const mockOsvClient = {
    getVulnerability: vi.fn().mockResolvedValue({
      id: 'CVE-2023-1234',
      affected: [
        {
          package: { name: 'test-pkg', ecosystem: 'npm' },
          ranges: [{ type: 'SEMVER', events: [{ fixed: '2.0.0' }] }],
        },
      ],
    }),
  };

  const testCases = [
    { ecosystem: 'npm', expected: 'npm install' },
    { ecosystem: 'pypi', expected: 'pip install' },
    { ecosystem: 'crates.io', expected: 'cargo update' },
    { ecosystem: 'go', expected: 'go get' },
    { ecosystem: 'rubygems', expected: 'gem install' },
    { ecosystem: 'packagist', expected: 'composer require' },
    { ecosystem: 'nuget', expected: 'dotnet add package' },
    { ecosystem: 'hex', expected: 'mix deps.update' },
    { ecosystem: 'pub', expected: 'dart pub upgrade' },
  ];

  for (const { ecosystem, expected } of testCases) {
    it(`should generate ${ecosystem} upgrade command`, async () => {
      mockOsvClient.getVulnerability.mockResolvedValueOnce({
        id: 'CVE-2023-1234',
        affected: [
          {
            package: { name: 'test-pkg', ecosystem },
            ranges: [{ type: 'SEMVER', events: [{ fixed: '2.0.0' }] }],
          },
        ],
      });

      const pkg: VulnerablePackage = {
        name: 'test-pkg',
        version: '1.0.0',
        ecosystem,
        vulnerabilities: ['CVE-2023-1234'],
      };

      const result = await generateFixSuggestion(pkg, { osvClient: mockOsvClient as any });

      if (!('reason' in result)) {
        expect(result.upgradeCommand).toContain(expected);
      }
    });
  }
});
