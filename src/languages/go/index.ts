/**
 * ReachVet - Go Language Adapter
 * Provides Go language support for vulnerability reachability analysis
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { BaseLanguageAdapter } from '../base.js';
import {
  parseGoSource,
  parseGoMod,
  findPackageUsages,
  extractModuleName,
  isStandardLibrary,
  type GoImportInfo,
} from './parser.js';
import type {
  Component,
  ComponentResult,
  AnalysisWarning,
  CodeLocation,
} from '../../types.js';

export * from './parser.js';

/**
 * Go Language Adapter for ReachVet
 */
export class GoLanguageAdapter extends BaseLanguageAdapter {
  readonly language = 'go' as const;
  readonly fileExtensions = ['.go'];

  /**
   * Analyze components in a Go project
   */
  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const results: ComponentResult[] = [];

    // Parse go.mod if exists
    let goModDeps: Map<string, string> | null = null;
    try {
      const goModPath = join(sourceDir, 'go.mod');
      const content = await fs.readFile(goModPath, 'utf-8');
      const goMod = parseGoMod(content);
      goModDeps = new Map(goMod.dependencies.map(d => [d.module, d.version]));
    } catch {
      // No go.mod found
    }

    // Scan Go files and collect imports
    const goFiles = await this.scanGoFiles(sourceDir);
    const fileImports = new Map<string, { imports: GoImportInfo[], content: string }>();

    for (const filePath of goFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const relPath = filePath.startsWith(sourceDir)
          ? filePath.slice(sourceDir.length + 1)
          : filePath;
        const imports = parseGoSource(content, relPath);
        fileImports.set(relPath, { imports, content });
      } catch {
        // Skip unreadable files
      }
    }

    // Analyze each component
    for (const component of components) {
      const result = await this.analyzeComponent(
        component,
        fileImports,
        goModDeps
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Analyze a single component for reachability
   */
  private async analyzeComponent(
    component: Component,
    fileImports: Map<string, { imports: GoImportInfo[], content: string }>,
    goModDeps: Map<string, string> | null
  ): Promise<ComponentResult> {
    const warnings: AnalysisWarning[] = [];
    const packageName = component.name; // e.g., "github.com/gin-gonic/gin"
    
    // Check if this component is even in go.mod
    if (goModDeps && !goModDeps.has(packageName)) {
      // Check for partial match (subpackage)
      const hasMatch = [...goModDeps.keys()].some(
        dep => packageName.startsWith(dep) || dep.startsWith(packageName)
      );
      if (!hasMatch) {
        return this.notReachable(component, ['Not found in go.mod dependencies']);
      }
    }

    // Look for imports of this package
    let foundImport = false;
    let hasUsage = false;
    let usageLocation: CodeLocation | undefined;

    for (const [file, { imports, content }] of fileImports) {
      for (const imp of imports) {
        // Skip standard library
        if (isStandardLibrary(imp.path)) continue;

        const moduleName = extractModuleName(imp.path);
        
        // Check if this import matches our component
        if (moduleName === packageName || 
            imp.path === packageName ||
            moduleName.startsWith(packageName + '/') ||
            packageName.startsWith(moduleName + '/')) {
          foundImport = true;

          // Blank import - side effects only
          if (imp.isBlankImport) {
            warnings.push({
              code: 'blank_import',
              message: `Blank import (for side effects): ${imp.path}`,
              location: imp.location,
              severity: 'info',
            });
            continue;
          }

          // Dot import - all exports available
          if (imp.isDotImport) {
            warnings.push({
              code: 'dot_import',
              message: `Dot import found - all exported symbols are available in namespace`,
              location: imp.location,
              severity: 'warning',
            });
            // For dot imports, assume usage (we can't easily track)
            hasUsage = true;
            usageLocation = imp.location;
            continue;
          }

          // Check for actual usage
          const nameToFind = imp.alias || imp.packageName;
          const usages = findPackageUsages(content, nameToFind);
          
          if (usages.length > 0) {
            hasUsage = true;
            // Find first usage location
            usageLocation = this.findUsageLocation(content, nameToFind, usages[0], file);
            break;
          }
        }
      }
      
      if (hasUsage) break;
    }

    // Build result
    if (!foundImport) {
      return this.notReachable(component, ['No imports found for this package']);
    }

    if (hasUsage && usageLocation) {
      return this.reachable(
        component,
        {
          importStyle: 'esm' as const, // Go uses import statements similar to ESM
          locations: [usageLocation],
        },
        'high',
        undefined,
        warnings.length > 0 ? warnings : undefined
      );
    }

    // Imported but no direct usage detected
    return this.imported(
      component,
      undefined,
      ['Package is imported but no direct usage detected'],
      warnings.length > 0 ? warnings : undefined
    );
  }

  /**
   * Find the location of a function usage in source
   */
  private findUsageLocation(
    content: string,
    packageName: string,
    funcName: string,
    file: string
  ): CodeLocation | undefined {
    const lines = content.split('\n');
    const pattern = new RegExp(`\\b${packageName}\\.${funcName}\\b`);

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        return {
          file,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 100),
        };
      }
    }

    return undefined;
  }

  /**
   * Check if this adapter can handle the given directory
   */
  async canHandle(sourceDir: string): Promise<boolean> {
    // Check for go.mod
    try {
      await fs.access(join(sourceDir, 'go.mod'));
      return true;
    } catch {
      // Fall through
    }

    // Check for any .go files
    try {
      const entries = await fs.readdir(sourceDir);
      return entries.some(e => e.endsWith('.go'));
    } catch {
      return false;
    }
  }

  /**
   * Recursively scan for Go files
   */
  private async scanGoFiles(
    dir: string,
    maxDepth = 10,
    currentDepth = 0
  ): Promise<string[]> {
    if (currentDepth > maxDepth) return [];

    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        // Skip hidden directories and common non-source dirs
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'vendor') continue;
        if (entry.name === 'node_modules') continue;
        if (entry.name === 'testdata') continue;

        if (entry.isDirectory()) {
          const subFiles = await this.scanGoFiles(fullPath, maxDepth, currentDepth + 1);
          files.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.go')) {
          // Skip test files
          if (!entry.name.endsWith('_test.go')) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Directory not readable
    }

    return files;
  }
}

/**
 * Parse go.mod file content
 */
export { parseGoMod as parseGoModFile } from './parser.js';

/**
 * Create a Go language adapter instance
 */
export function createGoAdapter(): GoLanguageAdapter {
  return new GoLanguageAdapter();
}

// Default adapter instance
export const goAdapter = new GoLanguageAdapter();
