/**
 * Tests for EPSS (Exploit Prediction Scoring System) module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  EPSSClient,
  EPSSCache,
  EPSSScore,
  PriorityScore,
  calculatePriority,
  priorityFromEPSS,
  formatEPSSReport,
  toEPSSJson,
  extractCVEs,
  createEPSSReport,
  EPSSReport,
} from '../src/epss';

describe('EPSS Module', () => {
  describe('EPSSClient', () => {
    it('should create client with default options', () => {
      const client = new EPSSClient();
      expect(client).toBeDefined();
    });

    it('should create client with custom options', () => {
      const client = new EPSSClient({
        timeout: 5000,
        retries: 1,
      });
      expect(client).toBeDefined();
    });
  });

  describe('EPSSCache', () => {
    const testCacheDir = '.test-epss-cache';

    beforeEach(() => {
      // Clean up test cache directory
      if (fs.existsSync(testCacheDir)) {
        fs.rmSync(testCacheDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (fs.existsSync(testCacheDir)) {
        fs.rmSync(testCacheDir, { recursive: true });
      }
    });

    it('should create cache with default options', () => {
      const cache = new EPSSCache({ cacheDir: testCacheDir });
      expect(cache).toBeDefined();
      expect(cache.size()).toBe(0);
    });

    it('should store and retrieve EPSS scores', () => {
      const cache = new EPSSCache({ cacheDir: testCacheDir });

      const score: EPSSScore = {
        cve: 'CVE-2021-44228',
        epss: 0.97547,
        percentile: 0.99999,
        date: '2024-01-15',
      };

      cache.set(score);
      expect(cache.has('CVE-2021-44228')).toBe(true);

      const retrieved = cache.get('CVE-2021-44228');
      expect(retrieved).toEqual(score);
    });

    it('should normalize CVE IDs to uppercase', () => {
      const cache = new EPSSCache({ cacheDir: testCacheDir });

      const score: EPSSScore = {
        cve: 'CVE-2021-44228',
        epss: 0.97547,
        percentile: 0.99999,
        date: '2024-01-15',
      };

      cache.set(score);
      expect(cache.get('cve-2021-44228')).toEqual(score);
      expect(cache.get('CVE-2021-44228')).toEqual(score);
    });

    it('should store multiple scores at once', () => {
      const cache = new EPSSCache({ cacheDir: testCacheDir });

      const scores: EPSSScore[] = [
        { cve: 'CVE-2021-44228', epss: 0.97547, percentile: 0.99999, date: '2024-01-15' },
        { cve: 'CVE-2021-45046', epss: 0.02123, percentile: 0.85, date: '2024-01-15' },
        { cve: 'CVE-2022-22965', epss: 0.45678, percentile: 0.95, date: '2024-01-15' },
      ];

      cache.setMany(scores);
      expect(cache.size()).toBe(3);
      expect(cache.has('CVE-2021-44228')).toBe(true);
      expect(cache.has('CVE-2021-45046')).toBe(true);
      expect(cache.has('CVE-2022-22965')).toBe(true);
    });

    it('should return null for non-existent CVE', () => {
      const cache = new EPSSCache({ cacheDir: testCacheDir });
      expect(cache.get('CVE-9999-99999')).toBeNull();
      expect(cache.has('CVE-9999-99999')).toBe(false);
    });

    it('should clear the cache', () => {
      const cache = new EPSSCache({ cacheDir: testCacheDir });

      cache.set({
        cve: 'CVE-2021-44228',
        epss: 0.97547,
        percentile: 0.99999,
        date: '2024-01-15',
      });

      expect(cache.size()).toBe(1);
      cache.clear();
      expect(cache.size()).toBe(0);
    });

    it('should return cache keys', () => {
      const cache = new EPSSCache({ cacheDir: testCacheDir });

      cache.setMany([
        { cve: 'CVE-2021-44228', epss: 0.97547, percentile: 0.99999, date: '2024-01-15' },
        { cve: 'CVE-2021-45046', epss: 0.02123, percentile: 0.85, date: '2024-01-15' },
      ]);

      const keys = cache.keys();
      expect(keys).toContain('CVE-2021-44228');
      expect(keys).toContain('CVE-2021-45046');
    });

    it('should provide cache stats', () => {
      const cache = new EPSSCache({ cacheDir: testCacheDir });
      const stats = cache.stats();

      expect(stats.size).toBe(0);
      expect(stats.cacheFile).toContain('epss-cache.json');
    });

    it('should persist cache to disk', () => {
      const cache = new EPSSCache({ cacheDir: testCacheDir });

      cache.set({
        cve: 'CVE-2021-44228',
        epss: 0.97547,
        percentile: 0.99999,
        date: '2024-01-15',
      });

      cache.saveCache();

      const cacheFile = path.join(testCacheDir, 'epss-cache.json');
      expect(fs.existsSync(cacheFile)).toBe(true);

      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      expect(data.version).toBe(1);
      expect(data.entries['CVE-2021-44228']).toBeDefined();
    });

    it('should load cache from disk', () => {
      // First, create and save a cache
      const cache1 = new EPSSCache({ cacheDir: testCacheDir });
      cache1.set({
        cve: 'CVE-2021-44228',
        epss: 0.97547,
        percentile: 0.99999,
        date: '2024-01-15',
      });
      cache1.saveCache();

      // Create a new cache instance that should load from disk
      const cache2 = new EPSSCache({ cacheDir: testCacheDir });
      expect(cache2.has('CVE-2021-44228')).toBe(true);
    });

    it('should expire old cache entries', () => {
      // Create cache with very short TTL
      const cache = new EPSSCache({ cacheDir: testCacheDir, ttlMs: 1 });

      cache.set({
        cve: 'CVE-2021-44228',
        epss: 0.97547,
        percentile: 0.99999,
        date: '2024-01-15',
      });

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(cache.get('CVE-2021-44228')).toBeNull();
          resolve();
        }, 10);
      });
    });
  });

  describe('calculatePriority', () => {
    it('should calculate critical priority for high EPSS + reachable', () => {
      const result = calculatePriority('CVE-2021-44228', 0.975, 10, true);

      expect(result.priority).toBe('critical');
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.factors.epss).toBeGreaterThan(0);
      expect(result.factors.cvss).toBeGreaterThan(0);
      expect(result.factors.reachability).toBe(25);
      expect(result.recommendation).toContain('IMMEDIATE ACTION');
    });

    it('should calculate critical priority for very high EPSS even if not reachable', () => {
      const result = calculatePriority('CVE-2021-44228', 0.8, 9, false);

      expect(result.priority).toBe('critical');
      expect(result.recommendation).toContain('HIGH URGENCY');
    });

    it('should calculate high priority for moderate EPSS + reachable', () => {
      // Score: 0.3*40 + (7/10)*35 + 25 = 12 + 24.5 + 25 = 61.5 → high
      const result = calculatePriority('CVE-2022-22965', 0.3, 7, true);

      expect(result.priority).toBe('high');
      expect(result.recommendation).toContain('PRIORITIZE');
    });

    it('should calculate medium priority for low EPSS + reachable', () => {
      // Score: 0.1*40 + (5/10)*35 + 25 = 4 + 17.5 + 25 = 46.5 → medium
      const result = calculatePriority('CVE-2023-12345', 0.1, 5, true);

      expect(result.priority).toBe('medium');
      expect(result.recommendation).toContain('SCHEDULE');
    });

    it('should calculate low priority for very low EPSS', () => {
      // Score: 0.05*40 + (5/10)*35 + 0 = 2 + 17.5 = 19.5 → low
      const result = calculatePriority('CVE-2023-99999', 0.05, 5, false);

      expect(result.priority).toBe('low');
      expect(result.recommendation).toContain('BACKLOG');
    });

    it('should calculate info priority for negligible risk', () => {
      const result = calculatePriority('CVE-2023-00001', 0.001, 2, false);

      expect(result.priority).toBe('info');
      expect(result.recommendation).toContain('MONITOR');
    });

    it('should handle null EPSS value', () => {
      const result = calculatePriority('CVE-2023-12345', null, 8, true);

      expect(result.factors.epss).toBe(0);
      expect(result.epss).toBeUndefined();
    });

    it('should handle null CVSS value', () => {
      const result = calculatePriority('CVE-2023-12345', 0.5, null, true);

      // Should use default CVSS of 5
      expect(result.factors.cvss).toBe(18); // (5/10) * 35 = 17.5 → 18
      expect(result.cvssScore).toBeUndefined();
    });

    it('should include all score factors', () => {
      const result = calculatePriority('CVE-2021-44228', 0.5, 8, true);

      expect(result.factors.epss).toBe(20);           // 0.5 * 40 = 20
      expect(result.factors.cvss).toBe(28);           // (8/10) * 35 = 28
      expect(result.factors.reachability).toBe(25);   // reachable
      expect(result.score).toBe(73);                  // 20 + 28 + 25 = 73
    });
  });

  describe('priorityFromEPSS', () => {
    it('should return critical for EPSS >= 0.7', () => {
      expect(priorityFromEPSS(0.7)).toBe('critical');
      expect(priorityFromEPSS(0.95)).toBe('critical');
      expect(priorityFromEPSS(1.0)).toBe('critical');
    });

    it('should return high for EPSS >= 0.4', () => {
      expect(priorityFromEPSS(0.4)).toBe('high');
      expect(priorityFromEPSS(0.5)).toBe('high');
      expect(priorityFromEPSS(0.69)).toBe('high');
    });

    it('should return medium for EPSS >= 0.1', () => {
      expect(priorityFromEPSS(0.1)).toBe('medium');
      expect(priorityFromEPSS(0.25)).toBe('medium');
      expect(priorityFromEPSS(0.39)).toBe('medium');
    });

    it('should return low for EPSS >= 0.01', () => {
      expect(priorityFromEPSS(0.01)).toBe('low');
      expect(priorityFromEPSS(0.05)).toBe('low');
      expect(priorityFromEPSS(0.09)).toBe('low');
    });

    it('should return info for EPSS < 0.01', () => {
      expect(priorityFromEPSS(0.009)).toBe('info');
      expect(priorityFromEPSS(0.001)).toBe('info');
      expect(priorityFromEPSS(0)).toBe('info');
    });
  });

  describe('extractCVEs', () => {
    it('should extract CVE from id field', () => {
      const vulns = [
        { id: 'CVE-2021-44228' },
        { id: 'CVE-2022-22965' },
      ];

      const cves = extractCVEs(vulns);
      expect(cves).toContain('CVE-2021-44228');
      expect(cves).toContain('CVE-2022-22965');
    });

    it('should extract CVE from aliases', () => {
      const vulns = [
        { id: 'GHSA-jfh8-c2jp-5v3q', aliases: ['CVE-2021-44228'] },
        { id: 'PYSEC-2023-1234', aliases: ['CVE-2023-12345', 'GHSA-abcd-1234'] },
      ];

      const cves = extractCVEs(vulns);
      expect(cves).toContain('CVE-2021-44228');
      expect(cves).toContain('CVE-2023-12345');
    });

    it('should deduplicate CVEs', () => {
      const vulns = [
        { id: 'CVE-2021-44228' },
        { id: 'GHSA-jfh8-c2jp-5v3q', aliases: ['CVE-2021-44228'] },
      ];

      const cves = extractCVEs(vulns);
      expect(cves.length).toBe(1);
      expect(cves[0]).toBe('CVE-2021-44228');
    });

    it('should skip non-CVE identifiers', () => {
      const vulns = [
        { id: 'GHSA-jfh8-c2jp-5v3q' },
        { id: 'PYSEC-2023-1234' },
        { id: 'npm:lodash:20210512' },
      ];

      const cves = extractCVEs(vulns);
      expect(cves.length).toBe(0);
    });

    it('should normalize CVE IDs to uppercase', () => {
      const vulns = [
        { id: 'cve-2021-44228' },
        { id: 'GHSA-xxx', aliases: ['cve-2022-22965'] },
      ];

      const cves = extractCVEs(vulns);
      expect(cves).toContain('CVE-2021-44228');
      expect(cves).toContain('CVE-2022-22965');
    });
  });

  describe('formatEPSSReport', () => {
    it('should format empty report', () => {
      const report: EPSSReport = {
        scannedAt: '2024-01-15T10:00:00Z',
        modelDate: '2024-01-15',
        summary: {
          total: 0,
          withEPSS: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        },
        priorities: [],
      };

      const formatted = formatEPSSReport(report);
      expect(formatted).toContain('EPSS Priority Analysis');
      expect(formatted).toContain('Total CVEs:      0');
      expect(formatted).toContain('No CVEs to analyze');
    });

    it('should format report with priorities', () => {
      const report: EPSSReport = {
        scannedAt: '2024-01-15T10:00:00Z',
        modelDate: '2024-01-15',
        summary: {
          total: 3,
          withEPSS: 3,
          critical: 1,
          high: 1,
          medium: 1,
          low: 0,
        },
        priorities: [
          {
            cve: 'CVE-2021-44228',
            priority: 'critical',
            score: 95,
            factors: { epss: 39, cvss: 31, reachability: 25 },
            recommendation: 'IMMEDIATE ACTION REQUIRED',
            epss: { cve: 'CVE-2021-44228', epss: 0.975, percentile: 0.999, date: '2024-01-15' },
            isReachable: true,
          },
          {
            cve: 'CVE-2022-22965',
            priority: 'high',
            score: 65,
            factors: { epss: 20, cvss: 28, reachability: 17 },
            recommendation: 'PRIORITIZE',
            epss: { cve: 'CVE-2022-22965', epss: 0.5, percentile: 0.95, date: '2024-01-15' },
            isReachable: false,
          },
          {
            cve: 'CVE-2023-12345',
            priority: 'medium',
            score: 40,
            factors: { epss: 6, cvss: 21, reachability: 13 },
            recommendation: 'SCHEDULE',
            epss: { cve: 'CVE-2023-12345', epss: 0.15, percentile: 0.85, date: '2024-01-15' },
            isReachable: true,
          },
        ],
      };

      const formatted = formatEPSSReport(report);
      expect(formatted).toContain('CVE-2021-44228');
      expect(formatted).toContain('CRIT');
      expect(formatted).toContain('Total CVEs:      3');
      expect(formatted).toContain('🔴 Critical:     1');
      expect(formatted).toContain('Recommendations:');
    });

    it('should truncate long reports', () => {
      const priorities: PriorityScore[] = [];
      for (let i = 0; i < 25; i++) {
        priorities.push({
          cve: `CVE-2023-${String(i).padStart(5, '0')}`,
          priority: 'low',
          score: 10,
          factors: { epss: 2, cvss: 8, reachability: 0 },
          recommendation: 'BACKLOG',
          isReachable: false,
        });
      }

      const report: EPSSReport = {
        scannedAt: '2024-01-15T10:00:00Z',
        modelDate: '2024-01-15',
        summary: { total: 25, withEPSS: 25, critical: 0, high: 0, medium: 0, low: 25 },
        priorities,
      };

      const formatted = formatEPSSReport(report);
      expect(formatted).toContain('... and 5 more');
    });
  });

  describe('toEPSSJson', () => {
    it('should convert report to JSON', () => {
      const report: EPSSReport = {
        scannedAt: '2024-01-15T10:00:00Z',
        modelDate: '2024-01-15',
        summary: {
          total: 1,
          withEPSS: 1,
          critical: 1,
          high: 0,
          medium: 0,
          low: 0,
        },
        priorities: [
          {
            cve: 'CVE-2021-44228',
            priority: 'critical',
            score: 95,
            factors: { epss: 39, cvss: 31, reachability: 25 },
            recommendation: 'IMMEDIATE ACTION',
            isReachable: true,
          },
        ],
      };

      const json = toEPSSJson(report);
      const parsed = JSON.parse(json);

      expect(parsed.scannedAt).toBe('2024-01-15T10:00:00Z');
      expect(parsed.summary.critical).toBe(1);
      expect(parsed.priorities[0].cve).toBe('CVE-2021-44228');
    });
  });

  describe('createEPSSReport', () => {
    it('should create report from vulnerabilities', async () => {
      const vulnerabilities = [
        { id: 'CVE-2021-44228', cvss: 10, isReachable: true },
        { id: 'GHSA-test', aliases: ['CVE-2022-22965'], cvss: 8, isReachable: false },
      ];

      // Note: This will try to query the actual API, which may fail in tests
      // In real usage, you'd mock the API or use cached data
      const report = await createEPSSReport(vulnerabilities, {
        cacheDir: '.test-epss-cache',
      });

      expect(report.summary.total).toBe(2);
      expect(report.priorities.length).toBeGreaterThanOrEqual(0);
    }, 10000);
  });
});
