/**
 * KEV (Known Exploited Vulnerabilities) Integration
 * 
 * CISA's KEV catalog lists vulnerabilities that are actively exploited in the wild.
 * This module provides:
 * - KEVClient: Fetch and query the KEV catalog
 * - KEVCache: Local caching with configurable TTL
 * - Integration with EPSS for combined prioritization
 * 
 * @see https://www.cisa.gov/known-exploited-vulnerabilities-catalog
 */

import * as fs from 'fs';
import * as path from 'path';

/** KEV API endpoint */
export const KEV_CATALOG_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

/** KEV vulnerability entry */
export interface KEVEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: 'Known' | 'Unknown';
  notes: string;
}

/** KEV catalog response */
export interface KEVCatalog {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: KEVEntry[];
}

/** KEV lookup result */
export interface KEVLookupResult {
  cve: string;
  inKEV: boolean;
  entry?: KEVEntry;
}

/** KEV-enhanced priority score */
export interface KEVPriorityScore {
  cve: string;
  totalScore: number;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'info';
  components: {
    epss: number;
    cvss: number;
    reachability: number;
    kev: number;
  };
  recommendation: string;
  inKEV: boolean;
}

/** KEV report entry */
export interface KEVReportEntry {
  cve: string;
  vendorProduct: string;
  vulnerabilityName: string;
  dateAdded: string;
  dueDate: string;
  ransomware: boolean;
  requiredAction: string;
  reachable?: boolean;
  epssScore?: number;
  priority?: KEVPriorityScore;
}

/** KEV report */
export interface KEVReport {
  catalogVersion: string;
  catalogDate: string;
  totalKEVs: number;
  matchedCVEs: KEVReportEntry[];
  unmatchedCVEs: string[];
  summary: {
    totalQueried: number;
    inKEV: number;
    notInKEV: number;
    ransomwareRelated: number;
    pastDue: number;
  };
}

/** Cache entry */
interface CacheEntry {
  catalog: KEVCatalog;
  timestamp: number;
}

/**
 * KEV Catalog Client
 */
export class KEVClient {
  private catalog: KEVCatalog | null = null;
  private cveIndex: Map<string, KEVEntry> = new Map();
  private fetchTimeout: number;
  private retries: number;

  constructor(options: { timeout?: number; retries?: number } = {}) {
    this.fetchTimeout = options.timeout ?? 30000;
    this.retries = options.retries ?? 3;
  }

  /**
   * Fetch the KEV catalog from CISA
   */
  async fetchCatalog(): Promise<KEVCatalog> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.fetchTimeout);

        const response = await fetch(KEV_CATALOG_URL, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'ReachVet/1.0 (https://github.com/taku-tez/ReachVet)'
          }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`KEV API returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as KEVCatalog;
        this.setCatalog(data);
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw lastError ?? new Error('Failed to fetch KEV catalog');
  }

  /**
   * Set catalog data (for testing or manual loading)
   */
  setCatalog(catalog: KEVCatalog): void {
    this.catalog = catalog;
    this.cveIndex.clear();
    for (const entry of catalog.vulnerabilities) {
      this.cveIndex.set(entry.cveID.toUpperCase(), entry);
    }
  }

  /**
   * Check if catalog is loaded
   */
  isLoaded(): boolean {
    return this.catalog !== null;
  }

  /**
   * Get catalog metadata
   */
  getCatalogInfo(): { version: string; date: string; count: number } | null {
    if (!this.catalog) return null;
    return {
      version: this.catalog.catalogVersion,
      date: this.catalog.dateReleased,
      count: this.catalog.count
    };
  }

  /**
   * Check if a CVE is in the KEV catalog
   */
  lookup(cve: string): KEVLookupResult {
    const normalizedCve = cve.toUpperCase();
    const entry = this.cveIndex.get(normalizedCve);
    return {
      cve: normalizedCve,
      inKEV: !!entry,
      entry
    };
  }

  /**
   * Batch lookup multiple CVEs
   */
  lookupBatch(cves: string[]): KEVLookupResult[] {
    return cves.map(cve => this.lookup(cve));
  }

  /**
   * Get all CVEs in the KEV catalog
   */
  getAllCVEs(): string[] {
    return Array.from(this.cveIndex.keys());
  }

  /**
   * Get KEV entries with ransomware association
   */
  getRansomwareRelated(): KEVEntry[] {
    if (!this.catalog) return [];
    return this.catalog.vulnerabilities.filter(
      entry => entry.knownRansomwareCampaignUse === 'Known'
    );
  }

  /**
   * Get KEV entries past their due date
   */
  getPastDue(): KEVEntry[] {
    if (!this.catalog) return [];
    const now = new Date();
    return this.catalog.vulnerabilities.filter(entry => {
      const dueDate = new Date(entry.dueDate);
      return dueDate < now;
    });
  }

  /**
   * Get KEV entries by vendor/product
   */
  getByVendor(vendor: string): KEVEntry[] {
    if (!this.catalog) return [];
    const lowerVendor = vendor.toLowerCase();
    return this.catalog.vulnerabilities.filter(
      entry => entry.vendorProject.toLowerCase().includes(lowerVendor)
    );
  }

  /**
   * Get KEV entries by product
   */
  getByProduct(product: string): KEVEntry[] {
    if (!this.catalog) return [];
    const lowerProduct = product.toLowerCase();
    return this.catalog.vulnerabilities.filter(
      entry => entry.product.toLowerCase().includes(lowerProduct)
    );
  }
}

/**
 * KEV Cache for local storage
 */
export class KEVCache {
  private cacheDir: string;
  private ttl: number;

  constructor(options: { cacheDir?: string; ttl?: number } = {}) {
    this.cacheDir = options.cacheDir ?? path.join(process.cwd(), '.reachvet-cache');
    this.ttl = options.ttl ?? 24 * 60 * 60 * 1000; // 24 hours default
  }

  private getCachePath(): string {
    return path.join(this.cacheDir, 'kev-catalog.json');
  }

  /**
   * Load catalog from cache if valid
   */
  load(): KEVCatalog | null {
    const cachePath = this.getCachePath();
    if (!fs.existsSync(cachePath)) return null;

    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(content);

      // Check TTL
      if (Date.now() - entry.timestamp > this.ttl) {
        return null;
      }

      return entry.catalog;
    } catch {
      return null;
    }
  }

  /**
   * Save catalog to cache
   */
  save(catalog: KEVCatalog): void {
    const cachePath = this.getCachePath();
    const entry: CacheEntry = {
      catalog,
      timestamp: Date.now()
    };

    // Ensure directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2));
  }

  /**
   * Clear cache
   */
  clear(): void {
    const cachePath = this.getCachePath();
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  }

  /**
   * Get cache info
   */
  getInfo(): { exists: boolean; age?: number; path: string } {
    const cachePath = this.getCachePath();
    if (!fs.existsSync(cachePath)) {
      return { exists: false, path: cachePath };
    }

    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(content);
      return {
        exists: true,
        age: Date.now() - entry.timestamp,
        path: cachePath
      };
    } catch {
      return { exists: false, path: cachePath };
    }
  }
}

/**
 * Global KEV client and cache instances
 */
let globalClient: KEVClient | null = null;
let globalCache: KEVCache | null = null;

export function getKEVClient(): KEVClient {
  if (!globalClient) {
    globalClient = new KEVClient();
  }
  return globalClient;
}

export function getKEVCache(options?: { cacheDir?: string; ttl?: number }): KEVCache {
  if (!globalCache) {
    globalCache = new KEVCache(options);
  }
  return globalCache;
}

/**
 * Fetch KEV catalog with caching
 */
export async function fetchKEVWithCache(options?: {
  cacheDir?: string;
  noCache?: boolean;
  forceRefresh?: boolean;
}): Promise<KEVCatalog> {
  const client = getKEVClient();
  const cache = getKEVCache({ cacheDir: options?.cacheDir });

  // Try cache first (unless disabled or forced refresh)
  if (!options?.noCache && !options?.forceRefresh) {
    const cached = cache.load();
    if (cached) {
      client.setCatalog(cached);
      return cached;
    }
  }

  // Fetch fresh data
  const catalog = await client.fetchCatalog();

  // Save to cache (unless disabled)
  if (!options?.noCache) {
    cache.save(catalog);
  }

  return catalog;
}

/**
 * Create KEV report from CVE list
 */
export function createKEVReport(
  client: KEVClient,
  cves: string[],
  options?: {
    reachability?: Map<string, boolean>;
    epssScores?: Map<string, number>;
    priorities?: Map<string, KEVPriorityScore>;
  }
): KEVReport {
  const info = client.getCatalogInfo();
  const results = client.lookupBatch(cves);
  const now = new Date();

  const matched: KEVReportEntry[] = [];
  const unmatched: string[] = [];
  let ransomwareCount = 0;
  let pastDueCount = 0;

  for (const result of results) {
    if (result.inKEV && result.entry) {
      const entry = result.entry;
      const isPastDue = new Date(entry.dueDate) < now;
      const isRansomware = entry.knownRansomwareCampaignUse === 'Known';

      if (isRansomware) ransomwareCount++;
      if (isPastDue) pastDueCount++;

      matched.push({
        cve: entry.cveID,
        vendorProduct: `${entry.vendorProject} ${entry.product}`,
        vulnerabilityName: entry.vulnerabilityName,
        dateAdded: entry.dateAdded,
        dueDate: entry.dueDate,
        ransomware: isRansomware,
        requiredAction: entry.requiredAction,
        reachable: options?.reachability?.get(entry.cveID),
        epssScore: options?.epssScores?.get(entry.cveID),
        priority: options?.priorities?.get(entry.cveID)
      });
    } else {
      unmatched.push(result.cve);
    }
  }

  // Sort by date added (most recent first)
  matched.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());

  return {
    catalogVersion: info?.version ?? 'unknown',
    catalogDate: info?.date ?? 'unknown',
    totalKEVs: info?.count ?? 0,
    matchedCVEs: matched,
    unmatchedCVEs: unmatched,
    summary: {
      totalQueried: cves.length,
      inKEV: matched.length,
      notInKEV: unmatched.length,
      ransomwareRelated: ransomwareCount,
      pastDue: pastDueCount
    }
  };
}

/**
 * Format KEV report as text
 */
export function formatKEVReport(report: KEVReport): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════════╗');
  lines.push('║          KEV (Known Exploited Vulnerabilities) Report           ║');
  lines.push('╚══════════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`Catalog Version: ${report.catalogVersion}`);
  lines.push(`Catalog Date: ${report.catalogDate}`);
  lines.push(`Total KEVs in Catalog: ${report.totalKEVs}`);
  lines.push('');
  lines.push('─────────────────────────────────────────────────────────────────────');
  lines.push('                              Summary                               ');
  lines.push('─────────────────────────────────────────────────────────────────────');
  lines.push(`  Total CVEs Queried:    ${report.summary.totalQueried}`);
  lines.push(`  In KEV Catalog:        ${report.summary.inKEV} ⚠️`);
  lines.push(`  Not in KEV:            ${report.summary.notInKEV}`);
  lines.push(`  Ransomware Related:    ${report.summary.ransomwareRelated} 🔴`);
  lines.push(`  Past Due Date:         ${report.summary.pastDue} ⏰`);
  lines.push('');

  if (report.matchedCVEs.length > 0) {
    lines.push('─────────────────────────────────────────────────────────────────────');
    lines.push('                    CVEs in KEV Catalog                            ');
    lines.push('─────────────────────────────────────────────────────────────────────');
    lines.push('');

    for (const entry of report.matchedCVEs) {
      const indicators: string[] = [];
      if (entry.ransomware) indicators.push('🔴 RANSOMWARE');
      if (new Date(entry.dueDate) < new Date()) indicators.push('⏰ PAST DUE');
      if (entry.reachable) indicators.push('🎯 REACHABLE');
      if (entry.priority) indicators.push(`📊 ${entry.priority.priority.toUpperCase()}`);

      lines.push(`┌─ ${entry.cve} ${indicators.length > 0 ? indicators.join(' ') : ''}`);
      lines.push(`│  Vendor/Product: ${entry.vendorProduct}`);
      lines.push(`│  Vulnerability:  ${entry.vulnerabilityName}`);
      lines.push(`│  Date Added:     ${entry.dateAdded}`);
      lines.push(`│  Due Date:       ${entry.dueDate}`);
      if (entry.epssScore !== undefined) {
        lines.push(`│  EPSS Score:     ${(entry.epssScore * 100).toFixed(2)}%`);
      }
      lines.push(`│  Action:         ${entry.requiredAction}`);
      lines.push('└─');
      lines.push('');
    }
  }

  if (report.unmatchedCVEs.length > 0 && report.unmatchedCVEs.length <= 20) {
    lines.push('─────────────────────────────────────────────────────────────────────');
    lines.push('                   CVEs NOT in KEV Catalog                         ');
    lines.push('─────────────────────────────────────────────────────────────────────');
    lines.push(`  ${report.unmatchedCVEs.join(', ')}`);
    lines.push('');
  } else if (report.unmatchedCVEs.length > 20) {
    lines.push('─────────────────────────────────────────────────────────────────────');
    lines.push(`  ${report.unmatchedCVEs.length} CVEs not in KEV catalog (not shown)`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert KEV report to JSON
 */
export function toKEVJson(report: KEVReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Calculate combined priority using KEV + EPSS + CVSS + Reachability
 * KEV presence is a strong indicator and bumps priority significantly
 */
export function calculateKEVPriority(
  cve: string,
  kevClient: KEVClient,
  options?: {
    epssScore?: number;
    cvssScore?: number;
    isReachable?: boolean;
  }
): KEVPriorityScore {
  const kevResult = kevClient.lookup(cve);
  const epss = options?.epssScore ?? 0;
  const cvss = options?.cvssScore ?? 0;
  const reachable = options?.isReachable ?? false;

  // Base weights
  let kevWeight = 0;
  let epssWeight = epss * 40;
  let cvssWeight = (cvss / 10) * 35;
  let reachabilityWeight = reachable ? 25 : 0;

  // KEV bonus: Being in KEV is a STRONG indicator
  if (kevResult.inKEV) {
    kevWeight = 30; // Significant bump
    
    // Additional bonus for ransomware-related
    if (kevResult.entry?.knownRansomwareCampaignUse === 'Known') {
      kevWeight += 15;
    }
    
    // Additional urgency if past due
    const dueDate = kevResult.entry?.dueDate ? new Date(kevResult.entry.dueDate) : null;
    if (dueDate && dueDate < new Date()) {
      kevWeight += 10;
    }
  }

  const totalScore = Math.min(100, kevWeight + epssWeight + cvssWeight + reachabilityWeight);

  let priority: 'critical' | 'high' | 'medium' | 'low' | 'info';
  let recommendation: string;

  // Adjust thresholds when KEV is present
  if (kevResult.inKEV) {
    // CVE in KEV = minimum HIGH priority
    if (totalScore >= 75 || (reachable && kevResult.entry?.knownRansomwareCampaignUse === 'Known')) {
      priority = 'critical';
      recommendation = 'IMMEDIATE ACTION REQUIRED: This vulnerability is actively exploited. Patch immediately or implement compensating controls.';
    } else if (totalScore >= 50 || reachable) {
      priority = 'high';
      recommendation = 'URGENT: This vulnerability is in the KEV catalog. Prioritize patching within the CISA-mandated timeframe.';
    } else {
      priority = 'high';
      recommendation = 'This vulnerability is actively exploited in the wild. Review and patch as soon as possible.';
    }
  } else {
    // Standard priority calculation
    if (totalScore >= 70) {
      priority = 'critical';
      recommendation = 'Immediate remediation recommended. High likelihood of exploitation.';
    } else if (totalScore >= 50) {
      priority = 'high';
      recommendation = 'Prioritize for remediation. Notable risk of exploitation.';
    } else if (totalScore >= 30) {
      priority = 'medium';
      recommendation = 'Schedule for remediation. Monitor for exploitation activity.';
    } else if (totalScore >= 15) {
      priority = 'low';
      recommendation = 'Address during regular maintenance cycles.';
    } else {
      priority = 'info';
      recommendation = 'Low risk. Address if resources permit.';
    }
  }

  return {
    cve,
    totalScore,
    priority,
    components: {
      epss: epssWeight,
      cvss: cvssWeight,
      reachability: reachabilityWeight,
      kev: kevWeight
    },
    recommendation,
    inKEV: kevResult.inKEV
  };
}

/**
 * Extract CVE IDs from analysis results or text
 */
export function extractCVEsFromText(text: string): string[] {
  const cvePattern = /CVE-\d{4}-\d{4,}/gi;
  const matches = text.match(cvePattern) || [];
  return [...new Set(matches.map(cve => cve.toUpperCase()))];
}
