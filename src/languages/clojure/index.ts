/**
 * ReachVet - Clojure Language Adapter
 * 
 * Supports:
 * - deps.edn (Clojure CLI)
 * - project.clj (Leiningen)
 * - ns/require/use/import parsing
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import {
  parseSource,
  findNamespaceUsages,
  getNamespacesForPackage,
  isStandardNamespace,
  type ClojureImportInfo
} from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class ClojureAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'clojure';
  fileExtensions = ['.clj', '.cljs', '.cljc', '.cljx'];

  protected ignorePatterns = [
    '**/target/**',
    '**/.clj-kondo/**',
    '**/.lsp/**',
    '**/.cpcache/**',
    '**/.cljs_node_repl/**',
    '**/out/**',
    '**/node_modules/**',
    '**/resources/**',
    '**/dev/**',
    '**/test/**',
    '**/*_test.clj',
    '**/*_test.cljs',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    return existsSync(join(sourceDir, 'deps.edn')) ||
           existsSync(join(sourceDir, 'project.clj')) ||
           (await glob('**/*.{clj,cljs,cljc}', { cwd: sourceDir, ignore: this.ignorePatterns })).length > 0;
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No Clojure source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: ClojureImportInfo[]; source: string }> = [];
    
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
    allImports: Array<{ file: string; imports: ClojureImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: ClojureImportInfo; source: string }> = [];
    const warnings: AnalysisWarning[] = [];

    // Get expected namespaces for this package
    const expectedNamespaces = getNamespacesForPackage(component.name);

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip standard namespaces
        if (isStandardNamespace(imp.namespaceName)) {
          continue;
        }

        // Check if the import matches any expected namespace
        const matchesNamespace = expectedNamespaces.some(ns => 
          imp.namespaceName === ns ||
          imp.namespaceName.startsWith(ns + '.') ||
          ns.startsWith(imp.namespaceName + '.')
        );

        // Also check if package name is in the namespace
        const pkgParts = component.name.split('/');
        const pkgName = pkgParts[pkgParts.length - 1];
        const matchesPackageName = imp.namespaceName.includes(pkgName.replace(/-/g, '_')) ||
                                    imp.namespaceName.includes(pkgName.replace(/_/g, '-'));

        if (matchesNamespace || matchesPackageName) {
          matchingImports.push({ file, import: imp, source });
        }
      }
    }

    // Not found
    if (matchingImports.length === 0) {
      return this.notReachable(component, ['No matching require/use/import statements found']);
    }

    // Collect usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    
    // Common functions from packages
    const namespaceToFunctions: Record<string, string[]> = {
      'clj-http.client': ['get', 'post', 'put', 'delete', 'request', 'head', 'patch'],
      'ring.adapter.jetty': ['run-jetty'],
      'compojure.core': ['defroutes', 'GET', 'POST', 'PUT', 'DELETE', 'routes', 'context'],
      'cheshire.core': ['generate-string', 'parse-string', 'parse-stream', 'encode', 'decode'],
      'next.jdbc': ['get-datasource', 'execute!', 'execute-one!', 'with-transaction'],
      'next.jdbc.sql': ['query', 'insert!', 'update!', 'delete!', 'find-by-keys'],
      'taoensso.timbre': ['info', 'warn', 'error', 'debug', 'trace', 'spy'],
      'malli.core': ['validate', 'explain', 'schema', 'validator', 'decode', 'encode'],
      'schema.core': ['validate', 'defn', 'def', 'check', 'coercer'],
      'mount.core': ['start', 'stop', 'defstate'],
      'integrant.core': ['init', 'halt!', 'resume', 'suspend!'],
      'hiccup.core': ['html'],
      'hiccup.page': ['html5', 'include-css', 'include-js'],
      'selmer.parser': ['render', 'render-file', 'cache-off!'],
      'buddy.sign.jwt': ['sign', 'unsign', 'encrypt', 'decrypt'],
      'buddy.auth': ['authenticated?', 'throw-unauthorized'],
      'manifold.deferred': ['chain', 'let-flow', 'future', 'timeout!', 'catch'],
      'reitit.core': ['router', 'match-by-path', 'match-by-name'],
      'reitit.ring': ['ring-handler', 'routes', 'create-default-handler'],
      'honey.sql': ['format', 'build'],
      'honey.sql.helpers': ['select', 'from', 'where', 'join', 'insert-into'],
    };

    // Get function names to look for
    const functionNames: string[] = [];
    for (const ns of expectedNamespaces) {
      if (namespaceToFunctions[ns]) {
        functionNames.push(...namespaceToFunctions[ns]);
      }
    }

    // Find function usages
    let usedFunctions: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findNamespaceUsages(source, expectedNamespaces, file);
      usedFunctions.push(...usages.filter(u => u.function).map(u => u.function!));
    }
    usedFunctions = [...new Set(usedFunctions)];

    // Check for :refer :all or (use ...) which imports all
    const hasReferAll = matchingImports.some(m => m.import.referAll);
    if (hasReferAll) {
      warnings.push({
        code: 'refer_all_import',
        message: `Package "${component.name}" is imported with :refer :all or use, making precise function tracking difficult`,
        severity: 'warning'
      });
    }

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

export const clojureAdapter = new ClojureAdapter();
