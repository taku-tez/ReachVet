/**
 * ReachVet - Ignore File Support
 * 
 * Supports .reachvetignore files with gitignore-style patterns
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import picomatch from 'picomatch';

export interface IgnorePattern {
  /** The pattern string */
  pattern: string;
  /** Whether this is a negation pattern (!pattern) */
  negated: boolean;
  /** The matcher function */
  matcher: (path: string) => boolean;
  /** Source file where this pattern was defined */
  source: string;
  /** Line number in source file */
  line: number;
}

export interface IgnoreConfig {
  /** Loaded patterns */
  patterns: IgnorePattern[];
  /** Source files that were loaded */
  sources: string[];
  /** Root directory for relative path matching */
  rootDir: string;
}

/**
 * Default ignore file names (in priority order)
 */
export const DEFAULT_IGNORE_FILES = [
  '.reachvetignore',
  '.gitignore'
];

/**
 * Parse a single line from an ignore file
 */
export function parseIgnoreLine(
  line: string, 
  lineNumber: number,
  source: string
): IgnorePattern | null {
  // Trim whitespace
  const trimmed = line.trim();
  
  // Skip empty lines
  if (trimmed.length === 0) {
    return null;
  }
  
  // Skip comments
  if (trimmed.startsWith('#')) {
    return null;
  }
  
  // Check for negation
  let pattern = trimmed;
  let negated = false;
  
  if (trimmed.startsWith('!')) {
    negated = true;
    pattern = trimmed.slice(1);
  }
  
  // Handle escaped characters
  pattern = pattern.replace(/\\(.)/g, '$1');
  
  // Skip if pattern is empty after processing
  if (pattern.length === 0) {
    return null;
  }
  
  // Create matcher with picomatch options for gitignore compatibility
  const matcherOptions: picomatch.PicomatchOptions = {
    dot: true,  // Match dotfiles
    matchBase: !pattern.includes('/'),  // Match basename if no slash
    nobrace: false,  // Support brace expansion
    noext: false,  // Support extglob
    nonegate: true,  // We handle negation ourselves
    nocase: process.platform === 'win32',  // Case-insensitive on Windows
  };
  
  // If pattern ends with /, match directory contents
  if (pattern.endsWith('/')) {
    pattern = pattern + '**';
  }
  
  // If pattern starts with /, it's relative to root
  if (pattern.startsWith('/')) {
    pattern = pattern.slice(1);
  } else if (!pattern.includes('/')) {
    // Pattern without slash matches anywhere
    pattern = '**/' + pattern;
  }
  
  const matcher = picomatch(pattern, matcherOptions);
  
  return {
    pattern: trimmed,
    negated,
    matcher,
    source,
    line: lineNumber
  };
}

/**
 * Parse an ignore file content
 */
export function parseIgnoreFile(
  content: string,
  source: string
): IgnorePattern[] {
  const lines = content.split('\n');
  const patterns: IgnorePattern[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseIgnoreLine(lines[i], i + 1, source);
    if (parsed) {
      patterns.push(parsed);
    }
  }
  
  return patterns;
}

/**
 * Load ignore configuration from a directory
 */
export async function loadIgnoreConfig(
  rootDir: string,
  customFile?: string
): Promise<IgnoreConfig> {
  const patterns: IgnorePattern[] = [];
  const sources: string[] = [];
  const resolvedRoot = resolve(rootDir);
  
  // If custom file is specified, only use that
  if (customFile) {
    const customPath = resolve(rootDir, customFile);
    if (existsSync(customPath)) {
      const content = await readFile(customPath, 'utf-8');
      const parsed = parseIgnoreFile(content, customPath);
      patterns.push(...parsed);
      sources.push(customPath);
    }
    return { patterns, sources, rootDir: resolvedRoot };
  }
  
  // Otherwise, look for default ignore files
  for (const filename of DEFAULT_IGNORE_FILES) {
    const filePath = join(resolvedRoot, filename);
    if (existsSync(filePath)) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const parsed = parseIgnoreFile(content, filePath);
        patterns.push(...parsed);
        sources.push(filePath);
        
        // Only use the first found file (.reachvetignore takes priority)
        break;
      } catch {
        // Skip unreadable files
      }
    }
  }
  
  return { patterns, sources, rootDir: resolvedRoot };
}

/**
 * Check if a path should be ignored
 */
export function shouldIgnore(
  filePath: string,
  config: IgnoreConfig
): boolean {
  // Get relative path from root
  const absolutePath = resolve(filePath);
  const relativePath = relative(config.rootDir, absolutePath);
  
  // Skip files outside root
  if (relativePath.startsWith('..')) {
    return false;
  }
  
  // Normalize path separators for cross-platform compatibility
  const normalizedPath = relativePath.split('\\').join('/');
  
  // Apply patterns in order (later patterns override earlier ones)
  let ignored = false;
  
  for (const pattern of config.patterns) {
    if (pattern.matcher(normalizedPath)) {
      ignored = !pattern.negated;
    }
  }
  
  return ignored;
}

/**
 * Filter a list of files using ignore configuration
 */
export function filterIgnored(
  files: string[],
  config: IgnoreConfig
): string[] {
  return files.filter(file => !shouldIgnore(file, config));
}

/**
 * Get ignore statistics
 */
export function getIgnoreStats(
  files: string[],
  config: IgnoreConfig
): {
  total: number;
  ignored: number;
  kept: number;
  ignoredFiles: string[];
} {
  const ignoredFiles: string[] = [];
  
  for (const file of files) {
    if (shouldIgnore(file, config)) {
      ignoredFiles.push(file);
    }
  }
  
  return {
    total: files.length,
    ignored: ignoredFiles.length,
    kept: files.length - ignoredFiles.length,
    ignoredFiles
  };
}

/**
 * Create an empty ignore config (ignores nothing)
 */
export function createEmptyConfig(rootDir: string): IgnoreConfig {
  return {
    patterns: [],
    sources: [],
    rootDir: resolve(rootDir)
  };
}

/**
 * Add patterns programmatically to a config
 */
export function addPatterns(
  config: IgnoreConfig,
  patterns: string[],
  source: string = '<programmatic>'
): IgnoreConfig {
  const newPatterns = patterns
    .map((p, i) => parseIgnoreLine(p, i + 1, source))
    .filter((p): p is IgnorePattern => p !== null);
  
  return {
    ...config,
    patterns: [...config.patterns, ...newPatterns],
    sources: [...config.sources, source]
  };
}

/**
 * Merge multiple ignore configs
 */
export function mergeConfigs(
  configs: IgnoreConfig[]
): IgnoreConfig {
  if (configs.length === 0) {
    return createEmptyConfig('.');
  }
  
  const patterns: IgnorePattern[] = [];
  const sources: string[] = [];
  
  for (const config of configs) {
    patterns.push(...config.patterns);
    sources.push(...config.sources);
  }
  
  return {
    patterns,
    sources: [...new Set(sources)],
    rootDir: configs[0].rootDir
  };
}

/**
 * Generate a sample .reachvetignore file content
 */
export function generateSampleIgnoreFile(): string {
  return `# ReachVet Ignore File
# Patterns follow gitignore syntax

# Dependencies
node_modules/
vendor/
.venv/
__pycache__/

# Build outputs
dist/
build/
out/
target/
*.min.js
*.bundle.js

# IDE and editor files
.idea/
.vscode/
*.swp
*.swo
*~

# Test fixtures and mocks
__tests__/fixtures/
__mocks__/
test/fixtures/
spec/fixtures/

# Generated files
*.generated.*
*.auto.*

# Large data files
*.csv
*.json.gz
*.sql

# Logs
*.log
logs/

# Coverage reports
coverage/
.nyc_output/

# Example: Negate a pattern to include a specific file
# !important-config.json
`;
}
