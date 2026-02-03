/**
 * ReachVet - Core Analyzer
 */

import type {
  Component,
  ComponentResult,
  AnalysisOutput,
  AnalysisSummary,
  AnalyzeOptions,
  SupportedLanguage
} from '../types.js';
import { getAdapter, detectLanguage } from '../languages/index.js';

const VERSION = '0.1.0';

export class Analyzer {
  private options: Required<AnalyzeOptions>;

  constructor(options: AnalyzeOptions) {
    this.options = {
      sourceDir: options.sourceDir,
      language: options.language ?? 'javascript',
      concurrency: options.concurrency ?? 10,
      verbose: options.verbose ?? false,
      includeDevDependencies: options.includeDevDependencies ?? false,
      ignorePatterns: options.ignorePatterns ?? []
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

    // Check if adapter can handle this directory
    const canHandle = await adapter.canHandle(this.options.sourceDir);
    if (!canHandle) {
      throw new Error(`Adapter for ${language} cannot handle directory: ${this.options.sourceDir}`);
    }

    if (this.options.verbose) {
      console.error(`Analyzing ${components.length} components in ${this.options.sourceDir}`);
      console.error(`Language: ${language}`);
    }

    // Run analysis
    const results = await adapter.analyze(this.options.sourceDir, components);

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
  options?: Partial<AnalyzeOptions>
): Promise<AnalysisOutput> {
  const analyzer = new Analyzer({ sourceDir, ...options });
  return analyzer.analyze(components);
}
