/**
 * ReachVet - OCaml Language Adapter
 * Provides OCaml language support for vulnerability reachability analysis
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import { BaseLanguageAdapter } from '../base.js';
import {
  parseOCamlSource,
  parseDuneFile,
  parseOpamFile,
  findUsages,
  moduleToPackages,
  isStdlibModule,
  OPAM_PACKAGE_TO_MODULES,
  type OCamlOpenInfo,
  type OpamDependency,
  type DuneDependency,
} from './parser.js';
import type {
  Component,
  ComponentResult,
  AnalysisWarning,
  CodeLocation,
} from '../../types.js';

export * from './parser.js';

/**
 * OCaml Language Adapter for ReachVet
 */
export class OCamlLanguageAdapter extends BaseLanguageAdapter {
  readonly language = 'ocaml' as const;
  readonly fileExtensions = ['.ml', '.mli'];

  /**
   * Check if this adapter can handle the given source directory
   */
  async canHandle(sourceDir: string): Promise<boolean> {
    try {
      // Check for dune-project or dune file
      const duneProject = join(sourceDir, 'dune-project');
      try {
        await fs.access(duneProject);
        return true;
      } catch {
        // No dune-project
      }
      
      // Check for opam file
      const opamFiles = await glob('*.opam', { cwd: sourceDir });
      if (opamFiles.length > 0) return true;
      
      // Check for dune files
      const duneFiles = await glob('**/dune', { cwd: sourceDir, ignore: this.ignorePatterns });
      if (duneFiles.length > 0) return true;
      
      // Check for .ml files
      const mlFiles = await glob('**/*.ml', { 
        cwd: sourceDir, 
        ignore: this.ignorePatterns,
        nodir: true
      });
      
      return mlFiles.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Analyze components in an OCaml project
   */
  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const results: ComponentResult[] = [];

    // Parse opam files for dependencies
    let opamDeps = new Map<string, OpamDependency>();
    try {
      const opamFiles = await glob('*.opam', { cwd: sourceDir });
      for (const opamFile of opamFiles) {
        const content = await fs.readFile(join(sourceDir, opamFile), 'utf-8');
        const opam = parseOpamFile(content);
        for (const dep of [...opam.depends, ...opam.devDepends]) {
          if (!opamDeps.has(dep.name)) {
            opamDeps.set(dep.name, dep);
          }
        }
      }
    } catch {
      // No opam files found
    }

    // Parse dune files for additional dependencies
    const duneDeps = new Map<string, DuneDependency>();
    try {
      const duneFiles = await glob('**/dune', { 
        cwd: sourceDir, 
        ignore: ['_build/**', '_opam/**', ...this.ignorePatterns] 
      });
      for (const duneFile of duneFiles) {
        const content = await fs.readFile(join(sourceDir, duneFile), 'utf-8');
        const dune = parseDuneFile(content);
        for (const dep of dune.dependencies) {
          if (!duneDeps.has(dep.name)) {
            duneDeps.set(dep.name, dep);
          }
        }
      }
    } catch {
      // No dune files found
    }

    // Scan OCaml source files and collect opens/includes
    const mlFiles = await this.scanOCamlFiles(sourceDir);
    const fileOpens = new Map<string, { opens: OCamlOpenInfo[], content: string }>();

    for (const filePath of mlFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const relPath = filePath.startsWith(sourceDir)
          ? filePath.slice(sourceDir.length + 1)
          : filePath;
        const opens = parseOCamlSource(content, relPath);
        fileOpens.set(relPath, { opens, content });
      } catch {
        // Skip unreadable files
      }
    }

    // Analyze each component
    for (const component of components) {
      const result = await this.analyzeComponent(
        component,
        fileOpens,
        opamDeps,
        duneDeps
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Scan for OCaml source files
   */
  private async scanOCamlFiles(sourceDir: string): Promise<string[]> {
    const patterns = this.fileExtensions.map(ext => `**/*${ext}`);
    const files: string[] = [];
    
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: sourceDir,
        ignore: [...this.ignorePatterns, '_build/**', '_opam/**', '**/.opam/**'],
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
    fileOpens: Map<string, { opens: OCamlOpenInfo[], content: string }>,
    opamDeps: Map<string, OpamDependency>,
    duneDeps: Map<string, DuneDependency>
  ): Promise<ComponentResult> {
    const warnings: AnalysisWarning[] = [];
    const packageName = component.name;
    
    // Check if this component is in dependencies
    const isInOpam = opamDeps.has(packageName);
    const isInDune = duneDeps.has(packageName);
    
    if (!isInOpam && !isInDune) {
      // Try normalized name
      const normalizedName = packageName.replace(/-/g, '_');
      if (!opamDeps.has(normalizedName) && !duneDeps.has(normalizedName)) {
        return this.notReachable(component, ['Not found in opam or dune dependencies']);
      }
    }

    // Get modules that this package provides
    const packageModules = OPAM_PACKAGE_TO_MODULES[packageName] || [];
    
    // Also check for direct module name match
    const possibleModules = new Set<string>(packageModules);
    
    // Common patterns: package-name -> Package_name -> PackageName
    const underscore = packageName.replace(/-/g, '_');
    const camelCase = underscore.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('_');
    const titleCase = camelCase.replace(/_/g, '');
    possibleModules.add(titleCase);
    possibleModules.add(camelCase);

    // Find all opens/includes that might be from this package
    const openLocations: CodeLocation[] = [];
    const usageLocations: CodeLocation[] = [];
    const usedFunctions: string[] = [];

    for (const [filePath, { opens, content }] of fileOpens.entries()) {
      for (const open of opens) {
        // Skip stdlib modules
        if (isStdlibModule(open.moduleName)) continue;
        
        // Check if this open is from the target package
        const topModule = open.moduleName.split('.')[0];
        const isFromPackage = 
          // Module matches known modules
          [...possibleModules].some(mod => 
            open.moduleName === mod || 
            open.moduleName.startsWith(mod + '.') ||
            topModule === mod
          ) ||
          // Module can be mapped to this package
          moduleToPackages(open.moduleName).includes(packageName);

        if (isFromPackage) {
          openLocations.push(open.location);

          // Find usages
          const usages = findUsages(content, filePath, [open]);
          for (const [_key, usage] of usages.entries()) {
            const funcName = usage.function;
            if (!usedFunctions.includes(funcName)) {
              usedFunctions.push(funcName);
            }
            usageLocations.push(...usage.locations);
          }
        }
      }
    }

    // Not opened/included at all
    if (openLocations.length === 0) {
      // Check if any transitive dependency
      if (isInOpam || isInDune) {
        return this.notReachable(component, [
          'Listed in dependencies but no opens/includes found',
          'May be a transitive or build-time dependency'
        ]);
      }
      return this.notReachable(component, ['No opens/includes found for this package']);
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
          importStyle: 'esm' as const, // OCaml opens are similar to ESM
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

    // Opened but no specific usage detected
    return this.imported(
      component,
      {
        importStyle: 'esm' as const,
        importedAs: packageModules[0] || packageName,
        locations: openLocations.slice(0, 10)
      },
      [
        'Package is opened/included but specific function usage could not be determined',
        'This may be due to operator usage or implicit module access'
      ],
      warnings.length ? warnings : undefined
    );
  }
}

/**
 * Create an OCaml adapter instance
 */
export function createOCamlAdapter(): OCamlLanguageAdapter {
  return new OCamlLanguageAdapter();
}

// Export singleton instance
export const ocamlAdapter = createOCamlAdapter();

/**
 * Parse opam file from path
 */
export async function parseOpamFileFromPath(filePath: string): Promise<ReturnType<typeof parseOpamFile>> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseOpamFile(content);
}

/**
 * Parse dune file from path
 */
export async function parseDuneFileFromPath(filePath: string): Promise<ReturnType<typeof parseDuneFile>> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseDuneFile(content);
}
