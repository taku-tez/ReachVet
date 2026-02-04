/**
 * ReachVet - Haskell Language Adapter
 * Provides Haskell language support for vulnerability reachability analysis
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import { BaseLanguageAdapter } from '../base.js';
import {
  parseHaskellSource,
  parseCabalFile,
  parseStackYaml,
  findUsages,
  moduleToPackages,
  HACKAGE_PACKAGE_TO_MODULES,
  type HaskellImportInfo,
  type CabalDependency,
} from './parser.js';
import type {
  Component,
  ComponentResult,
  AnalysisWarning,
  CodeLocation,
} from '../../types.js';

export * from './parser.js';

/**
 * Haskell Language Adapter for ReachVet
 */
export class HaskellLanguageAdapter extends BaseLanguageAdapter {
  readonly language = 'haskell' as const;
  readonly fileExtensions = ['.hs', '.lhs'];

  /**
   * Check if this adapter can handle the given source directory
   */
  async canHandle(sourceDir: string): Promise<boolean> {
    try {
      // Check for cabal file
      const cabalFiles = await glob('*.cabal', { cwd: sourceDir });
      if (cabalFiles.length > 0) return true;
      
      // Check for stack.yaml
      const stackPath = join(sourceDir, 'stack.yaml');
      try {
        await fs.access(stackPath);
        return true;
      } catch {
        // No stack.yaml
      }
      
      // Check for .hs files
      const hsFiles = await glob('**/*.hs', { 
        cwd: sourceDir, 
        ignore: this.ignorePatterns,
        nodir: true
      });
      
      return hsFiles.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Analyze components in a Haskell project
   */
  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const results: ComponentResult[] = [];

    // Parse .cabal file if exists
    let cabalDeps: Map<string, CabalDependency> | null = null;
    try {
      const cabalFiles = await glob('*.cabal', { cwd: sourceDir });
      if (cabalFiles.length > 0) {
        const content = await fs.readFile(join(sourceDir, cabalFiles[0]), 'utf-8');
        const cabal = parseCabalFile(content);
        cabalDeps = new Map(cabal.dependencies.map(d => [d.name, d]));
      }
    } catch {
      // No cabal file found
    }

    // Parse stack.yaml if exists (merge with cabal deps)
    try {
      const stackPath = join(sourceDir, 'stack.yaml');
      const content = await fs.readFile(stackPath, 'utf-8');
      const stack = parseStackYaml(content);
      if (stack.extraDeps.length > 0) {
        if (!cabalDeps) cabalDeps = new Map();
        for (const dep of stack.extraDeps) {
          if (!cabalDeps.has(dep.name)) {
            cabalDeps.set(dep.name, dep);
          }
        }
      }
    } catch {
      // No stack.yaml found
    }

    // Scan Haskell files and collect imports
    const hsFiles = await this.scanHaskellFiles(sourceDir);
    const fileImports = new Map<string, { imports: HaskellImportInfo[], content: string }>();

    for (const filePath of hsFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const relPath = filePath.startsWith(sourceDir)
          ? filePath.slice(sourceDir.length + 1)
          : filePath;
        const imports = parseHaskellSource(content, relPath);
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
        cabalDeps
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Scan for Haskell source files
   */
  private async scanHaskellFiles(sourceDir: string): Promise<string[]> {
    const patterns = this.fileExtensions.map(ext => `**/*${ext}`);
    const files: string[] = [];
    
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: sourceDir,
        ignore: [...this.ignorePatterns, '**/dist/**', '**/dist-newstyle/**', '**/.stack-work/**'],
        absolute: true,
        nodir: true
      });
      files.push(...matches);
    }
    
    return files;
  }

  /**
   * Analyze a single component for reachability
   */
  private async analyzeComponent(
    component: Component,
    fileImports: Map<string, { imports: HaskellImportInfo[], content: string }>,
    cabalDeps: Map<string, CabalDependency> | null
  ): Promise<ComponentResult> {
    const warnings: AnalysisWarning[] = [];
    const packageName = component.name;
    
    // Check if this component is in cabal dependencies
    if (cabalDeps && !cabalDeps.has(packageName)) {
      return this.notReachable(component, ['Not found in .cabal dependencies']);
    }

    // Get modules that this package provides
    const packageModules = HACKAGE_PACKAGE_TO_MODULES[packageName] || [];
    
    // Also check for direct module name match
    const possibleModules = new Set<string>(packageModules);
    
    // Some packages use their name as module prefix (e.g., 'yaml' -> Data.Yaml)
    // Add common patterns
    const camelCase = packageName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const titleCase = camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
    possibleModules.add(titleCase);
    possibleModules.add('Data.' + titleCase);
    possibleModules.add('Control.' + titleCase);
    possibleModules.add('Text.' + titleCase);
    possibleModules.add('Network.' + titleCase);

    // Find all imports that might be from this package
    const importLocations: CodeLocation[] = [];
    const usageLocations: CodeLocation[] = [];
    const usedFunctions: string[] = [];

    for (const [filePath, { imports, content }] of fileImports.entries()) {
      for (const imp of imports) {
        // Check if this import is from the target package
        const isFromPackage = 
          // Explicit package import
          imp.packageImport === packageName ||
          // Module matches known modules
          [...possibleModules].some(mod => 
            imp.moduleName === mod || imp.moduleName.startsWith(mod + '.')
          ) ||
          // Module can be mapped to this package
          moduleToPackages(imp.moduleName).includes(packageName);

        if (isFromPackage) {
          importLocations.push(imp.location);

          // Find usages of this import
          const usages = findUsages(content, filePath, [imp]);
          for (const [key, usage] of usages.entries()) {
            const funcName = key.split('.').pop()!;
            if (!usedFunctions.includes(funcName)) {
              usedFunctions.push(funcName);
            }
            usageLocations.push(...usage.locations);
          }

          // If qualified import, look for Alias.func patterns
          if (imp.qualified && imp.alias) {
            const qualifiedPattern = new RegExp(
              `\\b${imp.alias}\\.([a-z_][A-Za-z0-9_']*)`,
              'g'
            );
            const lines = content.split('\n');
            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              const line = lines[lineIdx];
              let match;
              while ((match = qualifiedPattern.exec(line)) !== null) {
                const funcName = match[1];
                if (!usedFunctions.includes(funcName)) {
                  usedFunctions.push(funcName);
                }
                usageLocations.push({ 
                  file: filePath, 
                  line: lineIdx + 1, 
                  column: match.index + 1 
                });
              }
            }
          }

          // If explicit import list, those are likely used
          if (imp.importList) {
            for (const item of imp.importList) {
              // Clean up item (remove type annotations like "Type(..)")
              const cleanItem = item.replace(/\(.*\)/, '').trim();
              if (cleanItem && !usedFunctions.includes(cleanItem)) {
                usedFunctions.push(cleanItem);
              }
            }
          }
        }
      }
    }

    // Not imported at all
    if (importLocations.length === 0) {
      // Check if any transitive dependency
      if (cabalDeps && cabalDeps.has(packageName)) {
        return this.notReachable(component, [
          'Listed in dependencies but no imports found',
          'May be a transitive or build-time dependency'
        ]);
      }
      return this.notReachable(component, ['No imports found for this package']);
    }

    // Check for vulnerable function reachability
    const vulnFunctions = component.vulnerabilities?.flatMap(v => v.affectedFunctions ?? []) ?? [];
    const reachableVulnFunctions = vulnFunctions.filter(
      (vf: string) => usedFunctions.includes(vf)
    );

    if (reachableVulnFunctions.length > 0) {
      return this.reachable(
        component,
        {
          importStyle: 'esm' as const, // Haskell imports are similar to ESM
          importedAs: packageModules[0] || packageName,
          usedMembers: reachableVulnFunctions,
          locations: usageLocations.slice(0, 10)
        },
        'high',
        [`Vulnerable function(s) detected: ${reachableVulnFunctions.join(', ')}`],
        warnings.length ? warnings : undefined
      );
    }

    // Has usages
    if (usageLocations.length > 0) {
      return this.reachable(
        component,
        {
          importStyle: 'esm' as const,
          importedAs: packageModules[0] || packageName,
          usedMembers: usedFunctions.slice(0, 20),
          locations: usageLocations.slice(0, 10)
        },
        vulnFunctions.length > 0 ? 'high' : 'medium',
        usedFunctions.length > 0 
          ? [`Used functions: ${usedFunctions.slice(0, 5).join(', ')}${usedFunctions.length > 5 ? '...' : ''}`]
          : undefined,
        warnings.length ? warnings : undefined
      );
    }

    // Imported but no specific usage detected
    return this.imported(
      component,
      {
        importStyle: 'esm' as const,
        importedAs: packageModules[0] || packageName,
        locations: importLocations.slice(0, 10)
      },
      [
        'Package is imported but specific function usage could not be determined',
        'This may be due to qualified imports or operator usage'
      ],
      warnings.length ? warnings : undefined
    );
  }
}

/**
 * Create a Haskell adapter instance
 */
export function createHaskellAdapter(): HaskellLanguageAdapter {
  return new HaskellLanguageAdapter();
}

// Export singleton instance
export const haskellAdapter = createHaskellAdapter();

/**
 * Parse .cabal file from path
 */
export async function parseCabalFileFromPath(filePath: string): Promise<ReturnType<typeof parseCabalFile>> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseCabalFile(content);
}

/**
 * Parse stack.yaml file from path
 */
export async function parseStackYamlFromPath(filePath: string): Promise<ReturnType<typeof parseStackYaml>> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseStackYaml(content);
}
