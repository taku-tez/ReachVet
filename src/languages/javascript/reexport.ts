/**
 * ReachVet - Re-export Chain Resolver
 * 
 * Tracks re-exports through barrel files (index.ts) to find original sources
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseSource, type ImportInfo } from './parser.js';
import type { CodeLocation } from '../../types.js';

export interface ReexportChain {
  /** The original external package (e.g., 'lodash') */
  originalModule: string;
  /** Chain of files traversed */
  chain: string[];
  /** Exported names at each level */
  exportedNames: string[];
  /** Maximum depth reached */
  depth: number;
}

export interface ReexportResult {
  /** Resolved chains for each import */
  chains: Map<string, ReexportChain[]>;
  /** Warnings generated during resolution */
  warnings: Array<{
    code: 'barrel_file' | 'circular_reexport' | 'max_depth_reached';
    message: string;
    location?: CodeLocation;
  }>;
}

const DEFAULT_MAX_DEPTH = 5;
const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', ''];

/**
 * Resolve a relative import to an absolute file path
 */
function resolveImportPath(importPath: string, fromFile: string): string | null {
  const baseDir = dirname(fromFile);
  
  // Try with different extensions
  for (const ext of JS_EXTENSIONS) {
    const candidates = [
      resolve(baseDir, importPath + ext),
      resolve(baseDir, importPath, 'index' + ext),
    ];
    
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  
  return null;
}

/**
 * Check if an import is a relative path (local file)
 */
function isRelativeImport(moduleName: string): boolean {
  return moduleName.startsWith('./') || moduleName.startsWith('../');
}

/**
 * Resolve re-export chains for imports in a file
 */
export async function resolveReexportChains(
  sourceFile: string,
  imports: ImportInfo[],
  maxDepth: number = DEFAULT_MAX_DEPTH
): Promise<ReexportResult> {
  const chains = new Map<string, ReexportChain[]>();
  const warnings: ReexportResult['warnings'] = [];
  const visited = new Set<string>();

  for (const imp of imports) {
    // Only process relative imports (potential barrel files)
    if (!isRelativeImport(imp.moduleName)) {
      continue;
    }

    const resolvedPath = resolveImportPath(imp.moduleName, sourceFile);
    if (!resolvedPath) {
      continue;
    }

    const resolvedChains = await traceReexports(
      resolvedPath,
      imp.namedImports.length > 0 ? imp.namedImports : undefined,
      maxDepth,
      visited,
      [sourceFile],
      warnings
    );

    if (resolvedChains.length > 0) {
      chains.set(imp.moduleName, resolvedChains);
      
      // Add barrel file warning if this is a re-export
      warnings.push({
        code: 'barrel_file',
        message: `Import through barrel file: ${imp.moduleName} -> ${resolvedChains.map(c => c.originalModule).join(', ')}`,
        location: imp.location
      });
    }
  }

  return { chains, warnings };
}

/**
 * Recursively trace re-exports to find original modules
 */
async function traceReexports(
  filePath: string,
  targetNames: string[] | undefined,
  maxDepth: number,
  visited: Set<string>,
  chain: string[],
  warnings: ReexportResult['warnings']
): Promise<ReexportChain[]> {
  // Check for circular reference
  if (visited.has(filePath)) {
    warnings.push({
      code: 'circular_reexport',
      message: `Circular re-export detected: ${chain.join(' -> ')} -> ${filePath}`
    });
    return [];
  }

  // Check max depth
  if (chain.length > maxDepth) {
    warnings.push({
      code: 'max_depth_reached',
      message: `Maximum re-export depth (${maxDepth}) reached at ${filePath}`
    });
    return [];
  }

  visited.add(filePath);
  const results: ReexportChain[] = [];

  try {
    const content = await readFile(filePath, 'utf-8');
    const imports = parseSource(content, filePath);

    for (const imp of imports) {
      // Look for re-exports: export { x } from 'module' or export * from 'module'
      const isReexport = imp.location.snippet?.includes('export');
      
      if (!isReexport) {
        continue;
      }

      // Check if this re-export includes our target names
      const matchingNames = targetNames 
        ? imp.namedImports.filter(n => targetNames.includes(n))
        : imp.namedImports;
      
      // Also match if it's a namespace re-export (export * from)
      const isNamespaceReexport = imp.isNamespaceImport || 
        (imp.namedImports.length === 0 && !imp.isDefaultImport);

      if (matchingNames.length === 0 && !isNamespaceReexport) {
        continue;
      }

      // External module found!
      if (!isRelativeImport(imp.moduleName)) {
        results.push({
          originalModule: imp.moduleName,
          chain: [...chain, filePath],
          exportedNames: matchingNames.length > 0 ? matchingNames : (targetNames ?? []),
          depth: chain.length
        });
        continue;
      }

      // Relative import - continue tracing
      const nextPath = resolveImportPath(imp.moduleName, filePath);
      if (nextPath) {
        const nestedResults = await traceReexports(
          nextPath,
          matchingNames.length > 0 ? matchingNames : targetNames,
          maxDepth,
          visited,
          [...chain, filePath],
          warnings
        );
        results.push(...nestedResults);
      }
    }
  } catch {
    // File couldn't be read/parsed - skip
  }

  visited.delete(filePath);
  return results;
}

/**
 * Get all external modules that are re-exported through barrel files
 */
export async function findReexportedModules(
  _sourceDir: string,
  entryFile: string,
  maxDepth: number = DEFAULT_MAX_DEPTH
): Promise<Set<string>> {
  const modules = new Set<string>();
  
  try {
    const content = await readFile(entryFile, 'utf-8');
    const imports = parseSource(content, entryFile);
    
    const result = await resolveReexportChains(entryFile, imports, maxDepth);
    
    for (const chains of result.chains.values()) {
      for (const chain of chains) {
        modules.add(chain.originalModule);
      }
    }
  } catch {
    // Skip files that can't be parsed
  }
  
  return modules;
}
