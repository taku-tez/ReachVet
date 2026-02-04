import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  KEVClient,
  KEVCache,
  KEVCatalog,
  KEVEntry,
  createKEVReport,
  formatKEVReport,
  toKEVJson,
  calculateKEVPriority,
  extractCVEsFromText,
  KEV_CATALOG_URL,
} from '../src/kev/index.js';

// Sample KEV catalog data for testing
const sampleCatalog: KEVCatalog = {
  title: 'CISA Catalog of Known Exploited Vulnerabilities',
  catalogVersion: '2026.02.05',
  dateReleased: '2026-02-05',
  count: 5,
  vulnerabilities: [
    {
      cveID: 'CVE-2021-44228',
      vendorProject: 'Apache',
      product: 'Log4j2',
      vulnerabilityName: 'Apache Log4j2 Remote Code Execution Vulnerability',
      dateAdded: '2021-12-10',
      shortDescription: 'Apache Log4j2 contains a remote code execution vulnerability.',
      requiredAction: 'Apply updates per vendor instructions.',
      dueDate: '2021-12-24',
      knownRansomwareCampaignUse: 'Known',
      notes: '',
    },
    {
      cveID: 'CVE-2023-22515',
      vendorProject: 'Atlassian',
      product: 'Confluence',
      vulnerabilityName: 'Atlassian Confluence Broken Access Control Vulnerability',
      dateAdded: '2023-10-05',
      shortDescription: 'Atlassian Confluence contains a broken access control vulnerability.',
      requiredAction: 'Apply updates per vendor instructions.',
      dueDate: '2023-10-26',
      knownRansomwareCampaignUse: 'Unknown',
      notes: '',
    },
    {
      cveID: 'CVE-2024-0001',
      vendorProject: 'Microsoft',
      product: 'Windows',
      vulnerabilityName: 'Microsoft Windows Test Vulnerability',
      dateAdded: '2024-01-15',
      shortDescription: 'Test vulnerability for testing purposes.',
      requiredAction: 'Apply updates per vendor instructions.',
      dueDate: '2027-02-15', // Future date
      knownRansomwareCampaignUse: 'Unknown',
      notes: '',
    },
    {
      cveID: 'CVE-2023-38545',
      vendorProject: 'Haxx',
      product: 'curl',
      vulnerabilityName: 'curl Heap Buffer Overflow Vulnerability',
      dateAdded: '2023-10-11',
      shortDescription: 'curl contains a heap buffer overflow vulnerability.',
      requiredAction: 'Apply updates per vendor instructions.',
      dueDate: '2023-11-01',
      knownRansomwareCampaignUse: 'Unknown',
      notes: '',
    },
    {
      cveID: 'CVE-2021-34527',
      vendorProject: 'Microsoft',
      product: 'Windows Print Spooler',
      vulnerabilityName: 'Microsoft Windows Print Spooler Remote Code Execution Vulnerability',
      dateAdded: '2021-07-02',
      shortDescription: 'PrintNightmare vulnerability.',
      requiredAction: 'Apply updates per vendor instructions.',
      dueDate: '2021-07-16',
      knownRansomwareCampaignUse: 'Known',
      notes: 'PrintNightmare',
    },
  ],
};

describe('KEVClient', () => {
  let client: KEVClient;

  beforeEach(() => {
    client = new KEVClient();
    client.setCatalog(sampleCatalog);
  });

  describe('setCatalog', () => {
    it('should load catalog and build index', () => {
      expect(client.isLoaded()).toBe(true);
      const info = client.getCatalogInfo();
      expect(info?.version).toBe('2026.02.05');
      expect(info?.count).toBe(5);
    });
  });

  describe('lookup', () => {
    it('should find CVE in catalog', () => {
      const result = client.lookup('CVE-2021-44228');
      expect(result.inKEV).toBe(true);
      expect(result.entry?.vendorProject).toBe('Apache');
      expect(result.entry?.product).toBe('Log4j2');
    });

    it('should return false for CVE not in catalog', () => {
      const result = client.lookup('CVE-9999-99999');
      expect(result.inKEV).toBe(false);
      expect(result.entry).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      const result = client.lookup('cve-2021-44228');
      expect(result.inKEV).toBe(true);
    });
  });

  describe('lookupBatch', () => {
    it('should lookup multiple CVEs', () => {
      const results = client.lookupBatch([
        'CVE-2021-44228',
        'CVE-2023-22515',
        'CVE-9999-99999',
      ]);
      expect(results).toHaveLength(3);
      expect(results[0].inKEV).toBe(true);
      expect(results[1].inKEV).toBe(true);
      expect(results[2].inKEV).toBe(false);
    });
  });

  describe('getAllCVEs', () => {
    it('should return all CVEs in catalog', () => {
      const cves = client.getAllCVEs();
      expect(cves).toHaveLength(5);
      expect(cves).toContain('CVE-2021-44228');
    });
  });

  describe('getRansomwareRelated', () => {
    it('should return only ransomware-related entries', () => {
      const entries = client.getRansomwareRelated();
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.knownRansomwareCampaignUse === 'Known')).toBe(true);
    });
  });

  describe('getPastDue', () => {
    it('should return entries past their due date', () => {
      const entries = client.getPastDue();
      // All except CVE-2024-0001 (future date) should be past due
      expect(entries).toHaveLength(4);
      expect(entries.find(e => e.cveID === 'CVE-2024-0001')).toBeUndefined();
    });
  });

  describe('getByVendor', () => {
    it('should filter by vendor', () => {
      const entries = client.getByVendor('Microsoft');
      expect(entries).toHaveLength(2);
    });

    it('should be case-insensitive', () => {
      const entries = client.getByVendor('apache');
      expect(entries).toHaveLength(1);
    });
  });

  describe('getByProduct', () => {
    it('should filter by product', () => {
      const entries = client.getByProduct('Log4j');
      expect(entries).toHaveLength(1);
      expect(entries[0].cveID).toBe('CVE-2021-44228');
    });
  });
});

describe('KEVCache', () => {
  let cache: KEVCache;
  const testCacheDir = '/tmp/reachvet-kev-test-cache';

  beforeEach(() => {
    cache = new KEVCache({ cacheDir: testCacheDir, ttl: 60000 });
    // Clean up before each test
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up after tests
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true });
    }
  });

  describe('save and load', () => {
    it('should save and load catalog', () => {
      cache.save(sampleCatalog);
      const loaded = cache.load();
      expect(loaded).not.toBeNull();
      expect(loaded?.catalogVersion).toBe('2026.02.05');
      expect(loaded?.vulnerabilities).toHaveLength(5);
    });

    it('should return null for expired cache', () => {
      const expiredCache = new KEVCache({ cacheDir: testCacheDir, ttl: -1 });
      cache.save(sampleCatalog);
      const loaded = expiredCache.load();
      expect(loaded).toBeNull();
    });

    it('should return null for missing cache', () => {
      const loaded = cache.load();
      expect(loaded).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear cache', () => {
      cache.save(sampleCatalog);
      expect(cache.load()).not.toBeNull();
      cache.clear();
      expect(cache.load()).toBeNull();
    });
  });

  describe('getInfo', () => {
    it('should return cache info', () => {
      cache.save(sampleCatalog);
      const info = cache.getInfo();
      expect(info.exists).toBe(true);
      expect(info.age).toBeDefined();
      expect(info.age).toBeLessThan(1000);
    });

    it('should report missing cache', () => {
      const info = cache.getInfo();
      expect(info.exists).toBe(false);
    });
  });
});

describe('createKEVReport', () => {
  let client: KEVClient;

  beforeEach(() => {
    client = new KEVClient();
    client.setCatalog(sampleCatalog);
  });

  it('should create report from CVE list', () => {
    const report = createKEVReport(client, [
      'CVE-2021-44228',
      'CVE-2023-22515',
      'CVE-9999-99999',
    ]);

    expect(report.catalogVersion).toBe('2026.02.05');
    expect(report.summary.totalQueried).toBe(3);
    expect(report.summary.inKEV).toBe(2);
    expect(report.summary.notInKEV).toBe(1);
    expect(report.matchedCVEs).toHaveLength(2);
    expect(report.unmatchedCVEs).toContain('CVE-9999-99999');
  });

  it('should count ransomware-related CVEs', () => {
    const report = createKEVReport(client, [
      'CVE-2021-44228', // Known ransomware
      'CVE-2023-22515', // Unknown
    ]);

    expect(report.summary.ransomwareRelated).toBe(1);
  });

  it('should count past-due CVEs', () => {
    const report = createKEVReport(client, [
      'CVE-2021-44228', // Past due
      'CVE-2024-0001', // Future due date
    ]);

    expect(report.summary.pastDue).toBe(1);
  });

  it('should include EPSS scores and reachability when provided', () => {
    const reachability = new Map([['CVE-2021-44228', true]]);
    const epssScores = new Map([['CVE-2021-44228', 0.97]]);

    const report = createKEVReport(client, ['CVE-2021-44228'], {
      reachability,
      epssScores,
    });

    expect(report.matchedCVEs[0].reachable).toBe(true);
    expect(report.matchedCVEs[0].epssScore).toBe(0.97);
  });
});

describe('formatKEVReport', () => {
  let client: KEVClient;

  beforeEach(() => {
    client = new KEVClient();
    client.setCatalog(sampleCatalog);
  });

  it('should format report as text', () => {
    const report = createKEVReport(client, ['CVE-2021-44228', 'CVE-9999-99999']);
    const formatted = formatKEVReport(report);

    expect(formatted).toContain('KEV');
    expect(formatted).toContain('CVE-2021-44228');
    expect(formatted).toContain('Apache');
    expect(formatted).toContain('RANSOMWARE');
  });

  it('should show summary counts', () => {
    const report = createKEVReport(client, ['CVE-2021-44228', 'CVE-2021-34527']);
    const formatted = formatKEVReport(report);

    expect(formatted).toContain('In KEV Catalog:        2');
    expect(formatted).toContain('Ransomware Related:    2');
  });
});

describe('toKEVJson', () => {
  let client: KEVClient;

  beforeEach(() => {
    client = new KEVClient();
    client.setCatalog(sampleCatalog);
  });

  it('should convert report to JSON', () => {
    const report = createKEVReport(client, ['CVE-2021-44228']);
    const json = toKEVJson(report);
    const parsed = JSON.parse(json);

    expect(parsed.catalogVersion).toBe('2026.02.05');
    expect(parsed.matchedCVEs).toHaveLength(1);
    expect(parsed.summary.inKEV).toBe(1);
  });
});

describe('calculateKEVPriority', () => {
  let client: KEVClient;

  beforeEach(() => {
    client = new KEVClient();
    client.setCatalog(sampleCatalog);
  });

  it('should give high priority to CVE in KEV', () => {
    const priority = calculateKEVPriority('CVE-2021-44228', client);

    // KEV alone without EPSS/CVSS gives minimum HIGH (ransomware+pastdue boosts kev weight)
    expect(['high', 'critical']).toContain(priority.priority);
    expect(priority.inKEV).toBe(true);
    expect(priority.components.kev).toBeGreaterThan(0);
  });

  it('should give minimum HIGH priority for any KEV CVE', () => {
    const priority = calculateKEVPriority('CVE-2024-0001', client, {
      epssScore: 0.01, // Low EPSS
      cvssScore: 3.0, // Low CVSS
    });

    // KEV = minimum high, even with low other scores
    expect(['high', 'critical']).toContain(priority.priority);
    expect(priority.inKEV).toBe(true);
  });

  it('should boost ransomware-related KEV', () => {
    const ransomware = calculateKEVPriority('CVE-2021-44228', client);
    const nonRansomware = calculateKEVPriority('CVE-2024-0001', client);

    expect(ransomware.totalScore).toBeGreaterThan(nonRansomware.totalScore);
  });

  it('should add reachability weight when reachable', () => {
    const reachable = calculateKEVPriority('CVE-2024-0001', client, { isReachable: true });
    const notReachable = calculateKEVPriority('CVE-2024-0001', client, { isReachable: false });

    expect(reachable.totalScore).toBeGreaterThan(notReachable.totalScore);
  });

  it('should give standard priority for non-KEV CVE', () => {
    const priority = calculateKEVPriority('CVE-9999-99999', client, {
      epssScore: 0.01,
      cvssScore: 4.0,
    });

    expect(priority.inKEV).toBe(false);
    expect(priority.components.kev).toBe(0);
    // Low EPSS (0.01*40=0.4) + Low CVSS (4/10*35=14) = ~14.4 total = info
    expect(['info', 'low', 'medium']).toContain(priority.priority);
  });

  it('should include recommendation', () => {
    const priority = calculateKEVPriority('CVE-2021-44228', client);
    expect(priority.recommendation).toBeTruthy();
    // KEV recommendations mention the catalog or urgent action
    expect(priority.recommendation.toLowerCase()).toMatch(/kev|urgent|exploit|patch/);
  });
});

describe('extractCVEsFromText', () => {
  it('should extract CVEs from text', () => {
    const text = `
      This vulnerability CVE-2021-44228 is critical.
      Also see cve-2023-22515 and CVE-2024-12345.
    `;
    const cves = extractCVEsFromText(text);

    expect(cves).toHaveLength(3);
    expect(cves).toContain('CVE-2021-44228');
    expect(cves).toContain('CVE-2023-22515');
    expect(cves).toContain('CVE-2024-12345');
  });

  it('should return unique CVEs', () => {
    const text = 'CVE-2021-44228 and CVE-2021-44228 again';
    const cves = extractCVEsFromText(text);
    expect(cves).toHaveLength(1);
  });

  it('should handle empty text', () => {
    const cves = extractCVEsFromText('');
    expect(cves).toHaveLength(0);
  });

  it('should handle text without CVEs', () => {
    const cves = extractCVEsFromText('No vulnerabilities here');
    expect(cves).toHaveLength(0);
  });
});

describe('KEV_CATALOG_URL', () => {
  it('should be a valid CISA URL', () => {
    expect(KEV_CATALOG_URL).toContain('cisa.gov');
    expect(KEV_CATALOG_URL).toContain('known_exploited_vulnerabilities');
  });
});

describe('KEV integration scenarios', () => {
  let client: KEVClient;

  beforeEach(() => {
    client = new KEVClient();
    client.setCatalog(sampleCatalog);
  });

  it('should prioritize Log4Shell correctly', () => {
    // Log4Shell: EPSS ~97%, CVSS 10.0, KEV, ransomware
    const priority = calculateKEVPriority('CVE-2021-44228', client, {
      epssScore: 0.97,
      cvssScore: 10.0,
      isReachable: true,
    });

    expect(priority.priority).toBe('critical');
    expect(priority.totalScore).toBeGreaterThan(90);
    expect(priority.inKEV).toBe(true);
  });

  it('should handle mixed KEV/non-KEV list', () => {
    const cves = [
      'CVE-2021-44228', // KEV + ransomware
      'CVE-2023-22515', // KEV
      'CVE-9999-99999', // Not KEV
      'CVE-8888-88888', // Not KEV
    ];

    const report = createKEVReport(client, cves);

    expect(report.summary.inKEV).toBe(2);
    expect(report.summary.notInKEV).toBe(2);
    expect(report.summary.ransomwareRelated).toBe(1);
  });

  it('should sort matched CVEs by date added (newest first)', () => {
    const report = createKEVReport(client, [
      'CVE-2021-44228', // 2021-12-10
      'CVE-2024-0001', // 2024-01-15
      'CVE-2023-22515', // 2023-10-05
    ]);

    // Should be sorted: 2024-01-15, 2023-10-05, 2021-12-10
    expect(report.matchedCVEs[0].cve).toBe('CVE-2024-0001');
    expect(report.matchedCVEs[1].cve).toBe('CVE-2023-22515');
    expect(report.matchedCVEs[2].cve).toBe('CVE-2021-44228');
  });
});
