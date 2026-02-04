/**
 * Tests for Dependency Freshness Check
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkFreshness,
  formatFreshnessResult,
  formatFreshnessReport,
  toFreshnessJson,
  parseVersion,
  compareVersions,
  calculateVersionsBehind,
  determineSeverity,
  FreshnessResult,
} from '../freshness/index.js';
import { Dependency } from '../types.js';

describe('Freshness - Version Parsing', () => {
  it('parses simple semver', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('0.0.1')).toEqual({ major: 0, minor: 0, patch: 1 });
    expect(parseVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it('parses version with v prefix', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('v0.0.1')).toEqual({ major: 0, minor: 0, patch: 1 });
  });

  it('parses version with prerelease', () => {
    expect(parseVersion('1.2.3-alpha')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: 'alpha' });
    expect(parseVersion('1.0.0-beta.1')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: 'beta.1' });
    expect(parseVersion('2.0.0-rc.1')).toEqual({ major: 2, minor: 0, patch: 0, prerelease: 'rc.1' });
  });

  it('returns null for invalid versions', () => {
    expect(parseVersion('invalid')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('Freshness - Version Comparison', () => {
  it('compares major versions', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('compares minor versions', () => {
    expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
  });

  it('compares patch versions', () => {
    expect(compareVersions('1.0.1', '1.0.2')).toBeLessThan(0);
    expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
  });

  it('handles prerelease versions', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0);
  });

  it('handles v prefix', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('v1.0.0', 'v2.0.0')).toBeLessThan(0);
  });
});

describe('Freshness - Versions Behind Calculation', () => {
  it('calculates major version difference', () => {
    expect(calculateVersionsBehind('1.0.0', '2.0.0')).toBe(100);
    expect(calculateVersionsBehind('1.0.0', '3.0.0')).toBe(200);
  });

  it('calculates minor version difference', () => {
    expect(calculateVersionsBehind('1.0.0', '1.1.0')).toBe(10);
    expect(calculateVersionsBehind('1.0.0', '1.5.0')).toBe(50);
  });

  it('calculates patch version difference', () => {
    expect(calculateVersionsBehind('1.0.0', '1.0.1')).toBe(1);
    expect(calculateVersionsBehind('1.0.0', '1.0.5')).toBe(5);
  });

  it('calculates combined difference', () => {
    expect(calculateVersionsBehind('1.0.0', '2.3.5')).toBe(100 + 30 + 5);
    expect(calculateVersionsBehind('1.2.3', '1.5.10')).toBe(30 + 7);
  });

  it('returns 0 when current is latest', () => {
    expect(calculateVersionsBehind('1.0.0', '1.0.0')).toBe(0);
    expect(calculateVersionsBehind('2.0.0', '1.0.0')).toBe(0);
  });
});

describe('Freshness - Severity Determination', () => {
  it('determines current severity', () => {
    expect(determineSeverity('1.0.0', '1.0.0')).toBe('current');
  });

  it('determines minor severity', () => {
    expect(determineSeverity('1.0.0', '1.0.1')).toBe('minor');
    expect(determineSeverity('1.0.0', '1.1.0')).toBe('minor');
    expect(determineSeverity('1.0.0', '1.4.0')).toBe('minor');
  });

  it('determines major severity for minor version diff >= 5', () => {
    expect(determineSeverity('1.0.0', '1.5.0')).toBe('major');
    expect(determineSeverity('1.0.0', '1.10.0')).toBe('major');
  });

  it('determines major severity for major version diff = 1', () => {
    expect(determineSeverity('1.0.0', '2.0.0')).toBe('major');
  });

  it('determines critical severity for major version diff >= 2', () => {
    expect(determineSeverity('1.0.0', '3.0.0')).toBe('critical');
    expect(determineSeverity('1.0.0', '5.0.0')).toBe('critical');
  });
});

describe('Freshness - Result Formatting', () => {
  it('formats current dependency', () => {
    const result: FreshnessResult = {
      dependency: { name: 'lodash', version: '4.17.21', ecosystem: 'npm' },
      currentVersion: '4.17.21',
      latestVersion: '4.17.21',
      versionsBehind: 0,
      isOutdated: false,
      isDeprecated: false,
      severity: 'current',
    };
    expect(formatFreshnessResult(result)).toBe('✅ lodash@4.17.21 → 4.17.21');
  });

  it('formats outdated dependency with minor severity', () => {
    const result: FreshnessResult = {
      dependency: { name: 'axios', version: '1.5.0', ecosystem: 'npm' },
      currentVersion: '1.5.0',
      latestVersion: '1.6.0',
      versionsBehind: 10,
      isOutdated: true,
      isDeprecated: false,
      severity: 'minor',
    };
    expect(formatFreshnessResult(result)).toBe('🟡 axios@1.5.0 → 1.6.0');
  });

  it('formats outdated dependency with major severity', () => {
    const result: FreshnessResult = {
      dependency: { name: 'express', version: '4.0.0', ecosystem: 'npm' },
      currentVersion: '4.0.0',
      latestVersion: '5.0.0',
      versionsBehind: 100,
      isOutdated: true,
      isDeprecated: false,
      severity: 'major',
    };
    expect(formatFreshnessResult(result)).toBe('🟠 express@4.0.0 → 5.0.0');
  });

  it('formats outdated dependency with critical severity', () => {
    const result: FreshnessResult = {
      dependency: { name: 'old-pkg', version: '1.0.0', ecosystem: 'npm' },
      currentVersion: '1.0.0',
      latestVersion: '4.0.0',
      versionsBehind: 300,
      isOutdated: true,
      isDeprecated: false,
      severity: 'critical',
    };
    expect(formatFreshnessResult(result)).toBe('🔴 old-pkg@1.0.0 → 4.0.0');
  });

  it('formats deprecated dependency', () => {
    const result: FreshnessResult = {
      dependency: { name: 'request', version: '2.88.2', ecosystem: 'npm' },
      currentVersion: '2.88.2',
      latestVersion: '2.88.2',
      versionsBehind: 0,
      isOutdated: false,
      isDeprecated: true,
      deprecationMessage: 'Use axios or node-fetch instead',
      severity: 'current',
    };
    expect(formatFreshnessResult(result)).toBe('✅ request@2.88.2 → 2.88.2 [DEPRECATED]');
  });
});

describe('Freshness - Report Formatting', () => {
  it('formats report summary', () => {
    const report = {
      checkedAt: '2026-02-05T01:00:00.000Z',
      totalDependencies: 10,
      outdated: 3,
      deprecated: 1,
      current: 5,
      failed: 1,
      results: [],
      summary: {
        byEcosystem: { npm: { total: 10, outdated: 3 } },
        bySeverity: { current: 5, minor: 2, major: 1, critical: 0 },
      },
    };

    const formatted = formatFreshnessReport(report);
    expect(formatted).toContain('Dependency Freshness Report');
    expect(formatted).toContain('Total: 10');
    expect(formatted).toContain('✅ Current: 5');
    expect(formatted).toContain('🟡 Outdated (minor): 2');
    expect(formatted).toContain('[npm] 3/10 outdated');
  });

  it('lists outdated dependencies', () => {
    const report = {
      checkedAt: '2026-02-05T01:00:00.000Z',
      totalDependencies: 2,
      outdated: 1,
      deprecated: 0,
      current: 1,
      failed: 0,
      results: [
        {
          dependency: { name: 'lodash', version: '4.17.21', ecosystem: 'npm' as const },
          currentVersion: '4.17.21',
          latestVersion: '4.17.21',
          versionsBehind: 0,
          isOutdated: false,
          isDeprecated: false,
          severity: 'current' as const,
        },
        {
          dependency: { name: 'axios', version: '1.5.0', ecosystem: 'npm' as const },
          currentVersion: '1.5.0',
          latestVersion: '1.6.0',
          versionsBehind: 10,
          isOutdated: true,
          isDeprecated: false,
          severity: 'minor' as const,
        },
      ],
      summary: {
        byEcosystem: { npm: { total: 2, outdated: 1 } },
        bySeverity: { current: 1, minor: 1, major: 0, critical: 0 },
      },
    };

    const formatted = formatFreshnessReport(report);
    expect(formatted).toContain('Outdated Dependencies');
    expect(formatted).toContain('🟡 axios@1.5.0 → 1.6.0');
    expect(formatted).not.toContain('lodash'); // current deps not listed
  });
});

describe('Freshness - JSON Export', () => {
  it('exports report as JSON', () => {
    const report = {
      checkedAt: '2026-02-05T01:00:00.000Z',
      totalDependencies: 1,
      outdated: 0,
      deprecated: 0,
      current: 1,
      failed: 0,
      results: [],
      summary: {
        byEcosystem: {},
        bySeverity: { current: 1, minor: 0, major: 0, critical: 0 },
      },
    };

    const json = toFreshnessJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.checkedAt).toBe('2026-02-05T01:00:00.000Z');
    expect(parsed.totalDependencies).toBe(1);
  });
});

describe('Freshness - Check Dependencies (Mock)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks npm dependencies', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'dist-tags': { latest: '4.17.21' },
        time: { '4.17.21': '2021-02-20T00:00:00.000Z' },
      }),
    });

    const deps: Dependency[] = [{ name: 'lodash', version: '4.17.20', ecosystem: 'npm' }];
    const report = await checkFreshness(deps, { timeout: 5000 });

    expect(report.totalDependencies).toBe(1);
    expect(report.outdated).toBe(1);
    expect(report.results[0].latestVersion).toBe('4.17.21');
    expect(report.results[0].isOutdated).toBe(true);
  });

  it('handles fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const deps: Dependency[] = [{ name: 'lodash', version: '4.17.21', ecosystem: 'npm' }];
    const report = await checkFreshness(deps, { timeout: 5000 });

    expect(report.totalDependencies).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.results[0].error).toBeDefined();
  });

  it('handles deprecated packages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'dist-tags': { latest: '2.88.2' },
        deprecated: 'Use axios instead',
      }),
    });

    const deps: Dependency[] = [{ name: 'request', version: '2.88.2', ecosystem: 'npm' }];
    const report = await checkFreshness(deps, { timeout: 5000 });

    expect(report.deprecated).toBe(1);
    expect(report.results[0].isDeprecated).toBe(true);
    expect(report.results[0].deprecationMessage).toBe('Use axios instead');
  });

  it('checks pypi dependencies', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        info: { version: '2.31.0', yanked: false },
        releases: { '2.31.0': [{ upload_time: '2023-05-22T00:00:00.000Z' }] },
      }),
    });

    const deps: Dependency[] = [{ name: 'requests', version: '2.28.0', ecosystem: 'pypi' }];
    const report = await checkFreshness(deps, { timeout: 5000 });

    expect(report.results[0].latestVersion).toBe('2.31.0');
    expect(report.results[0].isOutdated).toBe(true);
  });

  it('checks cargo dependencies', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        crate: { max_version: '1.0.195', updated_at: '2024-01-01T00:00:00.000Z' },
        versions: [{ num: '1.0.195', yanked: false }],
      }),
    });

    const deps: Dependency[] = [{ name: 'serde', version: '1.0.190', ecosystem: 'cargo' }];
    const report = await checkFreshness(deps, { timeout: 5000 });

    expect(report.results[0].latestVersion).toBe('1.0.195');
    expect(report.results[0].isOutdated).toBe(true);
  });

  it('respects concurrency limit', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '1.0.0' } }),
    }));

    const deps: Dependency[] = Array.from({ length: 25 }, (_, i) => ({
      name: `pkg-${i}`,
      version: '1.0.0',
      ecosystem: 'npm' as const,
    }));

    const report = await checkFreshness(deps, { concurrency: 5, timeout: 5000 });

    expect(report.totalDependencies).toBe(25);
  });

  it('calculates ecosystem summary', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'dist-tags': { latest: '2.0.0' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'dist-tags': { latest: '1.0.0' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ info: { version: '2.0.0' } }),
      });

    const deps: Dependency[] = [
      { name: 'pkg1', version: '1.0.0', ecosystem: 'npm' },
      { name: 'pkg2', version: '1.0.0', ecosystem: 'npm' },
      { name: 'pkg3', version: '1.0.0', ecosystem: 'pypi' },
    ];
    const report = await checkFreshness(deps, { timeout: 5000 });

    expect(report.summary.byEcosystem.npm.total).toBe(2);
    expect(report.summary.byEcosystem.npm.outdated).toBe(1);
    expect(report.summary.byEcosystem.pypi.total).toBe(1);
    expect(report.summary.byEcosystem.pypi.outdated).toBe(1);
  });

  it('calculates severity summary', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'dist-tags': { latest: '1.0.0' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'dist-tags': { latest: '1.1.0' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 'dist-tags': { latest: '3.0.0' } }),
      });

    const deps: Dependency[] = [
      { name: 'current', version: '1.0.0', ecosystem: 'npm' },
      { name: 'minor', version: '1.0.0', ecosystem: 'npm' },
      { name: 'critical', version: '1.0.0', ecosystem: 'npm' },
    ];
    const report = await checkFreshness(deps, { timeout: 5000 });

    expect(report.summary.bySeverity.current).toBe(1);
    expect(report.summary.bySeverity.minor).toBe(1);
    expect(report.summary.bySeverity.critical).toBe(1);
  });
});

describe('Freshness - Unsupported Ecosystems', () => {
  it('handles unsupported ecosystem gracefully', async () => {
    const deps: Dependency[] = [{ name: 'unknown-pkg', version: '1.0.0', ecosystem: 'maven' }];
    const report = await checkFreshness(deps, { timeout: 5000 });

    expect(report.totalDependencies).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.results[0].error).toContain('Could not fetch');
  });
});
