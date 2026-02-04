/**
 * EPSS (Exploit Prediction Scoring System) Integration
 *
 * EPSS is a scoring system developed by FIRST.org that predicts the
 * probability of a CVE being exploited in the wild within the next 30 days.
 *
 * Unlike CVSS which measures technical severity, EPSS provides actionable
 * intelligence about real-world exploitation likelihood.
 *
 * API: https://api.first.org/data/v1/epss
 *
 * @module epss
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// ============================================================================
// Types
// ============================================================================

export interface EPSSScore {
  cve: string;
  epss: number;           // Probability (0-1) of exploitation in next 30 days
  percentile: number;     // Percentile rank among all CVEs (0-1)
  date: string;           // Date of the score (YYYY-MM-DD)
}

export interface EPSSBatchResult {
  status: string;
  status_code: number;
  version: string;
  total: number;
  offset: number;
  limit: number;
  data: EPSSScore[];
}

export interface EPSSCacheOptions {
  cacheDir?: string;
  ttlMs?: number;         // Cache TTL (default: 24 hours - EPSS updates daily)
}

export interface PriorityScore {
  cve: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'info';
  score: number;          // 0-100 combined score
  factors: {
    epss: number;         // EPSS contribution (0-40)
    cvss: number;         // CVSS contribution (0-35)
    reachability: number; // Reachability contribution (0-25)
  };
  recommendation: string;
  epss?: EPSSScore;
  cvssScore?: number;
  isReachable?: boolean;
}

export interface EPSSQueryOptions {
  timeout?: number;
  retries?: number;
}

// ============================================================================
// Constants
// ============================================================================

const EPSS_API_BASE = 'https://api.first.org/data/v1/epss';
const DEFAULT_CACHE_DIR = '.reachvet-cache/epss';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 2;

// EPSS thresholds for priority categorization (based on FIRST.org guidance)
const EPSS_THRESHOLDS = {
  critical: 0.7,    // 70%+ probability - immediate action required
  high: 0.4,        // 40-70% - prioritize for patching
  medium: 0.1,      // 10-40% - schedule for remediation
  low: 0.01,        // 1-10% - monitor
  // Below 1% is considered 'info' level
};

// ============================================================================
// EPSS Client
// ============================================================================

/**
 * Client for querying FIRST.org EPSS API
 */
export class EPSSClient {
  private timeout: number;
  private retries: number;

  constructor(options: EPSSQueryOptions = {}) {
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  /**
   * Query EPSS score for a single CVE
   */
  async query(cve: string): Promise<EPSSScore | null> {
    const result = await this.queryBatch([cve]);
    return result[0] ?? null;
  }

  /**
   * Query EPSS scores for multiple CVEs
   */
  async queryBatch(cves: string[]): Promise<EPSSScore[]> {
    if (cves.length === 0) return [];

    // Normalize CVE IDs
    const normalizedCves = cves.map(cve => cve.toUpperCase().trim());

    // EPSS API accepts comma-separated CVE list
    const url = `${EPSS_API_BASE}?cve=${normalizedCves.join(',')}`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.fetch(url);
        const result = JSON.parse(response) as EPSSBatchResult;

        if (result.status_code === 200 && result.data) {
          return result.data.map(item => ({
            cve: item.cve,
            epss: parseFloat(String(item.epss)),
            percentile: parseFloat(String(item.percentile)),
            date: item.date,
          }));
        }

        return [];
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.retries) {
          // Exponential backoff
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError ?? new Error('Failed to query EPSS API');
  }

  /**
   * Fetch the latest EPSS model date
   */
  async getModelDate(): Promise<string> {
    // Query a known CVE to get the model date
    const result = await this.query('CVE-2021-44228');
    return result?.date ?? new Date().toISOString().split('T')[0];
  }

  private fetch(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('EPSS API request timed out'));
      }, this.timeout);

      https.get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'ReachVet/1.0',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          clearTimeout(timeout);
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`EPSS API returned ${res.statusCode}`));
          }
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// EPSS Cache
// ============================================================================

interface CacheEntry {
  score: EPSSScore;
  cachedAt: number;
}

interface CacheData {
  version: number;
  entries: Record<string, CacheEntry>;
}

/**
 * Local cache for EPSS scores
 */
export class EPSSCache {
  private cacheDir: string;
  private ttlMs: number;
  private cacheFile: string;
  private cache: Map<string, CacheEntry>;
  private dirty: boolean = false;

  constructor(options: EPSSCacheOptions = {}) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.cacheFile = path.join(this.cacheDir, 'epss-cache.json');
    this.cache = new Map();
    this.loadCache();
  }

  /**
   * Get cached EPSS score
   */
  get(cve: string): EPSSScore | null {
    const entry = this.cache.get(cve.toUpperCase());
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(cve.toUpperCase());
      this.dirty = true;
      return null;
    }

    return entry.score;
  }

  /**
   * Store EPSS score in cache
   */
  set(score: EPSSScore): void {
    this.cache.set(score.cve.toUpperCase(), {
      score,
      cachedAt: Date.now(),
    });
    this.dirty = true;
  }

  /**
   * Store multiple EPSS scores
   */
  setMany(scores: EPSSScore[]): void {
    for (const score of scores) {
      this.set(score);
    }
  }

  /**
   * Check if a CVE is cached (and not expired)
   */
  has(cve: string): boolean {
    return this.get(cve) !== null;
  }

  /**
   * Get all cached CVEs
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.dirty = true;
    this.saveCache();
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; hitRate: number; cacheFile: string } {
    return {
      size: this.cache.size,
      hitRate: 0, // Could track hits/misses if needed
      cacheFile: this.cacheFile,
    };
  }

  /**
   * Save cache to disk
   */
  saveCache(): void {
    if (!this.dirty) return;

    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });

      const data: CacheData = {
        version: 1,
        entries: Object.fromEntries(this.cache),
      };

      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch {
      // Ignore cache save errors
    }
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = fs.readFileSync(this.cacheFile, 'utf-8');
        const data = JSON.parse(raw) as CacheData;

        if (data.version === 1 && data.entries) {
          for (const [key, entry] of Object.entries(data.entries)) {
            // Check if expired during load
            if (Date.now() - entry.cachedAt <= this.ttlMs) {
              this.cache.set(key, entry);
            }
          }
        }
      }
    } catch {
      // Start with empty cache on error
      this.cache = new Map();
    }
  }
}

// ============================================================================
// Priority Calculator
// ============================================================================

/**
 * Calculate priority score combining EPSS, CVSS, and reachability
 *
 * The score is a weighted combination:
 * - EPSS: 40% weight (real-world exploitation likelihood)
 * - CVSS: 35% weight (technical severity)
 * - Reachability: 25% weight (code path existence)
 *
 * @param cve - CVE identifier
 * @param epss - EPSS score (0-1)
 * @param cvss - CVSS score (0-10)
 * @param isReachable - Whether vulnerable code is reachable
 * @returns Priority score with recommendation
 */
export function calculatePriority(
  cve: string,
  epss: number | null,
  cvss: number | null,
  isReachable: boolean
): PriorityScore {
  // Normalize inputs
  const epssValue = epss ?? 0;
  const cvssValue = cvss ?? 5; // Default to medium if unknown

  // Calculate weighted components
  const epssComponent = epssValue * 40;             // 0-40 points
  const cvssComponent = (cvssValue / 10) * 35;      // 0-35 points
  const reachComponent = isReachable ? 25 : 0;      // 0 or 25 points

  const totalScore = epssComponent + cvssComponent + reachComponent;

  // Determine priority level
  let priority: PriorityScore['priority'];
  if (totalScore >= 70) {
    priority = 'critical';
  } else if (totalScore >= 50) {
    priority = 'high';
  } else if (totalScore >= 30) {
    priority = 'medium';
  } else if (totalScore >= 15) {
    priority = 'low';
  } else {
    priority = 'info';
  }

  // Override to critical if EPSS alone is very high
  if (epssValue >= EPSS_THRESHOLDS.critical) {
    priority = 'critical';
  }

  // Generate recommendation
  const recommendation = generateRecommendation(priority, epssValue, cvssValue, isReachable);

  return {
    cve,
    priority,
    score: Math.round(totalScore),
    factors: {
      epss: Math.round(epssComponent),
      cvss: Math.round(cvssComponent),
      reachability: reachComponent,
    },
    recommendation,
    epss: epss !== null ? {
      cve,
      epss: epssValue,
      percentile: 0, // Will be filled by actual data
      date: new Date().toISOString().split('T')[0],
    } : undefined,
    cvssScore: cvss ?? undefined,
    isReachable,
  };
}

/**
 * Calculate priority from EPSS score alone
 */
export function priorityFromEPSS(epss: number): PriorityScore['priority'] {
  if (epss >= EPSS_THRESHOLDS.critical) return 'critical';
  if (epss >= EPSS_THRESHOLDS.high) return 'high';
  if (epss >= EPSS_THRESHOLDS.medium) return 'medium';
  if (epss >= EPSS_THRESHOLDS.low) return 'low';
  return 'info';
}

function generateRecommendation(
  priority: PriorityScore['priority'],
  epss: number,
  _cvss: number, // Reserved for future use in recommendations
  isReachable: boolean
): string {
  const epssPercent = (epss * 100).toFixed(1);

  if (priority === 'critical') {
    if (isReachable) {
      return `IMMEDIATE ACTION REQUIRED: ${epssPercent}% exploitation probability with reachable code path. Patch immediately or apply mitigating controls.`;
    }
    return `HIGH URGENCY: ${epssPercent}% exploitation probability. Prioritize patching even though code path is not directly reachable.`;
  }

  if (priority === 'high') {
    if (isReachable) {
      return `PRIORITIZE: Active exploitation risk with reachable code. Schedule patching within days, not weeks.`;
    }
    return `MONITOR: High exploitation likelihood but no direct code path. Plan remediation in next sprint.`;
  }

  if (priority === 'medium') {
    if (isReachable) {
      return `SCHEDULE: Reachable vulnerable code with moderate risk. Include in regular patching cycle.`;
    }
    return `TRACK: Moderate risk without reachable path. Add to backlog for future remediation.`;
  }

  if (priority === 'low') {
    return `BACKLOG: Low exploitation probability (${epssPercent}%). Address during maintenance windows.`;
  }

  return `MONITOR: Minimal immediate risk. Review during periodic security assessments.`;
}

// ============================================================================
// Report Formatting
// ============================================================================

export interface EPSSReport {
  scannedAt: string;
  modelDate: string;
  summary: {
    total: number;
    withEPSS: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  priorities: PriorityScore[];
}

/**
 * Format EPSS analysis results for display
 */
export function formatEPSSReport(report: EPSSReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╭─────────────────────────────────────────────────────────────────╮');
  lines.push('│                    EPSS Priority Analysis                       │');
  lines.push('╰─────────────────────────────────────────────────────────────────╯');
  lines.push('');
  lines.push(`  Model Date: ${report.modelDate}`);
  lines.push(`  Analyzed:   ${report.scannedAt}`);
  lines.push('');
  lines.push('  Summary:');
  lines.push(`    Total CVEs:      ${report.summary.total}`);
  lines.push(`    With EPSS Data:  ${report.summary.withEPSS}`);
  lines.push(`    🔴 Critical:     ${report.summary.critical}`);
  lines.push(`    🟠 High:         ${report.summary.high}`);
  lines.push(`    🟡 Medium:       ${report.summary.medium}`);
  lines.push(`    🟢 Low:          ${report.summary.low}`);
  lines.push('');

  if (report.priorities.length === 0) {
    lines.push('  No CVEs to analyze.');
    return lines.join('\n');
  }

  // Sort by priority score descending
  const sorted = [...report.priorities].sort((a, b) => b.score - a.score);

  lines.push('  ┌──────────────────┬──────────┬───────┬─────────┬──────────────┐');
  lines.push('  │ CVE              │ Priority │ Score │ EPSS %  │ Reachable    │');
  lines.push('  ├──────────────────┼──────────┼───────┼─────────┼──────────────┤');

  for (const p of sorted.slice(0, 20)) {
    const cve = p.cve.padEnd(16);
    const priority = formatPriorityBadge(p.priority).padEnd(10);
    const score = String(p.score).padStart(5);
    const epssPercent = p.epss ? `${(p.epss.epss * 100).toFixed(1)}%`.padStart(7) : '    N/A';
    const reachable = (p.isReachable ? '✓ Yes' : '✗ No').padEnd(12);

    lines.push(`  │ ${cve} │ ${priority} │ ${score} │ ${epssPercent} │ ${reachable} │`);
  }

  lines.push('  └──────────────────┴──────────┴───────┴─────────┴──────────────┘');

  if (sorted.length > 20) {
    lines.push(`  ... and ${sorted.length - 20} more`);
  }

  lines.push('');

  // Top recommendations
  const criticalOrHigh = sorted.filter(p => p.priority === 'critical' || p.priority === 'high');
  if (criticalOrHigh.length > 0) {
    lines.push('  Recommendations:');
    for (const p of criticalOrHigh.slice(0, 5)) {
      lines.push(`    • ${p.cve}: ${p.recommendation}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatPriorityBadge(priority: PriorityScore['priority']): string {
  switch (priority) {
    case 'critical': return '🔴 CRIT';
    case 'high': return '🟠 HIGH';
    case 'medium': return '🟡 MED';
    case 'low': return '🟢 LOW';
    default: return '⚪ INFO';
  }
}

/**
 * Convert EPSS report to JSON
 */
export function toEPSSJson(report: EPSSReport): string {
  return JSON.stringify(report, null, 2);
}

// ============================================================================
// Convenience Functions
// ============================================================================

let globalClient: EPSSClient | null = null;
let globalCache: EPSSCache | null = null;

/**
 * Get or create a global EPSS client
 */
export function getEPSSClient(): EPSSClient {
  if (!globalClient) {
    globalClient = new EPSSClient();
  }
  return globalClient;
}

/**
 * Get or create a global EPSS cache
 */
export function getEPSSCache(options?: EPSSCacheOptions): EPSSCache {
  if (!globalCache) {
    globalCache = new EPSSCache(options);
  }
  return globalCache;
}

/**
 * Query EPSS scores with caching
 */
export async function queryEPSSWithCache(
  cves: string[],
  options?: EPSSCacheOptions
): Promise<Map<string, EPSSScore>> {
  const client = getEPSSClient();
  const cache = getEPSSCache(options);
  const result = new Map<string, EPSSScore>();

  // Check cache first
  const uncached: string[] = [];
  for (const cve of cves) {
    const cached = cache.get(cve);
    if (cached) {
      result.set(cve.toUpperCase(), cached);
    } else {
      uncached.push(cve);
    }
  }

  // Fetch uncached scores
  if (uncached.length > 0) {
    try {
      // Batch queries in chunks of 100 (API limit)
      const chunkSize = 100;
      for (let i = 0; i < uncached.length; i += chunkSize) {
        const chunk = uncached.slice(i, i + chunkSize);
        const scores = await client.queryBatch(chunk);

        for (const score of scores) {
          cache.set(score);
          result.set(score.cve.toUpperCase(), score);
        }
      }

      cache.saveCache();
    } catch (error) {
      // Continue with partial results on API error
      console.error('Warning: EPSS API query failed:', (error as Error).message);
    }
  }

  return result;
}

/**
 * Extract CVE IDs from vulnerability data
 */
export function extractCVEs(vulnerabilities: Array<{ id?: string; aliases?: string[] }>): string[] {
  const cves = new Set<string>();

  for (const vuln of vulnerabilities) {
    // Check main ID (case-insensitive)
    if (vuln.id?.toUpperCase().startsWith('CVE-')) {
      cves.add(vuln.id.toUpperCase());
    }

    // Check aliases
    if (vuln.aliases) {
      for (const alias of vuln.aliases) {
        if (alias.toUpperCase().startsWith('CVE-')) {
          cves.add(alias.toUpperCase());
        }
      }
    }
  }

  return Array.from(cves);
}

/**
 * Create a full EPSS priority report from analysis results
 */
export async function createEPSSReport(
  vulnerabilities: Array<{
    id: string;
    aliases?: string[];
    severity?: string;
    cvss?: number;
    isReachable?: boolean;
  }>,
  options?: EPSSCacheOptions
): Promise<EPSSReport> {
  // Extract all CVE IDs
  const cves = extractCVEs(vulnerabilities);

  // Query EPSS scores
  const epssScores = await queryEPSSWithCache(cves, options);

  // Calculate priorities
  const priorities: PriorityScore[] = [];
  const summary = {
    total: vulnerabilities.length,
    withEPSS: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const vuln of vulnerabilities) {
    // Find CVE ID
    let cveId = vuln.id.startsWith('CVE-') ? vuln.id : null;
    if (!cveId && vuln.aliases) {
      cveId = vuln.aliases.find(a => a.startsWith('CVE-')) ?? null;
    }

    if (!cveId) continue;

    const epss = epssScores.get(cveId.toUpperCase());
    if (epss) summary.withEPSS++;

    const priority = calculatePriority(
      cveId,
      epss?.epss ?? null,
      vuln.cvss ?? null,
      vuln.isReachable ?? false
    );

    if (epss) {
      priority.epss = epss;
    }

    priorities.push(priority);

    // Update summary
    switch (priority.priority) {
      case 'critical': summary.critical++; break;
      case 'high': summary.high++; break;
      case 'medium': summary.medium++; break;
      case 'low': summary.low++; break;
    }
  }

  // Get model date
  let modelDate = new Date().toISOString().split('T')[0];
  const firstEpss = epssScores.values().next().value;
  if (firstEpss) {
    modelDate = firstEpss.date;
  }

  return {
    scannedAt: new Date().toISOString(),
    modelDate,
    summary,
    priorities,
  };
}
