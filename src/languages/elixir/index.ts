/**
 * ReachVet - Elixir Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findModuleUsages, getModulesForPackage, isStandardModule, type ElixirImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class ElixirAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'elixir';
  fileExtensions = ['.ex', '.exs'];

  protected ignorePatterns = [
    '**/_build/**',
    '**/deps/**',
    '**/.elixir_ls/**',
    '**/*_test.exs',
    '**/test/**',
    '**/priv/**',
    '**/mix.exs',
    '**/mix.lock',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    return existsSync(join(sourceDir, 'mix.exs')) ||
           (await glob('**/*.ex', { cwd: sourceDir, ignore: this.ignorePatterns })).length > 0;
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No Elixir source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: ElixirImportInfo[]; source: string }> = [];
    
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
    allImports: Array<{ file: string; imports: ElixirImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: ElixirImportInfo; source: string }> = [];
    const warnings: AnalysisWarning[] = [];

    // Get expected modules for this package
    const expectedModules = getModulesForPackage(component.name);

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip standard modules
        if (isStandardModule(imp.moduleName)) {
          continue;
        }

        // Check if the import matches any expected module
        const matchesModule = expectedModules.some(mod => 
          imp.moduleName === mod ||
          imp.moduleName.startsWith(mod + '.') ||
          mod.startsWith(imp.moduleName + '.')
        );

        if (matchesModule) {
          matchingImports.push({ file, import: imp, source });
        }
      }
    }

    // Not found
    if (matchingImports.length === 0) {
      return this.notReachable(component, ['No matching import/alias/use statements found']);
    }

    // Collect usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    
    // Common functions from packages
    const moduleToFunctions: Record<string, string[]> = {
      'Phoenix.Controller': ['render', 'redirect', 'json', 'put_flash'],
      'Phoenix.LiveView': ['mount', 'handle_event', 'handle_info', 'assign'],
      'Ecto.Changeset': ['cast', 'validate_required', 'validate_format', 'put_change'],
      'Ecto.Query': ['from', 'where', 'select', 'join', 'preload'],
      'Jason': ['encode', 'decode', 'encode!', 'decode!'],
      'HTTPoison': ['get', 'post', 'put', 'delete', 'request'],
      'Tesla': ['get', 'post', 'put', 'delete', 'build_adapter'],
      'Guardian': ['encode_and_sign', 'decode_and_verify', 'resource_from_claims'],
      'Oban': ['insert', 'insert!', 'drain_queue'],
      'Timex': ['now', 'parse', 'format', 'diff', 'shift'],
    };

    // Get function names to look for
    const functionNames: string[] = [];
    for (const mod of expectedModules) {
      if (moduleToFunctions[mod]) {
        functionNames.push(...moduleToFunctions[mod]);
      }
    }

    // Find function usages
    let usedFunctions: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findModuleUsages(source, expectedModules, file);
      usedFunctions.push(...usages.filter(u => u.function).map(u => u.function!));
    }
    usedFunctions = [...new Set(usedFunctions)];

    const usage: UsageInfo = {
      importStyle: 'esm',
      usedMembers: usedFunctions.length > 0 ? usedFunctions : undefined,
      locations
    };

    // Check vulnerable functions
    const vulnFunctions = component.vulnerabilities?.flatMap(v => v.affectedFunctions ?? []) ?? [];
    
    if (vulnFunctions.length > 0 && usedFunctions.length > 0) {
      const affectedUsed = vulnFunctions.filter(f => usedFunctions.includes(f));
      
      if (affectedUsed.length > 0) {
        return this.reachable(
          component,
          { ...usage, usedMembers: affectedUsed },
          'high',
          [`Vulnerable function(s) called: ${affectedUsed.join(', ')}`],
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

export const elixirAdapter = new ElixirAdapter();
