/**
 * ReachVet - Core Analyzer
 */

import type {
  Component,
  ComponentResult,
  ComponentVulnerability,
  AnalysisOutput,
  AnalysisSummary,
  AnalyzeOptions,
  SupportedLanguage
} from '../types.js';
import { getAdapter, detectLanguage } from '../languages/index.js';
import { OSVClient } from '../osv/index.js';
import type { OSVClientOptions, VulnerableFunctionInfo } from '../osv/index.js';

const VERSION = '0.2.0';

export interface EnrichedAnalyzeOptions extends AnalyzeOptions {
  /** Enable OSV vulnerability lookup */
  osvLookup?: boolean;
  /** OSV client options */
  osvOptions?: OSVClientOptions;
}

export class Analyzer {
  private options: Omit<Required<AnalyzeOptions>, 'language'> & { language?: SupportedLanguage };
  private osvClient?: OSVClient;
  private osvLookup: boolean;

  constructor(options: EnrichedAnalyzeOptions) {
    this.options = {
      sourceDir: options.sourceDir,
      language: options.language, // undefined allows auto-detection
      concurrency: options.concurrency ?? 10,
      verbose: options.verbose ?? false,
      includeDevDependencies: options.includeDevDependencies ?? false,
      ignorePatterns: options.ignorePatterns ?? []
    };
    
    this.osvLookup = options.osvLookup ?? false;
    if (this.osvLookup) {
      this.osvClient = new OSVClient(options.osvOptions);
    }
  }

  /**
   * Enrich components with vulnerability data from OSV
   */
  private async enrichWithOSV(components: Component[]): Promise<Component[]> {
    if (!this.osvClient) return components;

    const packages = components.map(c => ({
      ecosystem: c.ecosystem ?? 'npm',
      name: c.name,
      version: c.version,
    }));

    if (this.options.verbose) {
      console.error(`Fetching vulnerability data from OSV for ${packages.length} packages...`);
    }

    const vulnMap = await this.osvClient.queryBatch(packages);

    return components.map(c => {
      const ecosystem = c.ecosystem ?? 'npm';
      const key = `${ecosystem}:${c.name}:${c.version}`;
      const osvVulns = vulnMap.get(key) ?? [];

      if (osvVulns.length === 0) return c;

      // Convert OSV vulnerabilities to component vulnerabilities
      const vulnerabilities: ComponentVulnerability[] = osvVulns.map(vuln => {
        const info = this.osvClient!.extractVulnerableFunctions(vuln);
        return this.vulnInfoToComponentVuln(info);
      });

      // Merge with existing vulnerabilities
      const existingIds = new Set(c.vulnerabilities?.map(v => v.id) ?? []);
      const newVulns = vulnerabilities.filter(v => !existingIds.has(v.id));

      return {
        ...c,
        vulnerabilities: [...(c.vulnerabilities ?? []), ...newVulns],
      };
    });
  }

  /**
   * Convert VulnerableFunctionInfo to ComponentVulnerability
   */
  private vulnInfoToComponentVuln(info: VulnerableFunctionInfo): ComponentVulnerability {
    return {
      id: info.vulnId,
      severity: info.severity,
      affectedFunctions: info.functions.length > 0 ? info.functions : undefined,
      fixedVersion: info.fixedVersion,
      description: info.description,
    };
  }

  /**
   * Analyze components for reachability
   */
  async analyze(components: Component[]): Promise<AnalysisOutput> {
    // Get the appropriate adapter
    let language = this.options.language;
    
    if (!language) {
      const detected = await detectLanguage(this.options.sourceDir);
      if (!detected) {
        throw new Error(`Could not detect language for ${this.options.sourceDir}`);
      }
      language = detected;
    }

    const adapter = getAdapter(language);
    if (!adapter) {
      throw new Error(`No adapter available for language: ${language}`);
    }

    // Pass custom ignore patterns to adapter if specified
    if (this.options.ignorePatterns.length > 0 && 'setIgnorePatterns' in adapter) {
      (adapter as { setIgnorePatterns(patterns: string[]): void }).setIgnorePatterns(this.options.ignorePatterns);
    }

    // Check if adapter can handle this directory
    const canHandle = await adapter.canHandle(this.options.sourceDir);
    if (!canHandle) {
      throw new Error(`Adapter for ${language} cannot handle directory: ${this.options.sourceDir}`);
    }

    // Enrich with OSV data if enabled
    let enrichedComponents = components;
    if (this.osvLookup) {
      enrichedComponents = await this.enrichWithOSV(components);
    }

    if (this.options.verbose) {
      console.error(`Analyzing ${enrichedComponents.length} components in ${this.options.sourceDir}`);
      console.error(`Language: ${language}`);
      if (this.osvLookup) {
        const withVulns = enrichedComponents.filter(c => c.vulnerabilities?.length).length;
        console.error(`Packages with vulnerabilities (from OSV): ${withVulns}`);
      }
    }

    // Run analysis
    const results = await adapter.analyze(this.options.sourceDir, enrichedComponents);

    // Calculate summary
    const summary = this.calculateSummary(results);

    return {
      version: VERSION,
      timestamp: new Date().toISOString(),
      sourceDir: this.options.sourceDir,
      language: language as SupportedLanguage,
      summary,
      results
    };
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(results: ComponentResult[]): AnalysisSummary {
    let vulnerableReachable = 0;
    let warningsCount = 0;

    for (const result of results) {
      if (result.status === 'reachable' && result.component.vulnerabilities?.length) {
        vulnerableReachable++;
      }
      if (result.warnings?.length) {
        warningsCount += result.warnings.length;
      }
    }

    return {
      total: results.length,
      reachable: results.filter(r => r.status === 'reachable').length,
      imported: results.filter(r => r.status === 'imported').length,
      notReachable: results.filter(r => r.status === 'not_reachable').length,
      indirect: results.filter(r => r.status === 'indirect').length,
      unknown: results.filter(r => r.status === 'unknown').length,
      vulnerableReachable,
      warningsCount
    };
  }
}

/**
 * Quick analyze helper
 */
export async function quickAnalyze(
  sourceDir: string,
  components: Component[],
  options?: Partial<EnrichedAnalyzeOptions>
): Promise<AnalysisOutput> {
  const analyzer = new Analyzer({ sourceDir, ...options });
  return analyzer.analyze(components);
}

/**
 * Export OSVClient for direct usage
 */
export { OSVClient } from '../osv/index.js';
export type { OSVClientOptions } from '../osv/index.js';
