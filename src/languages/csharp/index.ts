/**
 * ReachVet - C#/.NET Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findClassUsages, getNamespacesForPackage, isSystemNamespace, type CSharpImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class CSharpAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'csharp';
  fileExtensions = ['.cs'];

  protected ignorePatterns = [
    '**/bin/**',
    '**/obj/**',
    '**/node_modules/**',
    '**/.vs/**',
    '**/packages/**',
    '**/*.Designer.cs',
    '**/*.g.cs',
    '**/*.generated.cs',
    '**/Migrations/**',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    // Check for .csproj files or .sln files
    const hasCsproj = await glob('**/*.csproj', { cwd: sourceDir, ignore: this.ignorePatterns });
    const hasSln = await glob('*.sln', { cwd: sourceDir });
    return hasCsproj.length > 0 || hasSln.length > 0 || existsSync(join(sourceDir, 'packages.config'));
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

    // Get expected namespaces for this NuGet package
    const expectedNamespaces = getNamespacesForPackage(component.name);
    
    // Also try direct namespace matching from package name
    // e.g., "Newtonsoft.Json" -> "Newtonsoft.Json"
    // e.g., "Microsoft.Extensions.Logging" -> "Microsoft.Extensions.Logging"
    const allNamespaces = [...new Set([...expectedNamespaces, component.name])];

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip system namespaces (they're part of BCL, not external packages)
        if (isSystemNamespace(imp.moduleName)) {
          continue;
        }

        // Check if the using statement matches any expected namespace
        const matchesNamespace = allNamespaces.some(ns => {
          return imp.moduleName === ns || 
                 imp.moduleName.startsWith(ns + '.') ||
                 ns.startsWith(imp.moduleName + '.');
        });

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
    
    // Extract class names from usings for usage detection
    const classNames: string[] = [];
    for (const m of matchingImports) {
      const parts = m.import.moduleName.split('.');
      // Take the last part as potential class name
      const lastName = parts[parts.length - 1];
      if (lastName && lastName !== '*') {
        classNames.push(lastName);
      }
      // For static imports, the last part is definitely a class
      if (m.import.importStyle === 'using_static') {
        classNames.push(lastName);
      }
      // For aliases, track the alias name too
      if (m.import.alias) {
        classNames.push(m.import.alias);
      }
    }

    // Common class names from namespaces
    const namespaceToClasses: Record<string, string[]> = {
      'Newtonsoft.Json': ['JsonConvert', 'JsonSerializer', 'JObject', 'JArray', 'JToken'],
      'System.Text.Json': ['JsonSerializer', 'JsonDocument', 'JsonElement'],
      'Microsoft.Extensions.Logging': ['ILogger', 'ILoggerFactory', 'LoggerFactory'],
      'Microsoft.EntityFrameworkCore': ['DbContext', 'DbSet', 'EntityTypeBuilder'],
      'AutoMapper': ['IMapper', 'Mapper', 'Profile'],
      'Serilog': ['Log', 'ILogger', 'LoggerConfiguration'],
      'Dapper': ['SqlMapper', 'DynamicParameters'],
      'RestSharp': ['RestClient', 'RestRequest', 'RestResponse'],
      'Polly': ['Policy', 'PolicyBuilder'],
      'MediatR': ['IMediator', 'IRequest', 'IRequestHandler'],
    };

    for (const ns of allNamespaces) {
      if (namespaceToClasses[ns]) {
        classNames.push(...namespaceToClasses[ns]);
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

export const csharpAdapter = new CSharpAdapter();
