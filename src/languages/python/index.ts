/**
 * ReachVet - Python Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parsePythonSource, findModuleUsages, detectDynamicImports, type PythonImportInfo } from './parser.js';
import { matchesComponent, extractUsedMembers, getPrimaryImportStyle, detectDangerousPatterns } from './detector.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class PythonAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'python';
  fileExtensions = ['.py', '.pyw'];

  protected ignorePatterns = [
    '**/venv/**',
    '**/.venv/**',
    '**/env/**',
    '**/.env/**',
    '**/site-packages/**',
    '**/dist-packages/**',
    '**/__pycache__/**',
    '**/*.pyc',
    '**/.git/**',
    '**/build/**',
    '**/dist/**',
    '**/.tox/**',
    '**/.nox/**',
    '**/.pytest_cache/**',
    '**/.mypy_cache/**',
  ];

  /**
   * Check if this adapter can handle the directory
   */
  async canHandle(sourceDir: string): Promise<boolean> {
    // Check for Python project indicators
    const indicators = [
      'requirements.txt',
      'setup.py',
      'setup.cfg',
      'pyproject.toml',
      'Pipfile',
      'poetry.lock',
      'environment.yml',
      'conda.yaml'
    ];

    for (const indicator of indicators) {
      if (existsSync(join(sourceDir, indicator))) {
        return true;
      }
    }

    // Check for any .py files
    const pyFiles = await glob('**/*.py', {
      cwd: sourceDir,
      ignore: this.ignorePatterns,
      nodir: true,
      maxDepth: 3
    });

    return pyFiles.length > 0;
  }

  /**
   * Analyze components for reachability
   */
  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    // Find all Python files
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No Python source files found']));
    }

    // Parse all files and collect imports
    const allImports: Array<{ file: string; imports: PythonImportInfo[]; source: string }> = [];
    
    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const imports = parsePythonSource(content, file);
        if (imports.length > 0) {
          allImports.push({ file, imports, source: content });
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
    allImports: Array<{ file: string; imports: PythonImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: PythonImportInfo; source: string }> = [];

    // Find all imports that match this component
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        if (matchesComponent(imp, component)) {
          matchingImports.push({ file, import: imp, source });
        }
      }
    }

    if (matchingImports.length === 0) {
      return this.notReachable(component, ['Not imported in any source file']);
    }

    // Collect locations and usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    const allMatchedImports = matchingImports.map(m => m.import);
    let usedMembers = extractUsedMembers(allMatchedImports);
    const importStyle = getPrimaryImportStyle(allMatchedImports);

    // For module-level imports, track attribute accesses
    const moduleImports = matchingImports.filter(
      m => m.import.importStyle === 'import' && !m.import.members
    );
    
    if (moduleImports.length > 0) {
      for (const { source, import: imp } of moduleImports) {
        const moduleName = imp.submodule 
          ? `${imp.module}.${imp.submodule}` 
          : imp.module;
        const moduleUsages = findModuleUsages(source, moduleName, imp.alias);
        usedMembers = [...new Set([...usedMembers, ...moduleUsages])];
      }
    }

    const usage: UsageInfo = {
      importStyle: importStyle === 'from' ? 'esm' : 'commonjs', // Map to JS-style for consistency
      usedMembers: usedMembers.length > 0 ? usedMembers : undefined,
      locations
    };

    // Generate warnings
    const warnings = this.generateWarnings(allMatchedImports);
    
    // Add dangerous pattern warnings
    const dangerousPatterns = detectDangerousPatterns(allMatchedImports);
    for (const pattern of dangerousPatterns) {
      warnings.push({
        code: 'star_import',
        message: pattern,
        severity: 'warning'
      });
    }

    // Add dynamic import warnings
    for (const { source, file } of matchingImports) {
      const dynamicWarnings = detectDynamicImports(source, file);
      for (const dw of dynamicWarnings) {
        const typeMessages: Record<string, string> = {
          '__import__': `__import__() detected${dw.module ? ` for module: ${dw.module}` : ''} - dynamic import`,
          'importlib': `importlib.import_module() detected${dw.module ? ` for module: ${dw.module}` : ''} - dynamic import`,
          'exec': 'exec() with import detected - dynamic code execution'
        };
        warnings.push({
          code: 'dynamic_import',
          message: typeMessages[dw.type] || `Dynamic import: ${dw.type}`,
          location: dw.location,
          severity: 'warning'
        });
      }
    }

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
          [`Vulnerable function(s) explicitly used: ${affectedUsed.join(', ')}`],
          warnings
        );
      }

      // Star import - can't be sure
      const hasStarImport = allMatchedImports.some(i => i.isStarImport);
      if (hasStarImport) {
        return this.reachable(
          component,
          usage,
          'medium',
          [`Star import detected - vulnerable functions (${vulnFunctions.join(', ')}) may be accessible`],
          warnings
        );
      }

      // Module-level import without explicit member usage
      const hasModuleImport = allMatchedImports.some(i => i.importStyle === 'import');
      if (hasModuleImport && usedMembers.length === 0) {
        return this.reachable(
          component,
          usage,
          'medium',
          [`Module imported but specific function usage not detected - check for ${vulnFunctions.join(', ')}`],
          warnings
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
  private generateWarnings(imports: PythonImportInfo[]): AnalysisWarning[] {
    const warnings: AnalysisWarning[] = [];

    // Check for conditional imports (try/except, if statements)
    const conditionalImports = imports.filter(i => i.isConditional);
    for (const imp of conditionalImports) {
      warnings.push({
        code: 'indirect_usage',
        message: 'Conditional import detected (try/except or if statement) - may not always execute',
        location: imp.location,
        severity: 'info'
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
export const pythonAdapter = new PythonAdapter();

// Re-export types and utilities
export * from './parser.js';
export * from './detector.js';
