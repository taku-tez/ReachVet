/**
 * ReachVet - JavaScript/TypeScript Import Detector
 * 
 * Matches npm package names to import statements
 */

import type { ImportInfo } from './parser.js';
import type { Component } from '../../types.js';

/**
 * Check if an import matches a component (npm package)
 */
export function matchesComponent(importInfo: ImportInfo, component: Component): boolean {
  const moduleName = importInfo.moduleName;
  const packageName = component.name;

  // Direct match: import 'lodash'
  if (moduleName === packageName) {
    return true;
  }

  // Scoped package: import '@scope/pkg' matches '@scope/pkg'
  if (moduleName === packageName) {
    return true;
  }

  // Subpath import: import 'lodash/merge' matches 'lodash'
  if (moduleName.startsWith(packageName + '/')) {
    return true;
  }

  // Scoped subpath: import '@scope/pkg/sub' matches '@scope/pkg'
  if (packageName.startsWith('@') && moduleName.startsWith(packageName + '/')) {
    return true;
  }

  return false;
}

/**
 * Get all imports that match any of the components
 */
export function findMatchingImports(
  imports: ImportInfo[],
  components: Component[]
): Map<Component, ImportInfo[]> {
  const matches = new Map<Component, ImportInfo[]>();

  for (const component of components) {
    const matching = imports.filter(imp => matchesComponent(imp, component));
    if (matching.length > 0) {
      matches.set(component, matching);
    }
  }

  return matches;
}

/**
 * Extract used members from imports
 * 
 * E.g., import { merge, clone } from 'lodash' -> ['merge', 'clone']
 */
export function extractUsedMembers(imports: ImportInfo[]): string[] {
  const members: string[] = [];

  for (const imp of imports) {
    // Named imports
    if (imp.namedImports.length > 0) {
      members.push(...imp.namedImports);
    }

    // For namespace/default imports, we can't determine specific members
    // without deeper analysis
  }

  return [...new Set(members)];
}

/**
 * Check if import uses specific functions (for vulnerability matching)
 */
export function usesAffectedFunctions(
  imports: ImportInfo[],
  affectedFunctions: string[]
): { matches: boolean; usedFunctions: string[] } {
  const usedMembers = extractUsedMembers(imports);
  const usedFunctions: string[] = [];

  for (const func of affectedFunctions) {
    if (usedMembers.includes(func)) {
      usedFunctions.push(func);
    }
  }

  // If it's a namespace import (import * as _), we can't be sure
  const hasNamespaceImport = imports.some(i => i.isNamespaceImport);
  const hasDefaultImport = imports.some(i => i.isDefaultImport);

  return {
    matches: usedFunctions.length > 0 || hasNamespaceImport || hasDefaultImport,
    usedFunctions
  };
}

/**
 * Determine import style priority for reporting
 */
export function getPrimaryImportStyle(imports: ImportInfo[]): 'esm' | 'commonjs' | 'dynamic' | 'require' {
  // Prefer ESM if any
  if (imports.some(i => i.importStyle === 'esm')) {
    return 'esm';
  }
  if (imports.some(i => i.importStyle === 'commonjs')) {
    return 'commonjs';
  }
  if (imports.some(i => i.importStyle === 'dynamic')) {
    return 'dynamic';
  }
  return 'require';
}
