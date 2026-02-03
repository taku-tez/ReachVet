/**
 * ReachVet - Python Import Parser
 * Parses Python import statements using regex-based approach
 */

import type { CodeLocation } from '../../types.js';

export interface PythonImportInfo {
  // Module or package name (e.g., 'requests', 'urllib.parse')
  module: string;
  // Submodule path (e.g., 'parse' from 'urllib.parse')
  submodule?: string;
  // Imported members (from X import a, b, c)
  members?: string[];
  // Local alias (import X as Y)
  alias?: string;
  // Is star import (from X import *)
  isStarImport?: boolean;
  // Import style
  importStyle: 'import' | 'from';
  // Location
  location: CodeLocation;
}

/**
 * Parse Python source and extract import statements
 */
export function parsePythonSource(source: string, file: string): PythonImportInfo[] {
  const imports: PythonImportInfo[] = [];
  const lines = source.split('\n');

  // Track multi-line imports
  let multiLineBuffer = '';
  let multiLineStartLine = 0;
  let inMultiLine = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    let line = lines[lineIdx];
    const trimmedLine = line.trim();
    
    // Handle backslash line continuation
    if (trimmedLine.endsWith('\\')) {
      const lineWithoutSlash = trimmedLine.slice(0, -1).trim();
      if (!inMultiLine) {
        multiLineBuffer = lineWithoutSlash;
        multiLineStartLine = lineNum;
        inMultiLine = true;
      } else {
        multiLineBuffer += ' ' + lineWithoutSlash;
      }
      continue;
    }
    
    // If we were in backslash continuation mode, add this line and process
    if (inMultiLine && !multiLineBuffer.includes('(')) {
      multiLineBuffer += ' ' + trimmedLine;
      line = multiLineBuffer.replace(/\s+/g, ' ').trim();
      inMultiLine = false;
      multiLineBuffer = '';
      // Continue processing this combined line below
    }
    // Handle multi-line with parentheses
    else if (inMultiLine || (trimmedLine.includes('(') && !trimmedLine.includes(')'))) {
      if (!inMultiLine && !trimmedLine.startsWith('import') && !trimmedLine.startsWith('from')) {
        continue;
      }
      
      if (!inMultiLine) {
        multiLineBuffer = line;
        multiLineStartLine = lineNum;
        inMultiLine = true;
        continue;
      }
      
      multiLineBuffer += ' ' + trimmedLine;
      
      if (trimmedLine.includes(')')) {
        line = multiLineBuffer.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
        inMultiLine = false;
        multiLineBuffer = '';
        // Continue processing this combined line below
      } else {
        continue;
      }
    }

    // Skip comments and empty lines
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    // Remove inline comments
    const commentIdx = trimmed.indexOf('#');
    const cleanLine = commentIdx >= 0 ? trimmed.slice(0, commentIdx).trim() : trimmed;
    
    // Parse "from X import Y" style
    const fromMatch = cleanLine.match(
      /^from\s+([\w.]+)\s+import\s+(.+)$/
    );
    
    if (fromMatch) {
      const [, modulePath, importPart] = fromMatch;
      const lineNumber = inMultiLine ? multiLineStartLine : lineNum;
      
      // Split module path
      const parts = modulePath.split('.');
      const module = parts[0];
      const submodule = parts.length > 1 ? parts.slice(1).join('.') : undefined;
      
      // Check for star import
      if (importPart.trim() === '*') {
        imports.push({
          module,
          submodule,
          isStarImport: true,
          importStyle: 'from',
          location: {
            file,
            line: lineNumber,
            snippet: cleanLine.slice(0, 100)
          }
        });
        continue;
      }
      
      // Parse imported members
      const members: string[] = [];
      const aliases: Map<string, string> = new Map();
      
      // Handle comma-separated imports with optional aliases
      const memberParts = importPart.split(',').map(s => s.trim());
      for (const part of memberParts) {
        const asMatch = part.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          members.push(asMatch[1]);
          aliases.set(asMatch[1], asMatch[2]);
        } else if (/^\w+$/.test(part)) {
          members.push(part);
        }
      }
      
      if (members.length > 0) {
        imports.push({
          module,
          submodule,
          members,
          importStyle: 'from',
          location: {
            file,
            line: lineNumber,
            snippet: cleanLine.slice(0, 100)
          }
        });
      }
      continue;
    }
    
    // Parse "import X" or "import X as Y" style
    const importMatch = cleanLine.match(
      /^import\s+(.+)$/
    );
    
    if (importMatch) {
      const importPart = importMatch[1];
      const lineNumber = inMultiLine ? multiLineStartLine : lineNum;
      
      // Handle multiple imports (import a, b, c)
      const parts = importPart.split(',').map(s => s.trim());
      
      for (const part of parts) {
        const asMatch = part.match(/^([\w.]+)\s+as\s+(\w+)$/);
        
        if (asMatch) {
          const modulePath = asMatch[1];
          const alias = asMatch[2];
          const modParts = modulePath.split('.');
          
          imports.push({
            module: modParts[0],
            submodule: modParts.length > 1 ? modParts.slice(1).join('.') : undefined,
            alias,
            importStyle: 'import',
            location: {
              file,
              line: lineNumber,
              snippet: cleanLine.slice(0, 100)
            }
          });
        } else if (/^[\w.]+$/.test(part)) {
          const modParts = part.split('.');
          
          imports.push({
            module: modParts[0],
            submodule: modParts.length > 1 ? modParts.slice(1).join('.') : undefined,
            importStyle: 'import',
            location: {
              file,
              line: lineNumber,
              snippet: cleanLine.slice(0, 100)
            }
          });
        }
      }
    }
  }

  return imports;
}

/**
 * Find function/attribute usages from an imported module
 * Tracks patterns like: module.function(), alias.method()
 */
export function findModuleUsages(
  source: string, 
  moduleName: string, 
  alias?: string,
  _file?: string
): string[] {
  const usages = new Set<string>();
  const names = [moduleName];
  if (alias) names.push(alias);
  
  // Match module.attribute or module.method() patterns
  for (const name of names) {
    // Escape dots in module name for regex
    const escaped = name.replace(/\./g, '\\.');
    
    // Match direct attribute access: module.attr
    const attrPattern = new RegExp(`\\b${escaped}\\.(\\w+)`, 'g');
    let match;
    
    while ((match = attrPattern.exec(source)) !== null) {
      usages.add(match[1]);
    }
  }
  
  return [...usages];
}

/**
 * Normalize a package name for comparison
 * Python packages use underscores internally but hyphens in PyPI
 */
export function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/-/g, '_');
}
