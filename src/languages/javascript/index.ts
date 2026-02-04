/**
 * ReachVet - JavaScript/TypeScript Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findNamespaceUsages, checkImportUsage, type ImportInfo } from './parser.js';
import { analyzeCallGraph, checkImportedMembersCalled } from './callgraph.js';
import { matchesComponent, extractUsedMembers, getPrimaryImportStyle } from './detector.js';
import { resolveReexportChains, type ReexportChain } from './reexport.js';
import { detectWorkspace, isInternalPackage, type WorkspaceInfo } from './workspace.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class JavaScriptAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'javascript';
  fileExtensions = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];

  constructor() {
    super();
    // Extend base ignore patterns with JS-specific patterns
    this.ignorePatterns = [
      ...this.ignorePatterns,
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.min.js',
      '**/*.bundle.js'
    ];
  }

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
    // Detect monorepo/workspace
    const workspace = await detectWorkspace(sourceDir);
    
    // Find all JS/TS files
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No source files found']));
    }

    // Parse all files and collect imports
    const allImports: Array<{ file: string; imports: ImportInfo[]; source: string }> = [];
    // Track re-exported modules and their warnings
    const reexportedModules = new Map<string, { chains: ReexportChain[]; sourceFile: string }>();
    const reexportWarnings: AnalysisWarning[] = [];
    
    // Reset skipped files tracking
    this.skippedFiles = [];
    
    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const imports = parseSource(content, file);
        if (imports.length > 0) {
          allImports.push({ file, imports, source: content });
          
          // Resolve re-export chains for relative imports
          const reexportResult = await resolveReexportChains(file, imports);
          
          // Collect resolved chains
          for (const [, chains] of reexportResult.chains) {
            for (const chain of chains) {
              const existing = reexportedModules.get(chain.originalModule);
              if (existing) {
                existing.chains.push(chain);
              } else {
                reexportedModules.set(chain.originalModule, { 
                  chains: [chain], 
                  sourceFile: file 
                });
              }
            }
          }
          
          // Collect warnings
          for (const warning of reexportResult.warnings) {
            reexportWarnings.push({
              code: warning.code,
              message: warning.message,
              location: warning.location,
              severity: 'warning'
            });
          }
        }
      } catch {
        // Track skipped files for observability
        this.skippedFiles.push(file);
      }
    }

    // Analyze each component
    const results: ComponentResult[] = [];

    for (const component of components) {
      // Skip internal workspace packages
      if (isInternalPackage(component.name, workspace)) {
        results.push(this.notReachable(component, ['Internal workspace package - skipped']));
        continue;
      }
      
      const result = this.analyzeComponent(
        component, 
        allImports, 
        reexportedModules,
        reexportWarnings.filter(w => 
          w.message.includes(component.name) || 
          w.code === 'barrel_file'
        )
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Analyze a single component
   */
  private analyzeComponent(
    component: Component,
    allImports: Array<{ file: string; imports: ImportInfo[]; source: string }>,
    reexportedModules: Map<string, { chains: ReexportChain[]; sourceFile: string }> = new Map(),
    additionalWarnings: AnalysisWarning[] = []
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: ImportInfo; source: string }> = [];
    const typeOnlyImports: Array<{ file: string; import: ImportInfo }> = [];
    const sideEffectImports: Array<{ file: string; import: ImportInfo }> = [];

    // Find all imports that match this component
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        if (matchesComponent(imp, component)) {
          // Separate type-only imports (they don't exist at runtime)
          if (imp.isTypeOnly) {
            typeOnlyImports.push({ file, import: imp });
          }
          // Separate side-effect only imports
          else if (imp.isSideEffectOnly) {
            sideEffectImports.push({ file, import: imp });
          }
          else {
            matchingImports.push({ file, import: imp, source });
          }
        }
      }
    }

    // Check if component is accessed via re-export chain
    // Support both exact match (lodash) and subpath match (lodash/merge)
    let reexportInfo = reexportedModules.get(component.name);
    
    // If not found by exact match, try to find by prefix (for subpath imports like lodash/merge)
    if (!reexportInfo) {
      for (const [moduleName, info] of reexportedModules) {
        // Check if component.name starts with moduleName (e.g., "lodash/merge" starts with "lodash")
        if (component.name.startsWith(moduleName + '/')) {
          reexportInfo = info;
          break;
        }
        // Check if moduleName starts with component.name (e.g., "lodash/merge" when component is "lodash")
        if (moduleName.startsWith(component.name + '/')) {
          reexportInfo = info;
          break;
        }
      }
    }
    
    const isReexported = !!reexportInfo;

    // Handle type-only imports: they don't exist at runtime
    if (matchingImports.length === 0 && typeOnlyImports.length > 0 && !isReexported) {
      const locations = typeOnlyImports.map(t => t.import.location);
      return this.notReachable(
        component,
        [`Only type-only imports found (${typeOnlyImports.length}) - no runtime dependency`],
        [{
          code: 'type_only_import',
          message: 'Type-only imports are erased at compile time and do not create runtime dependencies',
          location: locations[0],
          severity: 'info'
        }]
      );
    }

    // Handle side-effect only imports: import 'module'
    if (matchingImports.length === 0 && sideEffectImports.length > 0 && !isReexported) {
      const locations = sideEffectImports.map(t => t.import.location);
      return this.reachable(
        component,
        {
          importStyle: 'esm',
          locations
        },
        'high',
        [`Side-effect import found - module is loaded but no exports are used`],
        [{
          code: 'side_effect_import',
          message: 'Side-effect import loads the module for its side effects (polyfills, etc.)',
          location: locations[0],
          severity: 'info'
        }]
      );
    }

    // Not found anywhere (direct or via re-export)
    if (matchingImports.length === 0 && !isReexported) {
      return this.notReachable(component, ['Not imported in any source file']);
    }

    // If only found via re-export, mark as indirect (not direct reachable)
    if (matchingImports.length === 0 && reexportInfo) {
      const chainInfo = reexportInfo.chains[0];
      const indirectWarning: AnalysisWarning = {
        code: 'barrel_file',
        message: `Accessed via barrel file: ${chainInfo.chain.join(' -> ')}`,
        severity: 'info'
      };
      
      return this.indirect(
        component,
        {
          importStyle: 'esm',
          usedMembers: chainInfo.exportedNames.length > 0 ? chainInfo.exportedNames : undefined,
          locations: [{
            file: reexportInfo.sourceFile,
            line: 1,
            snippet: `Re-exported through ${chainInfo.chain.length} file(s)`
          }]
        },
        [`Imported indirectly via barrel file (depth: ${chainInfo.depth})`],
        [indirectWarning, ...additionalWarnings]
      );
    }

    // Collect locations and usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    const allMatchedImports = matchingImports.map(m => m.import);
    let usedMembers = extractUsedMembers(allMatchedImports);
    const importStyle = getPrimaryImportStyle(allMatchedImports);

    // For namespace/default imports, track property accesses to determine used members
    const namespaceImports = matchingImports.filter(
      m => (m.import.isNamespaceImport || m.import.isDefaultImport) && m.import.localName
    );
    
    if (namespaceImports.length > 0) {
      const localNames = namespaceImports
        .map(m => m.import.localName)
        .filter((n): n is string => !!n);
      
      // Find property accesses like _.template(), _.merge()
      for (const { source, file } of namespaceImports) {
        const namespaceUsages = findNamespaceUsages(source, localNames, file);
        usedMembers = [...new Set([...usedMembers, ...namespaceUsages])];
      }
    }

    // Call graph analysis: check if imported members are actually called
    const calledMembers = new Set<string>();
    const referencedOnlyMembers = new Set<string>();
    
    for (const { source, file, import: imp } of matchingImports) {
      const callGraph = analyzeCallGraph(source, file);
      const membersToCheck = imp.namedImports.length > 0 
        ? imp.namedImports 
        : usedMembers;
      
      const { called, uncertain } = checkImportedMembersCalled(
        membersToCheck,
        callGraph,
        imp.localName
      );
      
      called.forEach(m => calledMembers.add(m));
      uncertain.forEach(m => referencedOnlyMembers.add(m));
    }

    // Update usedMembers with call graph info
    if (calledMembers.size > 0) {
      usedMembers = [...new Set([...usedMembers, ...calledMembers])];
    }

    // Collect dynamic code warnings (eval, Function, etc.)
    const allDynamicCodeWarnings: import('./callgraph.js').DynamicCodeWarning[] = [];
    for (const { source, file } of matchingImports) {
      const callGraph = analyzeCallGraph(source, file);
      allDynamicCodeWarnings.push(...callGraph.dynamicCodeWarnings);
    }

    // Check for unused imports (imported but never used in code)
    let hasUnusedImport = false;
    const unusedMembers: string[] = [];
    
    for (const { file, import: imp, source } of matchingImports) {
      const usageMap = checkImportUsage(source, imp, file);
      
      for (const [identifier, count] of usageMap) {
        if (count === 0) {
          hasUnusedImport = true;
          // Find the original name for aliased imports
          const originalName = imp.aliases 
            ? [...imp.aliases.entries()].find(([, alias]) => alias === identifier)?.[0] ?? identifier
            : identifier;
          if (!unusedMembers.includes(originalName)) {
            unusedMembers.push(originalName);
          }
        }
      }
    }

    const usage: UsageInfo = {
      importStyle,
      usedMembers: usedMembers.length > 0 ? usedMembers : undefined,
      locations
    };

    // Generate warnings
    const warnings = this.generateWarnings(allMatchedImports, hasUnusedImport, unusedMembers, allDynamicCodeWarnings);

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
  private generateWarnings(
    imports: ImportInfo[],
    hasUnusedImport: boolean = false,
    unusedMembers: string[] = [],
    dynamicCodeWarnings: import('./callgraph.js').DynamicCodeWarning[] = []
  ): AnalysisWarning[] {
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

    // Check for conditional imports (try/catch, if statements)
    const conditionalImports = imports.filter(i => i.isConditional);
    for (const imp of conditionalImports) {
      warnings.push({
        code: 'indirect_usage',
        message: 'Conditional import detected (try/catch or if statement) - may not always execute',
        location: imp.location,
        severity: 'info'
      });
    }

    // Check for unused imports
    if (hasUnusedImport && unusedMembers.length > 0) {
      warnings.push({
        code: 'unused_import',
        message: `Imported but never used: ${unusedMembers.join(', ')}`,
        severity: 'info'
      });
    }

    // Add dynamic code execution warnings
    for (const dcw of dynamicCodeWarnings) {
      const typeMessages: Record<string, string> = {
        'eval': 'eval() detected - arbitrary code execution possible',
        'Function': 'Function constructor detected - arbitrary code execution possible',
        'indirect_eval': 'Indirect eval detected - global scope code execution',
        'setTimeout_string': 'setTimeout with string argument - code execution via string',
        'setInterval_string': 'setInterval with string argument - code execution via string'
      };
      warnings.push({
        code: 'dynamic_code',
        message: typeMessages[dcw.type] || `Dynamic code execution: ${dcw.type}`,
        location: dcw.location,
        severity: 'warning'
      });
    }

    return warnings;
  }

  /**
   * Find all source files
   */
  protected async findSourceFiles(sourceDir: string): Promise<string[]> {
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
