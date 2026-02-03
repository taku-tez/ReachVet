/**
 * ReachVet - Perl Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findModuleUsages, getModulesForDist, isCoreModule, type PerlImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class PerlAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'perl';
  fileExtensions = ['.pl', '.pm', '.t'];

  private ignorePatterns = [
    '**/blib/**',
    '**/local/**',
    '**/.build/**',
    '**/t/**',
    '**/xt/**',
    '**/inc/**',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    return existsSync(join(sourceDir, 'cpanfile')) ||
           existsSync(join(sourceDir, 'META.json')) ||
           existsSync(join(sourceDir, 'META.yml')) ||
           existsSync(join(sourceDir, 'Makefile.PL')) ||
           existsSync(join(sourceDir, 'Build.PL'));
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No Perl source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: PerlImportInfo[]; source: string }> = [];
    
    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const imports = parseSource(content, file);
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

  private analyzeComponent(
    component: Component,
    allImports: Array<{ file: string; imports: PerlImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: PerlImportInfo; source: string }> = [];
    const warnings: AnalysisWarning[] = [];

    // Get expected modules for this distribution
    const expectedModules = getModulesForDist(component.name);

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip core modules
        if (isCoreModule(imp.moduleName)) {
          continue;
        }

        // Check if the import matches any expected module
        const matchesModule = expectedModules.some(mod => 
          imp.moduleName === mod ||
          imp.moduleName.startsWith(mod + '::')
        );

        if (matchesModule) {
          matchingImports.push({ file, import: imp, source });
        }
      }
    }

    // Not found
    if (matchingImports.length === 0) {
      return this.notReachable(component, ['No matching use/require statements found']);
    }

    // Collect usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    
    // Collect imported symbols
    const importedSymbols: string[] = [];
    for (const m of matchingImports) {
      if (m.import.imports) {
        importedSymbols.push(...m.import.imports);
      }
    }

    // Find method usages
    let usedMethods: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findModuleUsages(source, expectedModules, file);
      usedMethods.push(...usages.filter(u => u.method).map(u => u.method!));
    }
    usedMethods = [...new Set([...usedMethods, ...importedSymbols])];

    const usage: UsageInfo = {
      importStyle: 'require', // Perl uses require/use
      usedMembers: usedMethods.length > 0 ? usedMethods : undefined,
      locations
    };

    // Check vulnerable functions
    const vulnFunctions = component.vulnerabilities?.flatMap(v => v.affectedFunctions ?? []) ?? [];
    
    if (vulnFunctions.length > 0 && usedMethods.length > 0) {
      const affectedUsed = vulnFunctions.filter(f => usedMethods.includes(f));
      
      if (affectedUsed.length > 0) {
        return this.reachable(
          component,
          { ...usage, usedMembers: affectedUsed },
          'high',
          [`Vulnerable function(s) used: ${affectedUsed.join(', ')}`],
          warnings
        );
      }
    }

    return this.reachable(
      component,
      usage,
      'high',
      [`Used in ${locations.length} location(s)`],
      warnings
    );
  }

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

export const perlAdapter = new PerlAdapter();
