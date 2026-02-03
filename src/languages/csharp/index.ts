/**
 * ReachVet - C# Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findClassUsages, getNamespacesForPackage, isSystemNamespace, type CSharpImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class CSharpAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'csharp';
  fileExtensions = ['.cs'];

  private ignorePatterns = [
    '**/bin/**',
    '**/obj/**',
    '**/node_modules/**',
    '**/*.Designer.cs',
    '**/*.generated.cs',
    '**/Migrations/**',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    // Check for .csproj, .sln, or packages.config
    const patterns = ['**/*.csproj', '**/*.sln', '**/packages.config'];
    
    for (const pattern of patterns) {
      const files = await glob(pattern, { cwd: sourceDir, nodir: true });
      if (files.length > 0) return true;
    }
    
    return false;
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No C# source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: CSharpImportInfo[]; source: string }> = [];
    
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
    allImports: Array<{ file: string; imports: CSharpImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: CSharpImportInfo; source: string }> = [];
    const warnings: AnalysisWarning[] = [];

    // Get expected namespaces for this package
    const expectedNamespaces = getNamespacesForPackage(component.name);

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip System namespaces unless the package is a System.* package
        if (isSystemNamespace(imp.moduleName) && !component.name.startsWith('System.')) {
          continue;
        }

        // Check if the using statement matches any expected namespace
        const matchesNamespace = expectedNamespaces.some(ns => 
          imp.moduleName === ns || 
          imp.moduleName.startsWith(ns + '.') ||
          ns.startsWith(imp.moduleName + '.')
        );

        if (matchesNamespace) {
          matchingImports.push({ file, import: imp, source });
        }
      }
    }

    // Not found
    if (matchingImports.length === 0) {
      return this.notReachable(component, ['No matching using statements found']);
    }

    // Collect usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    
    // Find class/method usages
    const classNames = expectedNamespaces.map(ns => {
      const parts = ns.split('.');
      return parts[parts.length - 1];
    });

    let usedMethods: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findClassUsages(source, classNames, file);
      usedMethods.push(...usages.filter(u => u.method).map(u => u.method!));
    }
    usedMethods = [...new Set(usedMethods)];

    const usage: UsageInfo = {
      importStyle: 'esm', // C# using is similar to ESM imports
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
          [`Vulnerable method(s) called: ${affectedUsed.join(', ')}`],
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

export const csharpAdapter = new CSharpAdapter();
