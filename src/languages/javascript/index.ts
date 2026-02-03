/**
 * ReachVet - JavaScript/TypeScript Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, type ImportInfo } from './parser.js';
import { matchesComponent, extractUsedMembers, getPrimaryImportStyle } from './detector.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class JavaScriptAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'javascript';
  fileExtensions = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];

  private ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.min.js',
    '**/*.bundle.js'
  ];

  /**
   * Check if this adapter can handle the directory
   */
  async canHandle(sourceDir: string): Promise<boolean> {
    const packageJsonPath = join(sourceDir, 'package.json');
    return existsSync(packageJsonPath);
  }

  /**
   * Analyze components for reachability
   */
  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    // Find all JS/TS files
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No source files found']));
    }

    // Parse all files and collect imports
    const allImports: Array<{ file: string; imports: ImportInfo[] }> = [];
    
    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const imports = parseSource(content, file);
        if (imports.length > 0) {
          allImports.push({ file, imports });
        }
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Analyze each component
    const results: ComponentResult[] = [];

    for (const component of components) {
      const result = this.analyzeComponent(component, allImports);
      results.push(result);
    }

    return results;
  }

  /**
   * Analyze a single component
   */
  private analyzeComponent(
    component: Component,
    allImports: Array<{ file: string; imports: ImportInfo[] }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: ImportInfo }> = [];

    // Find all imports that match this component
    for (const { file, imports } of allImports) {
      for (const imp of imports) {
        if (matchesComponent(imp, component)) {
          matchingImports.push({ file, import: imp });
        }
      }
    }

    // Not found anywhere
    if (matchingImports.length === 0) {
      return this.notReachable(component, ['Not imported in any source file']);
    }

    // Collect locations and usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    const allMatchedImports = matchingImports.map(m => m.import);
    const usedMembers = extractUsedMembers(allMatchedImports);
    const importStyle = getPrimaryImportStyle(allMatchedImports);

    const usage: UsageInfo = {
      importStyle,
      usedMembers: usedMembers.length > 0 ? usedMembers : undefined,
      locations
    };

    // Generate warnings
    const warnings = this.generateWarnings(allMatchedImports);

    // Check if specific vulnerable functions are used
    const vulnFunctions = component.vulnerabilities?.flatMap(v => v.affectedFunctions ?? []) ?? [];
    
    if (vulnFunctions.length > 0) {
      // Check if any affected functions are explicitly imported
      const affectedUsed = vulnFunctions.filter(f => usedMembers.includes(f));
      
      if (affectedUsed.length > 0) {
        return this.reachable(
          component,
          { ...usage, usedMembers: affectedUsed },
          'high',
          [`Vulnerable function(s) explicitly imported: ${affectedUsed.join(', ')}`],
          warnings
        );
      }

      // Namespace or default import - can't be sure
      const hasNamespaceImport = allMatchedImports.some(i => i.isNamespaceImport || i.isDefaultImport);
      if (hasNamespaceImport) {
        // Add namespace import warning
        const nsWarnings = allMatchedImports
          .filter(i => i.isNamespaceImport || i.isDefaultImport)
          .map(i => ({
            code: 'namespace_import' as const,
            message: `Namespace/default import - cannot determine which functions are used at runtime`,
            location: i.location,
            severity: 'warning' as const
          }));
        
        return this.reachable(
          component,
          usage,
          'medium',
          [`Namespace/default import detected - vulnerable functions (${vulnFunctions.join(', ')}) may be accessible`],
          [...warnings, ...nsWarnings]
        );
      }

      // Named imports but none of the vulnerable functions
      if (usedMembers.length > 0) {
        return this.imported(
          component,
          usage,
          [`Imported but vulnerable functions (${vulnFunctions.join(', ')}) not explicitly used`],
          warnings
        );
      }
    }

    // No vulnerability info - just report as reachable
    return this.reachable(
      component,
      usage,
      'high',
      [`Imported in ${locations.length} location(s)`],
      warnings
    );
  }

  /**
   * Generate warnings for analysis limitations
   */
  private generateWarnings(imports: ImportInfo[]): AnalysisWarning[] {
    const warnings: AnalysisWarning[] = [];

    // Check for dynamic imports
    const dynamicImports = imports.filter(i => i.importStyle === 'dynamic');
    for (const imp of dynamicImports) {
      warnings.push({
        code: 'dynamic_import',
        message: 'Dynamic import detected - runtime behavior may differ from static analysis',
        location: imp.location,
        severity: 'warning'
      });
    }

    return warnings;
  }

  /**
   * Find all source files
   */
  private async findSourceFiles(sourceDir: string): Promise<string[]> {
    const patterns = this.fileExtensions.map(ext => `**/*${ext}`);
    
    const files = await glob(patterns, {
      cwd: sourceDir,
      absolute: true,
      ignore: this.ignorePatterns,
      nodir: true
    });

    return files;
  }
}

// Export singleton
export const javascriptAdapter = new JavaScriptAdapter();
