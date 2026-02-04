/**
 * ReachVet Watch Mode
 * File watcher for continuous analysis with live updates
 */

import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import chalk from 'chalk';
import { Analyzer, type EnrichedAnalyzeOptions } from '../core/analyzer.js';
import type { Component, AnalysisOutput, SupportedLanguage } from '../types.js';
import { AnalysisCache, type CacheOptions } from '../cache/index.js';

export interface WatchOptions {
  /** Source directory to watch */
  sourceDir: string;
  /** Components to analyze */
  components: Component[];
  /** Language (auto-detect if not specified) */
  language?: SupportedLanguage;
  /** OSV vulnerability lookup */
  osvLookup?: boolean;
  /** OSV options */
  osvOptions?: EnrichedAnalyzeOptions['osvOptions'];
  /** Debounce delay in milliseconds */
  debounceMs?: number;
  /** Quiet mode - only show summary */
  quiet?: boolean;
  /** Glob patterns to ignore */
  ignored?: string[];
  /** Callback when analysis completes */
  onAnalysis?: (output: AnalysisOutput) => void;
  /** Enable incremental analysis cache */
  cache?: boolean;
  /** Cache options */
  cacheOptions?: CacheOptions;
}

interface WatchStats {
  analysisCount: number;
  lastAnalysis: Date | null;
  lastChangeFile: string | null;
  errors: number;
  cacheHits: number;
  cacheMisses: number;
}

export class Watcher {
  private watcher: FSWatcher | null = null;
  private analyzer: Analyzer;
  private components: Component[];
  private options: WatchOptions;
  private stats: WatchStats = {
    analysisCount: 0,
    lastAnalysis: null,
    lastChangeFile: null,
    errors: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges: Set<string> = new Set();
  private isAnalyzing = false;
  private cache: AnalysisCache | null = null;

  constructor(options: WatchOptions) {
    this.options = {
      debounceMs: 500,
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      cache: true, // Enable cache by default for watch mode
      ...options,
    };
    this.components = options.components;
    this.analyzer = new Analyzer({
      sourceDir: options.sourceDir,
      language: options.language,
      osvLookup: options.osvLookup,
      osvOptions: options.osvOptions,
    });

    // Initialize cache if enabled
    if (this.options.cache) {
      this.cache = new AnalysisCache({
        ttlMs: 60 * 60 * 1000, // 1 hour default
        maxEntries: 10000,
        parserVersion: '1.0.0',
        ...this.options.cacheOptions,
      });
    }
  }

  /**
   * Start watching for file changes
   */
  async start(): Promise<void> {
    this.printHeader();

    // Initial analysis
    await this.runAnalysis('initial');

    // Set up file watcher
    this.watcher = chokidarWatch(this.options.sourceDir, {
      ignored: this.options.ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher
      .on('add', (path) => this.handleChange(path, 'add'))
      .on('change', (path) => this.handleChange(path, 'change'))
      .on('unlink', (path) => this.handleChange(path, 'unlink'))
      .on('error', (error) => this.handleError(error));

    this.printWatching();
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Save cache to disk if persistence is enabled
    if (this.cache && this.options.cacheOptions?.persistToDisk) {
      this.cache.saveToDisk();
    }

    console.log(chalk.gray('\n👋 Watch mode stopped'));
  }

  /**
   * Get the analysis cache (for testing/inspection)
   */
  getCache(): AnalysisCache | null {
    return this.cache;
  }

  /**
   * Handle file change event
   */
  private handleChange(path: string, event: string): void {
    // Filter by file extension
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const relevantExtensions = [
      // JavaScript/TypeScript
      'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
      // Python
      'py',
      // Go
      'go',
      // Java
      'java',
      // Rust
      'rs',
      // Ruby
      'rb',
      // PHP
      'php',
      // C#
      'cs',
      // Swift
      'swift',
      // Kotlin
      'kt', 'kts',
      // Scala
      'scala', 'sbt',
      // Elixir
      'ex', 'exs',
      // Dart
      'dart',
      // Perl
      'pl', 'pm',
      // Haskell
      'hs', 'lhs',
      // Clojure
      'clj', 'cljs', 'cljc', 'edn',
      // OCaml
      'ml', 'mli',
      // Config files
      'json', 'toml', 'yaml', 'yml', 'xml', 'gradle', 'gemfile', 'csproj',
    ];

    if (!relevantExtensions.includes(ext) && !path.endsWith('lock')) {
      return;
    }

    // Invalidate cache for changed file
    if (this.cache && (event === 'change' || event === 'unlink')) {
      this.cache.invalidate(path);
    }

    this.pendingChanges.add(path);
    this.stats.lastChangeFile = path;

    // Debounce analysis
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const changes = [...this.pendingChanges];
      this.pendingChanges.clear();
      this.runAnalysis('change', changes);
    }, this.options.debounceMs);
  }

  /**
   * Handle watcher error
   */
  private handleError(error: unknown): void {
    this.stats.errors++;
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n❌ Watch error: ${message}`));
  }

  /**
   * Run analysis
   */
  private async runAnalysis(trigger: 'initial' | 'change', changedFiles?: string[]): Promise<void> {
    if (this.isAnalyzing) {
      // Queue for later
      return;
    }

    this.isAnalyzing = true;
    this.stats.analysisCount++;
    this.stats.lastAnalysis = new Date();

    try {
      // Clear screen for better UX
      if (trigger === 'change' && !this.options.quiet) {
        console.log(chalk.gray('\n─────────────────────────────────────────────────'));
        if (changedFiles && changedFiles.length > 0) {
          console.log(chalk.gray(`📝 Changed: ${changedFiles.map(f => f.split('/').pop()).join(', ')}`));
        }
      }

      const startTime = Date.now();
      const output = await this.analyzer.analyze(this.components);
      const duration = Date.now() - startTime;

      // Update cache stats
      if (this.cache) {
        const cacheStats = this.cache.getStats();
        this.stats.cacheHits = cacheStats.hits;
        this.stats.cacheMisses = cacheStats.misses;
      }

      this.printResults(output, duration, trigger);

      if (this.options.onAnalysis) {
        this.options.onAnalysis(output);
      }
    } catch (error) {
      this.stats.errors++;
      console.error(chalk.red(`\n❌ Analysis error: ${(error as Error).message}`));
    } finally {
      this.isAnalyzing = false;
    }
  }

  /**
   * Print header
   */
  private printHeader(): void {
    console.log();
    console.log(chalk.cyan.bold('╔══════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║            ReachVet Watch Mode                       ║'));
    console.log(chalk.cyan.bold('╚══════════════════════════════════════════════════════╝'));
    console.log();
    console.log(chalk.gray(`Source: ${this.options.sourceDir}`));
    console.log(chalk.gray(`Components: ${this.components.length}`));
    console.log();
  }

  /**
   * Print watching message
   */
  private printWatching(): void {
    console.log();
    console.log(chalk.cyan('👀 Watching for changes...'));
    console.log(chalk.gray('   Press Ctrl+C to stop'));
    console.log();
  }

  /**
   * Print analysis results
   */
  private printResults(output: AnalysisOutput, durationMs: number, trigger: 'initial' | 'change'): void {
    const time = new Date().toLocaleTimeString();
    const duration = `${durationMs}ms`;

    if (this.options.quiet) {
      // Compact output
      const status = output.summary.vulnerableReachable > 0
        ? chalk.red('⚠️')
        : output.summary.reachable > 0
          ? chalk.yellow('●')
          : chalk.green('✓');
      
      console.log(`${chalk.gray(`[${time}]`)} ${status} ${output.summary.reachable} reachable, ${output.summary.vulnerableReachable} vulnerable ${chalk.gray(`(${duration})`)}`);
      return;
    }

    // Full output
    console.log();
    console.log(chalk.gray(`[${time}] Analysis ${trigger === 'initial' ? 'completed' : 'updated'} in ${duration}`));
    console.log();

    // Summary box
    const vulnReachable = output.summary.vulnerableReachable;
    const reachable = output.summary.reachable;
    const imported = output.summary.imported;
    const notReachable = output.summary.notReachable;

    if (vulnReachable > 0) {
      console.log(chalk.red.bold(`  🚨 VULNERABLE & REACHABLE: ${vulnReachable}`));
    }

    console.log(`  ${chalk.red('🔴')} Reachable:     ${reachable}`);
    console.log(`  ${chalk.yellow('🟡')} Imported:      ${imported}`);
    console.log(`  ${chalk.green('🟢')} Not reachable: ${notReachable}`);

    // Show top vulnerable components
    const vulnComponents = output.results.filter(
      r => r.status === 'reachable' && r.component.vulnerabilities?.length
    );

    if (vulnComponents.length > 0) {
      console.log();
      console.log(chalk.red.bold('  Vulnerable packages in use:'));
      for (const result of vulnComponents.slice(0, 5)) {
        const vulnCount = result.component.vulnerabilities!.length;
        console.log(chalk.red(`    • ${result.component.name}@${result.component.version} (${vulnCount} vuln${vulnCount > 1 ? 's' : ''})`));
      }
      if (vulnComponents.length > 5) {
        console.log(chalk.gray(`    ... and ${vulnComponents.length - 5} more`));
      }
    }

    // Show warnings if any
    if (output.summary.warningsCount && output.summary.warningsCount > 0) {
      console.log();
      console.log(chalk.yellow(`  ⚠️  ${output.summary.warningsCount} analysis warning(s)`));
    }

    // Show cache stats if enabled and not initial run
    if (this.cache && trigger === 'change') {
      const cacheStats = this.cache.getStats();
      const hitRate = cacheStats.hitRate * 100;
      if (hitRate > 0) {
        console.log();
        console.log(chalk.gray(`  📦 Cache: ${cacheStats.entries} entries, ${hitRate.toFixed(0)}% hit rate`));
      }
    }
  }

  /**
   * Get watch statistics
   */
  getStats(): WatchStats {
    return { ...this.stats };
  }
}

/**
 * Start watch mode (convenience function)
 */
export async function startWatch(options: WatchOptions): Promise<Watcher> {
  const watcher = new Watcher(options);
  await watcher.start();
  return watcher;
}
