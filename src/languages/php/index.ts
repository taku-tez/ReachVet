/**
 * ReachVet - PHP Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findClassUsages, getNamespacesForPackage, type PhpImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class PhpAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'php';
  fileExtensions = ['.php', '.phtml', '.php5', '.php7', '.phps'];

  protected ignorePatterns = [
    '**/vendor/**',
    '**/node_modules/**',
    '**/cache/**',
    '**/storage/**',
    '**/tests/**',
    '**/*.blade.php',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    return existsSync(join(sourceDir, 'composer.json')) || 
           existsSync(join(sourceDir, 'composer.lock'));
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No PHP source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: PhpImportInfo[]; source: string }> = [];
    
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
    allImports: Array<{ file: string; imports: PhpImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: PhpImportInfo; source: string }> = [];
    const warnings: AnalysisWarning[] = [];

    // Get expected namespaces for this package
    const expectedNamespaces = getNamespacesForPackage(component.name);
    
    // Also check for direct namespace matching from package name
    // e.g., "guzzlehttp/guzzle" -> "GuzzleHttp"
    const [vendor, pkg] = component.name.split('/');
    const inferredNamespaces: string[] = [];
    if (vendor && pkg) {
      // Try common patterns
      inferredNamespaces.push(
        vendor.charAt(0).toUpperCase() + vendor.slice(1),
        pkg.charAt(0).toUpperCase() + pkg.slice(1),
        (vendor + pkg).split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
      );
    }

    const allNamespaces = [...new Set([...expectedNamespaces, ...inferredNamespaces])];

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip require/include of local files
        if (['require', 'require_once', 'include', 'include_once'].includes(imp.importStyle)) {
          continue;
        }

        // Check if the use statement matches any expected namespace
        const moduleParts = imp.moduleName.split('\\');
        const matchesNamespace = allNamespaces.some(ns => {
          const nsParts = ns.split('\\');
          return moduleParts[0] === nsParts[0] || imp.moduleName.startsWith(ns);
        });

        if (matchesNamespace) {
          matchingImports.push({ file, import: imp, source });
        }

        // Check grouped imports
        if (imp.groupedNames) {
          const baseMatches = allNamespaces.some(ns => imp.moduleName.startsWith(ns.split('\\')[0]));
          if (baseMatches) {
            matchingImports.push({ file, import: imp, source });
          }
        }
      }
    }

    // Not found
    if (matchingImports.length === 0) {
      return this.notReachable(component, ['No matching use statements found']);
    }

    // Collect usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    
    // Find class/method usages
    const classNames = matchingImports.map(m => {
      const parts = m.import.moduleName.split('\\');
      return parts[parts.length - 1];
    });

    let usedMethods: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findClassUsages(source, classNames, file);
      usedMethods.push(...usages.filter(u => u.method).map(u => u.method!));
    }
    usedMethods = [...new Set(usedMethods)];

    const usage: UsageInfo = {
      importStyle: 'esm', // PHP use is similar to ESM imports
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

export const phpAdapter = new PhpAdapter();
