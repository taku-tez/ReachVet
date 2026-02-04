/**
 * ReachVet - Monorepo/Workspace Detection for JS/TS
 * 
 * Detects internal packages in monorepos to avoid false positives
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { glob } from 'glob';

export interface WorkspaceInfo {
  /** Root directory of the monorepo */
  root: string;
  /** Type of workspace manager */
  type: 'npm' | 'yarn' | 'pnpm' | 'lerna' | 'nx' | 'turborepo' | 'unknown';
  /** List of workspace package names */
  packages: string[];
  /** Map of package name to directory */
  packageDirs: Map<string, string>;
}

/**
 * Detect if directory is part of a monorepo and get workspace info
 */
export async function detectWorkspace(sourceDir: string): Promise<WorkspaceInfo | null> {
  // Walk up to find workspace root
  let currentDir = sourceDir;
  const maxDepth = 10;
  
  for (let i = 0; i < maxDepth; i++) {
    const info = await checkWorkspaceRoot(currentDir);
    if (info) {
      return info;
    }
    
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break; // Reached filesystem root
    currentDir = parentDir;
  }
  
  return null;
}

/**
 * Check if directory is a workspace root
 */
async function checkWorkspaceRoot(dir: string): Promise<WorkspaceInfo | null> {
  const packageJsonPath = join(dir, 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  
  try {
    const content = await readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    
    // Check for workspace patterns
    let workspacePatterns: string[] = [];
    let type: WorkspaceInfo['type'] = 'unknown';
    
    // npm/yarn workspaces
    if (pkg.workspaces) {
      workspacePatterns = Array.isArray(pkg.workspaces) 
        ? pkg.workspaces 
        : pkg.workspaces.packages || [];
      type = existsSync(join(dir, 'yarn.lock')) ? 'yarn' : 'npm';
    }
    
    // pnpm workspace
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      type = 'pnpm';
      const pnpmContent = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8');
      const packagesMatch = pnpmContent.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (packagesMatch) {
        workspacePatterns = packagesMatch[1]
          .split('\n')
          .map(line => line.replace(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/, '$1'))
          .filter(Boolean);
      }
    }
    
    // Lerna
    if (existsSync(join(dir, 'lerna.json'))) {
      type = 'lerna';
      const lernaContent = await readFile(join(dir, 'lerna.json'), 'utf-8');
      const lerna = JSON.parse(lernaContent);
      workspacePatterns = lerna.packages || ['packages/*'];
    }
    
    // Nx
    if (existsSync(join(dir, 'nx.json'))) {
      type = 'nx';
      workspacePatterns = workspacePatterns.length > 0 
        ? workspacePatterns 
        : ['packages/*', 'apps/*', 'libs/*'];
    }
    
    // Turborepo
    if (existsSync(join(dir, 'turbo.json'))) {
      type = 'turborepo';
    }
    
    if (workspacePatterns.length === 0) {
      return null;
    }
    
    // Resolve workspace packages
    const packages: string[] = [];
    const packageDirs = new Map<string, string>();
    
    for (const pattern of workspacePatterns) {
      const dirs = await glob(pattern, { cwd: dir, absolute: true });
      
      for (const pkgDir of dirs) {
        const pkgJsonPath = join(pkgDir, 'package.json');
        if (existsSync(pkgJsonPath)) {
          try {
            const pkgContent = await readFile(pkgJsonPath, 'utf-8');
            const pkgJson = JSON.parse(pkgContent);
            if (pkgJson.name) {
              packages.push(pkgJson.name);
              packageDirs.set(pkgJson.name, pkgDir);
            }
          } catch {
            // Skip invalid package.json
          }
        }
      }
    }
    
    if (packages.length === 0) {
      return null;
    }
    
    return {
      root: dir,
      type,
      packages,
      packageDirs
    };
  } catch {
    return null;
  }
}

/**
 * Check if a component is an internal workspace package
 */
export function isInternalPackage(componentName: string, workspace: WorkspaceInfo | null): boolean {
  if (!workspace) return false;
  return workspace.packages.includes(componentName);
}
