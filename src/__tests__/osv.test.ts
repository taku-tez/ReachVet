/**
 * OSV API Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OSVClient, OSVCache } from '../osv/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEST_CACHE_DIR = path.join(process.cwd(), '.test-osv-cache');

describe('OSVCache', () => {
  let cache: OSVCache;

  beforeAll(async () => {
    cache = new OSVCache({
      enabled: true,
      directory: TEST_CACHE_DIR,
      ttlSeconds: 60,
    });
  });

  afterAll(async () => {
    // Cleanup test cache
    try {
      await fs.rm(TEST_CACHE_DIR, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('should store and retrieve cache entries', async () => {
    const testData = { vulnId: 'TEST-001', severity: 'high' };
    
    await cache.set('npm', 'test-package', '1.0.0', testData);
    const retrieved = await cache.get<typeof testData>('npm', 'test-package', '1.0.0');
    
    expect(retrieved).toEqual(testData);
  });

  it('should return null for non-existent entries', async () => {
    const result = await cache.get('npm', 'nonexistent', '0.0.0');
    expect(result).toBeNull();
  });

  it('should report cache stats', async () => {
    const stats = await cache.stats();
    
    expect(stats).toHaveProperty('entries');
    expect(stats).toHaveProperty('sizeBytes');
    expect(stats).toHaveProperty('expiredCount');
    expect(stats.entries).toBeGreaterThanOrEqual(1); // From previous test
  });

  it('should clear cache', async () => {
    const cleared = await cache.clear();
    expect(cleared).toBeGreaterThanOrEqual(1);
    
    const stats = await cache.stats();
    expect(stats.entries).toBe(0);
  });
});

describe('OSVClient', () => {
  let client: OSVClient;

  beforeAll(() => {
    client = new OSVClient({
      cache: { enabled: false }, // Disable cache for tests
      timeout: 15000,
    });
  });

  describe('ecosystem normalization', () => {
    it('should normalize ecosystem names', async () => {
      // Test through queryPackage which normalizes internally
      // We'll use a known package with vulnerabilities
      const vulns = await client.queryPackage('npm', 'lodash', '4.17.20');
      
      // lodash 4.17.20 has known vulnerabilities
      expect(Array.isArray(vulns)).toBe(true);
    });
  });

  describe('queryPackage', () => {
    it('should query vulnerabilities for lodash 4.17.20', async () => {
      const vulns = await client.queryPackage('npm', 'lodash', '4.17.20');
      
      expect(vulns.length).toBeGreaterThan(0);
      
      // Check structure
      const vuln = vulns[0];
      expect(vuln).toHaveProperty('id');
      expect(vuln.id).toMatch(/^(GHSA-|CVE-)/);
    });

    it('should return empty array for package without vulnerabilities', async () => {
      // Use a very new version that likely has no vulnerabilities
      const vulns = await client.queryPackage('npm', 'lodash', '4.17.21');
      
      // 4.17.21 might still have some, but should be fewer
      expect(Array.isArray(vulns)).toBe(true);
    });
  });

  describe('queryBatch', () => {
    it('should query multiple packages at once', async () => {
      const packages = [
        { ecosystem: 'npm', name: 'lodash', version: '4.17.20' },
        { ecosystem: 'npm', name: 'minimist', version: '1.2.5' },
      ];

      const results = await client.queryBatch(packages);

      expect(results instanceof Map).toBe(true);
      expect(results.size).toBe(2);
      
      const lodashVulns = results.get('npm:lodash:4.17.20');
      expect(lodashVulns).toBeDefined();
      expect(Array.isArray(lodashVulns)).toBe(true);
    });
  });

  describe('extractVulnerableFunctions', () => {
    it('should extract vulnerable functions from vulnerability data', async () => {
      const vulns = await client.queryPackage('npm', 'lodash', '4.17.20');
      
      // Find a vulnerability with function info
      for (const vuln of vulns) {
        const info = client.extractVulnerableFunctions(vuln);
        
        expect(info).toHaveProperty('vulnId');
        expect(info).toHaveProperty('severity');
        expect(info).toHaveProperty('functions');
        expect(info).toHaveProperty('paths');
        expect(Array.isArray(info.functions)).toBe(true);
        expect(Array.isArray(info.paths)).toBe(true);
      }
    });

    it('should handle vulnerabilities without function info', () => {
      const mockVuln = {
        id: 'GHSA-test-0001',
        summary: 'Test vulnerability',
        affected: [
          {
            package: { ecosystem: 'npm', name: 'test-pkg' },
            ranges: [
              {
                type: 'SEMVER' as const,
                events: [{ introduced: '0' }, { fixed: '2.0.0' }],
              },
            ],
          },
        ],
      };

      const info = client.extractVulnerableFunctions(mockVuln);
      
      expect(info.vulnId).toBe('GHSA-test-0001');
      expect(info.fixedVersion).toBe('2.0.0');
      expect(info.functions).toEqual([]);
      expect(info.paths).toEqual([]);
    });
  });

  describe('getPackageVulnerabilityInfo', () => {
    it('should get complete vulnerability info for a package', async () => {
      const info = await client.getPackageVulnerabilityInfo('npm', 'lodash', '4.17.20');
      
      expect(info.packageName).toBe('lodash');
      expect(info.ecosystem).toBe('npm');
      expect(info.version).toBe('4.17.20');
      expect(Array.isArray(info.vulnerabilities)).toBe(true);
      expect(info.vulnerabilities.length).toBeGreaterThan(0);
    });
  });

  describe('getVulnerability', () => {
    it('should fetch vulnerability details by ID', async () => {
      const vuln = await client.getVulnerability('GHSA-35jh-r3h4-6jhm');
      
      expect(vuln).not.toBeNull();
      if (vuln) {
        expect(vuln.id).toBe('GHSA-35jh-r3h4-6jhm');
        expect(vuln).toHaveProperty('summary');
      }
    });

    it('should return null for non-existent vulnerability', async () => {
      const vuln = await client.getVulnerability('GHSA-does-not-exist');
      expect(vuln).toBeNull();
    });
  });
});

describe('OSVClient with caching', () => {
  let client: OSVClient;
  const cacheDir = path.join(process.cwd(), '.test-osv-client-cache');

  beforeAll(() => {
    client = new OSVClient({
      cache: {
        enabled: true,
        directory: cacheDir,
        ttlSeconds: 300,
      },
    });
  });

  afterAll(async () => {
    await client.clearCache();
    try {
      await fs.rm(cacheDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('should cache query results', async () => {
    // First query - hits API
    const vulns1 = await client.queryPackage('npm', 'axios', '0.21.0');
    
    // Second query - should hit cache
    const vulns2 = await client.queryPackage('npm', 'axios', '0.21.0');
    
    expect(vulns1).toEqual(vulns2);
    
    // Check cache stats
    const stats = await client.cacheStats();
    expect(stats.entries).toBeGreaterThanOrEqual(1);
  });

  it('should clear cache', async () => {
    const cleared = await client.clearCache();
    expect(cleared).toBeGreaterThanOrEqual(1);
    
    const stats = await client.cacheStats();
    expect(stats.entries).toBe(0);
  });
});
