/**
 * ReachVet - Python Import Detector
 * Matches Python imports to package components
 */

import type { Component } from '../../types.js';
import type { PythonImportInfo } from './parser.js';
import { normalizePackageName } from './parser.js';

/**
 * Check if an import matches a component
 */
export function matchesComponent(imp: PythonImportInfo, component: Component): boolean {
  // Normalize names for comparison
  const impModule = normalizePackageName(imp.module);
  const componentName = normalizePackageName(component.name);
  
  // Direct match
  if (impModule === componentName) {
    return true;
  }
  
  // Check if component has purl with pypi
  if (component.purl) {
    // pkg:pypi/requests@2.28.0 -> requests
    const purlMatch = component.purl.match(/^pkg:pypi\/([^@/]+)/);
    if (purlMatch) {
      const purlName = normalizePackageName(purlMatch[1]);
      if (impModule === purlName) {
        return true;
      }
    }
  }
  
  // Check aliases/alternative names
  // Some packages have different import names (e.g., Pillow -> PIL)
  const commonAliases: Record<string, string[]> = {
    'pillow': ['pil'],
    'pyyaml': ['yaml'],
    'python_dateutil': ['dateutil'],
    'beautifulsoup4': ['bs4'],
    'scikit_learn': ['sklearn'],
    'opencv_python': ['cv2'],
    'tensorflow_gpu': ['tensorflow'],
    'protobuf': ['google.protobuf'],
    'pyzmq': ['zmq'],
  };
  
  const aliases = commonAliases[componentName];
  if (aliases && aliases.includes(impModule)) {
    return true;
  }
  
  // Reverse check - component might be the alias
  for (const [pkg, aliasList] of Object.entries(commonAliases)) {
    if (aliasList.includes(componentName) && pkg === impModule) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract used members from imports
 */
export function extractUsedMembers(imports: PythonImportInfo[]): string[] {
  const members = new Set<string>();
  
  for (const imp of imports) {
    if (imp.members) {
      for (const member of imp.members) {
        members.add(member);
      }
    }
  }
  
  return [...members];
}

/**
 * Determine primary import style
 */
export function getPrimaryImportStyle(imports: PythonImportInfo[]): 'import' | 'from' {
  const fromCount = imports.filter(i => i.importStyle === 'from').length;
  const importCount = imports.filter(i => i.importStyle === 'import').length;
  
  return fromCount >= importCount ? 'from' : 'import';
}

/**
 * Check for potentially dangerous import patterns
 */
export function detectDangerousPatterns(imports: PythonImportInfo[]): string[] {
  const warnings: string[] = [];
  
  for (const imp of imports) {
    // Star imports can bring in unexpected names
    if (imp.isStarImport) {
      warnings.push(`Star import from ${imp.module} - all names imported into namespace`);
    }
  }
  
  return warnings;
}
