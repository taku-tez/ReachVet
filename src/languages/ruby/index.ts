/**
 * ReachVet - Ruby Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findModuleUsages, getModulesForGem, type RubyImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class RubyAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'ruby';
  fileExtensions = ['.rb', '.rake', '.gemspec', '.ru'];

  protected ignorePatterns = [
    '**/vendor/**',
    '**/bundle/**',
    '**/.bundle/**',
    '**/node_modules/**',
    '**/tmp/**',
    '**/log/**',
    '**/coverage/**',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    return existsSync(join(sourceDir, 'Gemfile')) || 
           existsSync(join(sourceDir, 'Gemfile.lock')) ||
           existsSync(join(sourceDir, '*.gemspec'));
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No Ruby source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: RubyImportInfo[]; source: string }> = [];
    
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
    allImports: Array<{ file: string; imports: RubyImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: RubyImportInfo; source: string }> = [];
    const warnings: AnalysisWarning[] = [];

    // Normalize gem name variants
    const gemVariants = [
      component.name,
      component.name.replace(/-/g, '_'),
      component.name.replace(/_/g, '-'),
    ];

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip require_relative (local files)
        if (imp.importStyle === 'require_relative') continue;

        // Match gem name
        const reqName = imp.moduleName.split('/')[0].toLowerCase().replace(/-/g, '_');
        if (gemVariants.some(v => v.toLowerCase().replace(/-/g, '_') === reqName)) {
          matchingImports.push({ file, import: imp, source });
        }

        // Bundler.require means all gems are potentially loaded
        if (imp.importStyle === 'bundler') {
          warnings.push({
            code: 'dynamic_import',
            message: 'Bundler.require detected - all gems in Gemfile may be loaded',
            location: imp.location,
            severity: 'warning'
          });
        }
      }
    }

    // Not found
    if (matchingImports.length === 0) {
      // Check if there's a Bundler.require (implicit load)
      const hasBundlerRequire = allImports.some(({ imports }) => 
        imports.some(i => i.importStyle === 'bundler')
      );
      
      if (hasBundlerRequire) {
        return this.imported(
          component,
          { importStyle: 'require', locations: [] },
          ['May be loaded via Bundler.require (implicit)'],
          warnings
        );
      }
      
      return this.notReachable(component, ['Not required in any source file']);
    }

    // Collect usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    const moduleNames = getModulesForGem(component.name);

    // Find module usages to determine which methods are called
    let usedMethods: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findModuleUsages(source, moduleNames, file);
      usedMethods.push(...usages.filter(u => u.method).map(u => u.method!));
    }
    usedMethods = [...new Set(usedMethods)];

    const usage: UsageInfo = {
      importStyle: 'require',
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
      [`Required in ${locations.length} location(s)`],
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

export const rubyAdapter = new RubyAdapter();
