/**
 * ReachVet - Swift Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findTypeUsages, getModulesForPackage, isAppleFramework, type SwiftImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class SwiftAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'swift';
  fileExtensions = ['.swift'];

  private ignorePatterns = [
    '**/Pods/**',
    '**/Carthage/**',
    '**/.build/**',
    '**/DerivedData/**',
    '**/*.generated.swift',
    '**/Package.swift',
    '**/*Tests.swift',
    '**/*Spec.swift',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    // Check for Swift package/project files
    return existsSync(join(sourceDir, 'Package.swift')) ||
           existsSync(join(sourceDir, 'Podfile')) ||
           existsSync(join(sourceDir, 'Cartfile')) ||
           (await glob('*.xcodeproj', { cwd: sourceDir })).length > 0 ||
           (await glob('*.xcworkspace', { cwd: sourceDir })).length > 0;
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No Swift source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: SwiftImportInfo[]; source: string }> = [];
    
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
    allImports: Array<{ file: string; imports: SwiftImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: SwiftImportInfo; source: string }> = [];
    const warnings: AnalysisWarning[] = [];

    // Get expected module names for this package
    const expectedModules = getModulesForPackage(component.name);

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip Apple frameworks
        if (isAppleFramework(imp.moduleName)) {
          continue;
        }

        // Check if the import matches any expected module
        const matchesModule = expectedModules.some(mod => 
          imp.moduleName === mod || 
          imp.moduleName.toLowerCase() === mod.toLowerCase()
        );

        if (matchesModule) {
          matchingImports.push({ file, import: imp, source });
          
          // Add warning for @testable imports
          if (imp.isTestable) {
            warnings.push({
              code: 'dynamic_import',
              message: `@testable import found - may indicate test-only usage`,
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
    
    // Common types from packages
    const moduleToTypes: Record<string, string[]> = {
      'Alamofire': ['AF', 'Session', 'Request', 'DataRequest', 'DownloadRequest', 'UploadRequest'],
      'SwiftyJSON': ['JSON'],
      'SnapKit': ['ConstraintMaker', 'Constraint'],
      'Kingfisher': ['KingfisherManager', 'ImageCache', 'ImageDownloader'],
      'RxSwift': ['Observable', 'Single', 'Completable', 'Maybe', 'Subject', 'BehaviorRelay', 'PublishRelay', 'Disposable', 'DisposeBag'],
      'RealmSwift': ['Realm', 'Object', 'Results', 'List'],
      'ComposableArchitecture': ['Store', 'Reducer', 'Effect', 'ViewStore'],
      'Swinject': ['Container', 'Resolver', 'Assembly'],
      'Firebase': ['Analytics', 'Auth', 'Firestore', 'Storage'],
      'Serilog': ['Log'],
    };

    // Get type names to look for
    const typeNames: string[] = [];
    for (const mod of expectedModules) {
      if (moduleToTypes[mod]) {
        typeNames.push(...moduleToTypes[mod]);
      }
    }
    // Also add module name itself as it might be used as a namespace
    typeNames.push(...expectedModules);

    // Find type/method usages
    let usedMethods: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findTypeUsages(source, [...new Set(typeNames)], file);
      usedMethods.push(...usages.filter(u => u.method).map(u => u.method!));
    }
    usedMethods = [...new Set(usedMethods)];

    const usage: UsageInfo = {
      importStyle: 'esm', // Swift imports are similar to ESM
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

export const swiftAdapter = new SwiftAdapter();
