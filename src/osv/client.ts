/**
 * OSV API Client
 * https://osv.dev/docs/
 */

import {
  OSVQuery,
  OSVBatchQuery,
  OSVQueryResponse,
  OSVBatchResponse,
  OSVVulnerability,
  VulnerableFunctionInfo,
  PackageVulnerabilityInfo,
  OSVCacheOptions,
} from './types.js';
import { OSVCache } from './cache.js';

const OSV_API_BASE = 'https://api.osv.dev/v1';

export interface OSVClientOptions {
  cache?: Partial<OSVCacheOptions>;
  timeout?: number;              // Request timeout in ms (default: 10000)
  retries?: number;              // Number of retries (default: 2)
}

/**
 * Map ecosystem names to OSV format
 */
const ECOSYSTEM_MAP: Record<string, string> = {
  'npm': 'npm',
  'pypi': 'PyPI',
  'pip': 'PyPI',
  'maven': 'Maven',
  'go': 'Go',
  'cargo': 'crates.io',
  'rust': 'crates.io',
  'nuget': 'NuGet',
  'rubygems': 'RubyGems',
  'packagist': 'Packagist',
  'php': 'Packagist',
  'hex': 'Hex',
  'pub': 'Pub',
  'hackage': 'Hackage',
  'cocoapods': 'CocoaPods',
  'swift': 'SwiftURL',
  'alpine': 'Alpine',
  'debian': 'Debian',
  'linux': 'Linux',
};

export class OSVClient {
  private cache: OSVCache;
  private timeout: number;
  private retries: number;

  constructor(options: OSVClientOptions = {}) {
    this.cache = new OSVCache(options.cache);
    this.timeout = options.timeout ?? 10000;
    this.retries = options.retries ?? 2;
  }

  /**
   * Normalize ecosystem name to OSV format
   */
  private normalizeEcosystem(ecosystem: string): string {
    const lower = ecosystem.toLowerCase();
    return ECOSYSTEM_MAP[lower] ?? ecosystem;
  }

  /**
   * Make HTTP request with retry
   */
  private async request<T>(url: string, body: unknown): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`OSV API error: ${response.status} ${response.statusText}`);
        }

        return await response.json() as T;
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on abort
        if ((error as Error).name === 'AbortError') {
          throw new Error(`OSV API timeout after ${this.timeout}ms`);
        }

        // Wait before retry
        if (attempt < this.retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error('OSV API request failed');
  }

  /**
   * Query vulnerabilities for a single package
   */
  async queryPackage(
    ecosystem: string,
    packageName: string,
    version: string
  ): Promise<OSVVulnerability[]> {
    const normalizedEcosystem = this.normalizeEcosystem(ecosystem);

    // Check cache first
    const cached = await this.cache.get<OSVVulnerability[]>(
      normalizedEcosystem,
      packageName,
      version
    );
    if (cached !== null) {
      return cached;
    }

    const query: OSVQuery = {
      package: {
        name: packageName,
        ecosystem: normalizedEcosystem,
      },
      version,
    };

    const response = await this.request<OSVQueryResponse>(
      `${OSV_API_BASE}/query`,
      query
    );

    const vulns = response.vulns ?? [];

    // Cache result
    await this.cache.set(normalizedEcosystem, packageName, version, vulns);

    return vulns;
  }

  /**
   * Batch query for multiple packages
   */
  async queryBatch(
    packages: Array<{ ecosystem: string; name: string; version: string }>
  ): Promise<Map<string, OSVVulnerability[]>> {
    const results = new Map<string, OSVVulnerability[]>();
    const uncached: Array<{ idx: number; ecosystem: string; name: string; version: string }> = [];

    // Check cache for each package
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      const normalizedEcosystem = this.normalizeEcosystem(pkg.ecosystem);
      const key = `${normalizedEcosystem}:${pkg.name}:${pkg.version}`;
      
      const cached = await this.cache.get<OSVVulnerability[]>(
        normalizedEcosystem,
        pkg.name,
        pkg.version
      );
      
      if (cached !== null) {
        results.set(key, cached);
      } else {
        uncached.push({ idx: i, ...pkg });
      }
    }

    // Query uncached packages
    if (uncached.length > 0) {
      const queries: OSVQuery[] = uncached.map(pkg => ({
        package: {
          name: pkg.name,
          ecosystem: this.normalizeEcosystem(pkg.ecosystem),
        },
        version: pkg.version,
      }));

      const batchQuery: OSVBatchQuery = { queries };
      
      try {
        const response = await this.request<OSVBatchResponse>(
          `${OSV_API_BASE}/querybatch`,
          batchQuery
        );

        // Process results
        for (let i = 0; i < response.results.length; i++) {
          const pkg = uncached[i];
          const normalizedEcosystem = this.normalizeEcosystem(pkg.ecosystem);
          const vulns = response.results[i].vulns ?? [];
          const key = `${normalizedEcosystem}:${pkg.name}:${pkg.version}`;

          results.set(key, vulns);

          // Cache result
          await this.cache.set(normalizedEcosystem, pkg.name, pkg.version, vulns);
        }
      } catch (error) {
        // On batch failure, mark uncached as empty
        for (const pkg of uncached) {
          const key = `${this.normalizeEcosystem(pkg.ecosystem)}:${pkg.name}:${pkg.version}`;
          results.set(key, []);
        }
      }
    }

    return results;
  }

  /**
   * Get vulnerability details by ID
   */
  async getVulnerability(vulnId: string): Promise<OSVVulnerability | null> {
    try {
      const response = await fetch(`${OSV_API_BASE}/vulns/${vulnId}`);
      if (!response.ok) {
        return null;
      }
      return await response.json() as OSVVulnerability;
    } catch {
      return null;
    }
  }

  /**
   * Extract vulnerable functions from OSV vulnerability data
   * This is the key function for ReachVet integration
   */
  extractVulnerableFunctions(vuln: OSVVulnerability): VulnerableFunctionInfo {
    const functions: string[] = [];
    const paths: string[] = [];
    let fixedVersion: string | undefined;
    let severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown' = 'unknown';

    // Extract severity from CVSS
    if (vuln.severity && vuln.severity.length > 0) {
      const cvss = vuln.severity[0].score;
      // Parse CVSS score (simplified)
      const scoreMatch = cvss.match(/CVSS:\d\.\d\/AV:[\w]+\/AC:[\w]+\/.*?\/(\d+\.\d+)/);
      if (scoreMatch) {
        const score = parseFloat(scoreMatch[1]);
        if (score >= 9.0) severity = 'critical';
        else if (score >= 7.0) severity = 'high';
        else if (score >= 4.0) severity = 'medium';
        else if (score > 0) severity = 'low';
      }
      // Alternative: Try to extract base score directly
      const baseMatch = cvss.match(/(\d+\.\d+)$/);
      if (baseMatch && severity === 'unknown') {
        const score = parseFloat(baseMatch[1]);
        if (score >= 9.0) severity = 'critical';
        else if (score >= 7.0) severity = 'high';
        else if (score >= 4.0) severity = 'medium';
        else if (score > 0) severity = 'low';
      }
    }

    // Extract affected functions from ecosystem_specific
    if (vuln.affected) {
      for (const affected of vuln.affected) {
        // Get fixed version from ranges
        if (affected.ranges) {
          for (const range of affected.ranges) {
            for (const event of range.events) {
              if (event.fixed && !fixedVersion) {
                fixedVersion = event.fixed;
              }
            }
          }
        }

        // Get vulnerable functions from ecosystem_specific
        const ecosystemSpecific = affected.ecosystem_specific;
        if (ecosystemSpecific?.imports) {
          for (const imp of ecosystemSpecific.imports) {
            if (imp.path) {
              paths.push(imp.path);
            }
            if (imp.symbols) {
              functions.push(...imp.symbols);
            }
          }
        }
      }
    }

    // Deduplicate
    return {
      vulnId: vuln.id,
      severity,
      functions: [...new Set(functions)],
      paths: [...new Set(paths)],
      fixedVersion,
      description: vuln.summary || vuln.details?.substring(0, 200),
    };
  }

  /**
   * Get complete vulnerability info for a package, including vulnerable functions
   */
  async getPackageVulnerabilityInfo(
    ecosystem: string,
    packageName: string,
    version: string
  ): Promise<PackageVulnerabilityInfo> {
    const vulns = await this.queryPackage(ecosystem, packageName, version);

    const vulnerabilities = vulns.map(vuln => this.extractVulnerableFunctions(vuln));

    return {
      packageName,
      ecosystem: this.normalizeEcosystem(ecosystem),
      version,
      vulnerabilities,
    };
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<number> {
    return this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  async cacheStats(): Promise<{ entries: number; sizeBytes: number; expiredCount: number }> {
    return this.cache.stats();
  }
}

export default OSVClient;
