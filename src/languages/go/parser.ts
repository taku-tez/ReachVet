/**
 * ReachVet - Go Import Parser
 * Parses Go import statements and go.mod files
 */

import type { CodeLocation } from '../../types.js';

export interface GoImportInfo {
  // Full import path (e.g., 'github.com/gin-gonic/gin')
  path: string;
  // Package name (last segment of path, e.g., 'gin')
  packageName: string;
  // Local alias (import alias "path")
  alias?: string;
  // Is dot import (import . "path")
  isDotImport?: boolean;
  // Is blank import (import _ "path" - for side effects only)
  isBlankImport?: boolean;
  // Location
  location: CodeLocation;
}

export interface GoModDependency {
  // Module path (e.g., 'github.com/gin-gonic/gin')
  module: string;
  // Version (e.g., 'v1.9.0')
  version: string;
  // Is indirect dependency
  indirect?: boolean;
  // Is replacement
  replacement?: {
    module: string;
    version?: string;
  };
}

export interface GoModInfo {
  // Module name (e.g., 'github.com/example/project')
  module: string;
  // Go version (e.g., '1.21')
  goVersion?: string;
  // Direct and indirect dependencies
  dependencies: GoModDependency[];
}

/**
 * Parse Go source and extract import statements
 */
export function parseGoSource(source: string, file: string): GoImportInfo[] {
  const imports: GoImportInfo[] = [];
  const lines = source.split('\n');

  let inImportBlock = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    const line = lines[lineIdx];
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('//') || trimmed === '') continue;

    // Handle grouped imports: import ( ... )
    if (trimmed === 'import (') {
      inImportBlock = true;
      continue;
    }

    if (inImportBlock) {
      if (trimmed === ')') {
        inImportBlock = false;
        continue;
      }

      const importInfo = parseImportLine(trimmed, file, lineNum);
      if (importInfo) {
        imports.push(importInfo);
      }
      continue;
    }

    // Handle single import: import "path" or import alias "path"
    if (trimmed.startsWith('import ')) {
      const importPart = trimmed.slice(7).trim();
      
      // Check for inline grouped import: import ( "a"; "b" )
      if (importPart.startsWith('(') && importPart.includes(')')) {
        const content = importPart.slice(1, importPart.indexOf(')')).trim();
        const parts = content.split(';').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          const importInfo = parseImportLine(part, file, lineNum);
          if (importInfo) {
            imports.push(importInfo);
          }
        }
        continue;
      }

      const importInfo = parseImportLine(importPart, file, lineNum);
      if (importInfo) {
        imports.push(importInfo);
      }
    }
  }

  return imports;
}

/**
 * Parse a single import line
 */
function parseImportLine(line: string, file: string, lineNum: number): GoImportInfo | null {
  const trimmed = line.trim();
  
  // Remove inline comments
  const commentIdx = trimmed.indexOf('//');
  const cleanLine = commentIdx >= 0 ? trimmed.slice(0, commentIdx).trim() : trimmed;
  
  if (!cleanLine) return null;

  // Patterns:
  // "path"
  // alias "path"
  // . "path"
  // _ "path"

  // Match: alias "path" or . "path" or _ "path"
  const aliasMatch = cleanLine.match(/^(\S+)\s+"([^"]+)"$/);
  if (aliasMatch) {
    const [, alias, path] = aliasMatch;
    const packageName = extractPackageName(path);
    
    return {
      path,
      packageName,
      alias: alias === '.' || alias === '_' ? undefined : alias,
      isDotImport: alias === '.',
      isBlankImport: alias === '_',
      location: {
        file,
        line: lineNum,
        snippet: cleanLine
      }
    };
  }

  // Match: "path"
  const pathMatch = cleanLine.match(/^"([^"]+)"$/);
  if (pathMatch) {
    const path = pathMatch[1];
    const packageName = extractPackageName(path);
    
    return {
      path,
      packageName,
      location: {
        file,
        line: lineNum,
        snippet: cleanLine
      }
    };
  }

  return null;
}

/**
 * Extract package name from import path
 * e.g., "github.com/gin-gonic/gin" -> "gin"
 *       "net/http" -> "http"
 *       "encoding/json" -> "json"
 */
export function extractPackageName(importPath: string): string {
  // Handle versioned paths: github.com/user/repo/v2 -> repo
  const versionMatch = importPath.match(/^(.+)\/v\d+$/);
  if (versionMatch) {
    return extractPackageName(versionMatch[1]);
  }

  const parts = importPath.split('/');
  return parts[parts.length - 1];
}

/**
 * Parse go.mod file
 */
export function parseGoMod(content: string): GoModInfo {
  const lines = content.split('\n');
  const dependencies: GoModDependency[] = [];
  let moduleName = '';
  let goVersion: string | undefined;
  
  let inRequireBlock = false;
  let inReplaceBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('//') || trimmed === '') continue;

    // Module declaration
    const moduleMatch = trimmed.match(/^module\s+(\S+)/);
    if (moduleMatch) {
      moduleName = moduleMatch[1];
      continue;
    }

    // Go version
    const goMatch = trimmed.match(/^go\s+([\d.]+)/);
    if (goMatch) {
      goVersion = goMatch[1];
      continue;
    }

    // Require block
    if (trimmed === 'require (') {
      inRequireBlock = true;
      continue;
    }

    // Replace block
    if (trimmed === 'replace (') {
      inReplaceBlock = true;
      continue;
    }

    if (trimmed === ')') {
      inRequireBlock = false;
      inReplaceBlock = false;
      continue;
    }

    // Handle single-line require
    if (trimmed.startsWith('require ') && !trimmed.includes('(')) {
      const depMatch = trimmed.slice(8).match(/^(\S+)\s+(\S+)(\s+\/\/\s*indirect)?/);
      if (depMatch) {
        dependencies.push({
          module: depMatch[1],
          version: depMatch[2],
          indirect: !!depMatch[3]
        });
      }
      continue;
    }

    // Handle require block entries
    if (inRequireBlock) {
      const depMatch = trimmed.match(/^(\S+)\s+(\S+)(\s+\/\/\s*indirect)?/);
      if (depMatch) {
        dependencies.push({
          module: depMatch[1],
          version: depMatch[2],
          indirect: !!depMatch[3]
        });
      }
      continue;
    }

    // Handle replace directives
    if (inReplaceBlock || trimmed.startsWith('replace ')) {
      const replaceMatch = trimmed.match(/^(?:replace\s+)?(\S+)\s+=>\s+(\S+)(?:\s+(\S+))?/);
      if (replaceMatch) {
        const [, original, replacement, version] = replaceMatch;
        // Find the dependency and add replacement info
        const dep = dependencies.find(d => d.module === original);
        if (dep) {
          dep.replacement = {
            module: replacement,
            version
          };
        } else {
          // Add as new dependency with replacement
          dependencies.push({
            module: original,
            version: version || 'replaced',
            replacement: {
              module: replacement,
              version
            }
          });
        }
      }
    }
  }

  return {
    module: moduleName,
    goVersion,
    dependencies
  };
}

/**
 * Find function/method usages from an imported package
 * Tracks patterns like: packageName.Function(), alias.Method()
 */
export function findPackageUsages(
  source: string,
  packageName: string,
  alias?: string
): string[] {
  const usages = new Set<string>();
  const names = [packageName];
  if (alias && alias !== packageName) names.push(alias);
  
  for (const name of names) {
    // Escape for regex
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Match package.Function or package.Method patterns
    // Go functions/methods start with capital letter for exports
    const pattern = new RegExp(`\\b${escaped}\\.(\\w+)`, 'g');
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      usages.add(match[1]);
    }
  }
  
  return [...usages];
}

/**
 * Check if a package is from the Go standard library
 */
export function isStandardLibrary(importPath: string): boolean {
  // Standard library packages don't contain dots in the first segment
  // e.g., "fmt", "net/http", "encoding/json" are stdlib
  // "github.com/...", "golang.org/x/..." are not
  const firstSegment = importPath.split('/')[0];
  return !firstSegment.includes('.');
}

/**
 * Extract the module name from an import path
 * For packages like "github.com/user/repo/subpkg", returns "github.com/user/repo"
 */
export function extractModuleName(importPath: string): string {
  const parts = importPath.split('/');
  
  // Standard library
  if (!parts[0].includes('.')) {
    return parts[0];
  }
  
  // GitHub, GitLab, etc.: first 3 segments
  if (parts.length >= 3 && (
    parts[0] === 'github.com' ||
    parts[0] === 'gitlab.com' ||
    parts[0] === 'bitbucket.org'
  )) {
    // Handle versioned modules: github.com/user/repo/v2
    if (parts.length >= 4 && parts[3].match(/^v\d+$/)) {
      return parts.slice(0, 4).join('/');
    }
    return parts.slice(0, 3).join('/');
  }
  
  // golang.org/x/...: first 3 segments
  if (parts[0] === 'golang.org' && parts[1] === 'x') {
    return parts.slice(0, 3).join('/');
  }
  
  // gopkg.in: first 2 segments usually
  if (parts[0] === 'gopkg.in') {
    return parts.slice(0, 2).join('/');
  }
  
  // Default: use whole path
  return importPath;
}

/**
 * Map common Go package aliases to their canonical names
 */
export const GO_PACKAGE_ALIASES: Record<string, string> = {
  // Common aliasing patterns
  'logrus': 'github.com/sirupsen/logrus',
  'gin': 'github.com/gin-gonic/gin',
  'echo': 'github.com/labstack/echo',
  'mux': 'github.com/gorilla/mux',
  'chi': 'github.com/go-chi/chi',
  'fiber': 'github.com/gofiber/fiber',
  'gorm': 'gorm.io/gorm',
  'zap': 'go.uber.org/zap',
  'zerolog': 'github.com/rs/zerolog',
  'viper': 'github.com/spf13/viper',
  'cobra': 'github.com/spf13/cobra',
  'testify': 'github.com/stretchr/testify',
};
