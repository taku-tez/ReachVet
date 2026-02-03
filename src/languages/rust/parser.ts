/**
 * ReachVet - Rust Import Parser
 * Parses Rust use statements and Cargo.toml files
 */

import type { CodeLocation } from '../../types.js';

export interface RustUseInfo {
  // Full path (e.g., 'serde::Deserialize')
  path: string;
  // Crate name (e.g., 'serde')
  crateName: string;
  // Items being imported (for nested/glob imports)
  items: string[];
  // Local alias (as alias)
  alias?: string;
  // Is glob import (::*)
  isGlob?: boolean;
  // Is crate-local (crate::)
  isCrateLocal?: boolean;
  // Is super import (super::)
  isSuper?: boolean;
  // Is self import (self::)
  isSelf?: boolean;
  // Location
  location: CodeLocation;
}

export interface CargoDependency {
  // Crate name
  name: string;
  // Version (semver or git/path)
  version: string;
  // Features enabled
  features?: string[];
  // Is optional
  optional?: boolean;
  // Is dev dependency
  dev?: boolean;
  // Is build dependency
  build?: boolean;
  // Git source
  git?: string;
  // Path source
  path?: string;
}

export interface CargoInfo {
  // Package name
  name: string;
  // Package version
  version: string;
  // Rust edition
  edition?: string;
  // Dependencies
  dependencies: CargoDependency[];
}

/**
 * Parse Rust source and extract use statements
 */
export function parseRustSource(source: string, file: string): RustUseInfo[] {
  const uses: RustUseInfo[] = [];
  const lines = source.split('\n');
  
  let multilineUse = '';
  let multilineStart = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    let line = lines[lineIdx];
    
    // Remove line comments (but be careful with strings)
    const commentIdx = findCommentStart(line);
    if (commentIdx >= 0) {
      line = line.slice(0, commentIdx);
    }
    
    const trimmed = line.trim();
    
    // Skip empty or pure comment lines
    if (trimmed === '') continue;
    
    // Handle multiline use statements
    if (multilineUse) {
      multilineUse += ' ' + trimmed;
      if (trimmed.includes(';')) {
        const parsed = parseUseStatement(multilineUse, file, multilineStart);
        if (parsed.length > 0) {
          uses.push(...parsed);
        }
        multilineUse = '';
      }
      continue;
    }
    
    // Start of use statement
    if (trimmed.startsWith('use ') || trimmed.startsWith('pub use ')) {
      const useStart = trimmed.indexOf('use ');
      const usePart = trimmed.slice(useStart + 4);
      
      if (trimmed.endsWith(';')) {
        // Single line use
        const parsed = parseUseStatement(usePart, file, lineNum);
        uses.push(...parsed);
      } else {
        // Multiline use
        multilineUse = usePart;
        multilineStart = lineNum;
      }
    }
  }

  return uses;
}

/**
 * Find comment start position, accounting for strings
 */
function findCommentStart(line: string): number {
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i];
    const next = line[i + 1];
    
    if (!inString) {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
      } else if (char === '/' && next === '/') {
        return i;
      }
    } else {
      if (char === '\\') {
        i++; // Skip escaped character
      } else if (char === stringChar) {
        inString = false;
      }
    }
  }
  
  return -1;
}

/**
 * Parse a use statement (after "use ")
 */
function parseUseStatement(stmt: string, file: string, lineNum: number): RustUseInfo[] {
  const results: RustUseInfo[] = [];
  
  // Remove trailing semicolon
  let cleanStmt = stmt.trim();
  if (cleanStmt.endsWith(';')) {
    cleanStmt = cleanStmt.slice(0, -1).trim();
  }
  
  // Handle "as alias" at the end
  let alias: string | undefined;
  const asMatch = cleanStmt.match(/\s+as\s+(\w+)$/);
  if (asMatch) {
    alias = asMatch[1];
    cleanStmt = cleanStmt.slice(0, -asMatch[0].length).trim();
  }
  
  // Parse the path
  const parsed = parseUsePath(cleanStmt, file, lineNum, alias);
  results.push(...parsed);
  
  return results;
}

/**
 * Parse a use path, handling nested imports
 */
function parseUsePath(
  path: string,
  file: string,
  lineNum: number,
  alias?: string
): RustUseInfo[] {
  const results: RustUseInfo[] = [];
  
  // Check for nested import: foo::{a, b, c} or foo::{a::*, b::Bar}
  const nestedMatch = path.match(/^(.+?)::(\{.+\})$/);
  if (nestedMatch) {
    const [, prefix, nested] = nestedMatch;
    const items = parseNestedItems(nested);
    
    for (const item of items) {
      // Handle nested path: {submod::Item}
      if (item.includes('::')) {
        const subParsed = parseUsePath(`${prefix}::${item}`, file, lineNum);
        results.push(...subParsed);
      } else if (item === '*') {
        // Glob in nested: {*, Item}
        results.push(createUseInfo(`${prefix}::*`, file, lineNum, undefined, true));
      } else {
        // Simple item
        results.push(createUseInfo(`${prefix}::${item}`, file, lineNum));
      }
    }
    return results;
  }
  
  // Glob import: foo::*
  if (path.endsWith('::*')) {
    results.push(createUseInfo(path, file, lineNum, alias, true));
    return results;
  }
  
  // Simple import
  results.push(createUseInfo(path, file, lineNum, alias));
  return results;
}

/**
 * Parse nested items: {a, b, c} or {a as x, b::*, c}
 */
function parseNestedItems(nested: string): string[] {
  // Remove braces
  let content = nested.slice(1, -1).trim();
  
  const items: string[] = [];
  let depth = 0;
  let current = '';
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    if (char === '{') {
      depth++;
      current += char;
    } else if (char === '}') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      const item = current.trim();
      if (item) items.push(item);
      current = '';
    } else {
      current += char;
    }
  }
  
  const lastItem = current.trim();
  if (lastItem) items.push(lastItem);
  
  // Process "as alias" in items
  return items.map(item => {
    const asMatch = item.match(/^(.+)\s+as\s+\w+$/);
    return asMatch ? asMatch[1].trim() : item;
  });
}

/**
 * Create a RustUseInfo from path
 */
function createUseInfo(
  path: string,
  file: string,
  lineNum: number,
  alias?: string,
  isGlob = false
): RustUseInfo {
  const parts = path.split('::').filter(Boolean);
  const firstPart = parts[0] || '';
  
  // Determine crate name
  let crateName = firstPart;
  let isCrateLocal = false;
  let isSuper = false;
  let isSelf = false;
  
  if (firstPart === 'crate') {
    isCrateLocal = true;
    crateName = parts[1] || 'crate';
  } else if (firstPart === 'super') {
    isSuper = true;
    crateName = 'super';
  } else if (firstPart === 'self') {
    isSelf = true;
    crateName = 'self';
  }
  
  // Get items (last part of path)
  const items: string[] = [];
  if (!isGlob && parts.length > 1) {
    items.push(parts[parts.length - 1]);
  } else if (isGlob) {
    items.push('*');
  }
  
  return {
    path,
    crateName,
    items,
    alias,
    isGlob,
    isCrateLocal,
    isSuper,
    isSelf,
    location: {
      file,
      line: lineNum,
      snippet: `use ${path};`
    }
  };
}

/**
 * Parse Cargo.toml file
 */
export function parseCargoToml(content: string): CargoInfo {
  const lines = content.split('\n');
  const dependencies: CargoDependency[] = [];
  let name = '';
  let version = '';
  let edition: string | undefined;
  
  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    // Section header
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase();
      continue;
    }
    
    // Key-value pairs
    if (currentSection === 'package') {
      const kvMatch = trimmed.match(/^(\w+)\s*=\s*"?([^"#]+)"?/);
      if (kvMatch) {
        const [, key, value] = kvMatch;
        if (key === 'name') name = value.trim();
        else if (key === 'version') version = value.trim();
        else if (key === 'edition') edition = value.trim();
      }
    } else if (
      currentSection === 'dependencies' ||
      currentSection === 'dev-dependencies' ||
      currentSection === 'build-dependencies'
    ) {
      const isDev = currentSection === 'dev-dependencies';
      const isBuild = currentSection === 'build-dependencies';
      
      // Simple: dep = "1.0"
      const simpleMatch = trimmed.match(/^([\w-]+)\s*=\s*"([^"]+)"$/);
      if (simpleMatch) {
        dependencies.push({
          name: simpleMatch[1],
          version: simpleMatch[2],
          dev: isDev || undefined,
          build: isBuild || undefined,
        });
        continue;
      }
      
      // Inline table: dep = { version = "1.0", features = ["a", "b"] }
      const tableMatch = trimmed.match(/^([\w-]+)\s*=\s*\{(.+)\}$/);
      if (tableMatch) {
        const dep = parseInlineDep(tableMatch[1], tableMatch[2], isDev, isBuild);
        if (dep) dependencies.push(dep);
        continue;
      }
      
      // Key-only (start of multi-line table): dep.version = "1.0"
      const dotMatch = trimmed.match(/^([\w-]+)\.(\w+)\s*=\s*(.+)$/);
      if (dotMatch) {
        let dep = dependencies.find(d => d.name === dotMatch[1]);
        if (!dep) {
          dep = { name: dotMatch[1], version: '', dev: isDev || undefined, build: isBuild || undefined };
          dependencies.push(dep);
        }
        const val = dotMatch[3].replace(/"/g, '').trim();
        if (dotMatch[2] === 'version') dep.version = val;
        else if (dotMatch[2] === 'git') dep.git = val;
        else if (dotMatch[2] === 'path') dep.path = val;
        else if (dotMatch[2] === 'optional') dep.optional = val === 'true';
      }
    } else if (currentSection.startsWith('dependencies.')) {
      // Sub-table: [dependencies.serde]
      const depName = currentSection.slice('dependencies.'.length);
      let dep = dependencies.find(d => d.name === depName);
      if (!dep) {
        dep = { name: depName, version: '' };
        dependencies.push(dep);
      }
      
      const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (kvMatch) {
        const [, key, rawVal] = kvMatch;
        const val = rawVal.replace(/"/g, '').trim();
        if (key === 'version') dep.version = val;
        else if (key === 'git') dep.git = val;
        else if (key === 'path') dep.path = val;
        else if (key === 'optional') dep.optional = val === 'true';
        else if (key === 'features') {
          // Parse array: ["a", "b"]
          const features = rawVal.match(/"([^"]+)"/g);
          if (features) {
            dep.features = features.map(f => f.replace(/"/g, ''));
          }
        }
      }
    } else if (currentSection.startsWith('dev-dependencies.')) {
      const depName = currentSection.slice('dev-dependencies.'.length);
      let dep = dependencies.find(d => d.name === depName);
      if (!dep) {
        dep = { name: depName, version: '', dev: true };
        dependencies.push(dep);
      }
      
      const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (kvMatch) {
        const [, key, rawVal] = kvMatch;
        const val = rawVal.replace(/"/g, '').trim();
        if (key === 'version') dep.version = val;
      }
    }
  }

  return {
    name,
    version,
    edition,
    dependencies
  };
}

/**
 * Parse inline dependency table
 */
function parseInlineDep(
  name: string,
  content: string,
  isDev: boolean,
  isBuild: boolean
): CargoDependency | null {
  const dep: CargoDependency = {
    name,
    version: '',
    dev: isDev || undefined,
    build: isBuild || undefined,
  };
  
  // Parse key-value pairs from inline table
  const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
  if (versionMatch) dep.version = versionMatch[1];
  
  const gitMatch = content.match(/git\s*=\s*"([^"]+)"/);
  if (gitMatch) dep.git = gitMatch[1];
  
  const pathMatch = content.match(/path\s*=\s*"([^"]+)"/);
  if (pathMatch) dep.path = pathMatch[1];
  
  const optionalMatch = content.match(/optional\s*=\s*(true|false)/);
  if (optionalMatch) dep.optional = optionalMatch[1] === 'true';
  
  const featuresMatch = content.match(/features\s*=\s*\[([^\]]*)\]/);
  if (featuresMatch) {
    const features = featuresMatch[1].match(/"([^"]+)"/g);
    if (features) {
      dep.features = features.map(f => f.replace(/"/g, ''));
    }
  }
  
  return dep;
}

/**
 * Find usages of a crate/module in Rust source
 */
export function findCrateUsages(
  source: string,
  crateName: string,
  alias?: string
): string[] {
  const usages = new Set<string>();
  const names = [crateName];
  if (alias && alias !== crateName) names.push(alias);
  
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Match crate::function() or crate::Type
    const pattern = new RegExp(`\\b${escaped}::(\\w+)`, 'g');
    let match;
    
    while ((match = pattern.exec(source)) !== null) {
      usages.add(match[1]);
    }
  }
  
  return [...usages];
}

/**
 * Check if a crate is from the Rust standard library
 */
export function isStdLibrary(crateName: string): boolean {
  const stdCrates = new Set([
    'std', 'core', 'alloc', 'collections', 'proc_macro',
    'test', 'panic_abort', 'panic_unwind', 'profiler_builtins',
    'compiler_builtins', 'unwind'
  ]);
  return stdCrates.has(crateName);
}

/**
 * Normalize crate name (convert - to _)
 */
export function normalizeCrateName(name: string): string {
  return name.replace(/-/g, '_');
}

/**
 * Map common Rust crate aliases
 */
export const RUST_CRATE_ALIASES: Record<string, string> = {
  // Serde ecosystem
  'serde_json': 'serde-json',
  'serde_yaml': 'serde-yaml',
  // Async runtimes
  'tokio': 'tokio',
  'async_std': 'async-std',
  // Web frameworks
  'actix_web': 'actix-web',
  'rocket': 'rocket',
  'axum': 'axum',
  'warp': 'warp',
  // HTTP
  'reqwest': 'reqwest',
  'hyper': 'hyper',
  // Serialization
  'bincode': 'bincode',
  'toml': 'toml',
  // Error handling
  'anyhow': 'anyhow',
  'thiserror': 'thiserror',
  // Logging
  'log': 'log',
  'tracing': 'tracing',
  'env_logger': 'env-logger',
  // CLI
  'clap': 'clap',
  'structopt': 'structopt',
  // Regex
  'regex': 'regex',
  // Time
  'chrono': 'chrono',
  'time': 'time',
  // Random
  'rand': 'rand',
  // Crypto
  'ring': 'ring',
  'rustls': 'rustls',
};
