/**
 * ReachVet - Dart/Flutter Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findClassUsages, getClassesForPackage, isSdkPackage, type DartImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class DartAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'dart';
  fileExtensions = ['.dart'];

  protected ignorePatterns = [
    '**/.dart_tool/**',
    '**/build/**',
    '**/*.g.dart',
    '**/*.freezed.dart',
    '**/*.mocks.dart',
    '**/*_test.dart',
    '**/test/**',
    '**/integration_test/**',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    return existsSync(join(sourceDir, 'pubspec.yaml')) ||
           existsSync(join(sourceDir, 'pubspec.lock'));
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No Dart source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: DartImportInfo[]; source: string }> = [];
    
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
    allImports: Array<{ file: string; imports: DartImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: DartImportInfo; source: string }> = [];
    const warnings: AnalysisWarning[] = [];

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip SDK packages
        if (isSdkPackage(`dart:${imp.packageName}`)) {
          continue;
        }

        // Check if the import matches the component
        if (imp.packageName === component.name) {
          matchingImports.push({ file, import: imp, source });

          // Add warning for deferred imports
          if (imp.isDeferred) {
            warnings.push({
              code: 'dynamic_import',
              message: `Deferred import - may not be loaded at runtime`,
              location: imp.location,
              severity: 'info'
            });
          }
        }
      }
    }

    // Not found
    if (matchingImports.length === 0) {
      return this.notReachable(component, ['No matching import statements found']);
    }

    // Collect usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    
    // Get common classes for this package
    const classNames = getClassesForPackage(component.name);

    // Also add show-filtered classes
    for (const m of matchingImports) {
      if (m.import.show) {
        classNames.push(...m.import.show);
      }
    }

    // Find class/method usages
    let usedMethods: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findClassUsages(source, [...new Set(classNames)], file);
      usedMethods.push(...usages.filter(u => u.method).map(u => u.method!));
    }
    usedMethods = [...new Set(usedMethods)];

    const usage: UsageInfo = {
      importStyle: 'esm',
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

export const dartAdapter = new DartAdapter();
