/**
 * ReachVet - Base Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import pLimit from 'p-limit';
import type { LanguageAdapter, SupportedLanguage, Component, ComponentResult, AnalysisWarning, CodeLocation, UsageInfo } from '../types.js';

/** Options passed to adapter analyze method */
export interface AdapterOptions {
  ignorePatterns?: string[];
  concurrency?: number;
  verbose?: boolean;
  includeDevDependencies?: boolean;
}

/**
 * Abstract base class for language adapters
 */
export abstract class BaseLanguageAdapter implements LanguageAdapter {
  abstract language: SupportedLanguage;
  abstract fileExtensions: string[];
  
  /** Patterns to ignore when searching for source files */
  protected ignorePatterns: string[] = ['**/node_modules/**', '**/.git/**'];
  
  /** Concurrency limit for file parsing */
  protected concurrency: number = 10;

  /** 
   * Set additional ignore patterns (merged with defaults)
   */
  setIgnorePatterns(patterns: string[]): void {
    this.ignorePatterns = [...new Set([...this.ignorePatterns, ...patterns])];
  }

  /**
   * Set concurrency limit for parallel file processing
   */
  setConcurrency(limit: number): void {
    this.concurrency = Math.max(1, limit);
  }

  abstract analyze(sourceDir: string, components: Component[], options?: AdapterOptions): Promise<ComponentResult[]>;
  abstract canHandle(sourceDir: string): Promise<boolean>;

  /**
   * Create a "not reachable" result
   */
  protected notReachable(component: Component, notes?: string[], warnings?: AnalysisWarning[]): ComponentResult {
    return {
      component,
      status: 'not_reachable',
      confidence: 'high',
      notes,
      warnings: warnings?.length ? warnings : undefined
    };
  }

  /**
   * Create a "reachable" result
   */
  protected reachable(
    component: Component,
    usage: ComponentResult['usage'],
    confidence: ComponentResult['confidence'] = 'high',
    notes?: string[],
    warnings?: AnalysisWarning[]
  ): ComponentResult {
    return {
      component,
      status: 'reachable',
      usage,
      confidence,
      notes,
      warnings: warnings?.length ? warnings : undefined
    };
  }

  /**
   * Create an "imported" result (imported but usage unclear)
   */
  protected imported(
    component: Component,
    usage: ComponentResult['usage'],
    notes?: string[],
    warnings?: AnalysisWarning[]
  ): ComponentResult {
    return {
      component,
      status: 'imported',
      usage,
      confidence: 'medium',
      notes,
      warnings: warnings?.length ? warnings : undefined
    };
  }

  /**
   * Create an "indirect" result (used via re-export/transitive)
   */
  protected indirect(
    component: Component,
    usage: ComponentResult['usage'],
    notes?: string[],
    warnings?: AnalysisWarning[]
  ): ComponentResult {
    return {
      component,
      status: 'indirect',
      usage,
      confidence: 'medium',
      notes,
      warnings: warnings?.length ? warnings : undefined
    };
  }

  /**
   * Create an "unknown" result
   */
  protected unknown(component: Component, notes?: string[], warnings?: AnalysisWarning[]): ComponentResult {
    return {
      component,
      status: 'unknown',
      confidence: 'low',
      notes,
      warnings: warnings?.length ? warnings : undefined
    };
  }

  /**
   * Find source files in a directory
   */
  protected async findSourceFiles(sourceDir: string, customIgnore?: string[]): Promise<string[]> {
    const patterns = this.fileExtensions.map(ext => `**/*${ext}`);
    const ignore = [...this.ignorePatterns, ...(customIgnore || [])];
    
    const files = await glob(patterns, {
      cwd: sourceDir,
      absolute: true,
      ignore,
      nodir: true
    });

    return files;
  }

  /** Track skipped files for observability */
  protected skippedFiles: string[] = [];

  /**
   * Read and parse all source files, returning only those with imports
   * Uses concurrency limit for parallel processing
   */
  protected async parseSourceFiles<T>(
    sourceDir: string,
    parseFunc: (content: string, fileName: string) => T[],
    customIgnore?: string[]
  ): Promise<Array<{ file: string; imports: T[]; source: string }>> {
    const files = await this.findSourceFiles(sourceDir, customIgnore);
    const limit = pLimit(this.concurrency);
    this.skippedFiles = []; // Reset for each analysis

    const tasks = files.map(file => limit(async () => {
      try {
        const content = await readFile(file, 'utf-8');
        const imports = parseFunc(content, file);
        if (imports.length > 0) {
          return { file, imports, source: content };
        }
        return null;
      } catch (error) {
        // Track skipped files for observability
        this.skippedFiles.push(file);
        return null;
      }
    }));

    const results = await Promise.all(tasks);
    return results.filter((r): r is { file: string; imports: T[]; source: string } => r !== null);
  }

  /**
   * Get files that were skipped due to parse errors
   */
  getSkippedFiles(): string[] {
    return this.skippedFiles;
  }

  /**
   * Create usage info from locations and used members
   */
  protected createUsage(
    locations: CodeLocation[],
    usedMembers?: string[],
    importStyle: UsageInfo['importStyle'] = 'esm'
  ): UsageInfo {
    return {
      importStyle,
      usedMembers: usedMembers?.length ? usedMembers : undefined,
      locations
    };
  }

  /**
   * Check if any vulnerable functions are used
   */
  protected checkVulnerableFunctions(
    component: Component,
    usedMethods: string[]
  ): string[] {
    const vulnFunctions = component.vulnerabilities?.flatMap(v => v.affectedFunctions ?? []) ?? [];
    
    if (vulnFunctions.length === 0 || usedMethods.length === 0) {
      return [];
    }
    
    return vulnFunctions.filter(f => usedMethods.includes(f));
  }
}
