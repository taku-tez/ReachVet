/**
 * ReachVet Configuration File Support
 * 
 * Supports:
 * - .reachvetrc (JSON)
 * - .reachvetrc.json
 * - .reachvetrc.js
 * - .reachvetrc.cjs
 * - reachvet.config.js
 * - reachvet.config.cjs
 * - package.json "reachvet" field
 */

import * as fs from 'fs';
import * as path from 'path';

// Re-export schema utilities
export {
  generateConfigSchema,
  formatSchema,
  generateSchemaFile,
  generateConfigWithSchema,
  SUPPORTED_LANGUAGES,
  OUTPUT_FORMATS,
  FAIL_ON_OPTIONS
} from './schema.js';
export type { JSONSchemaType } from './schema.js';

export interface ReachVetConfig {
  // Analysis options
  language?: string;
  sbom?: string;
  ignorePaths?: string[];
  ignorePackages?: string[];
  ignoreVulnerabilities?: string[];
  
  // Output options
  output?: 'text' | 'json' | 'sarif';
  sarif?: boolean;
  html?: string;
  markdown?: string;
  graph?: string;
  dot?: string;
  dark?: boolean;
  
  // Vulnerability options
  osv?: boolean;
  osvCache?: string;
  
  // Watch mode options
  watch?: {
    debounce?: number;
    ignore?: string[];
    quiet?: boolean;
  };
  
  // Pre-commit options
  precommit?: {
    blockOnReachable?: boolean;
    skipNoStaged?: boolean;
    verbose?: boolean;
  };
  
  // Cache options
  cache?: {
    enabled?: boolean;
    ttl?: number;
    maxSize?: number;
    persist?: boolean;
    persistPath?: string;
  };
  
  // CI options
  ci?: {
    failOn?: 'vulnerable' | 'reachable' | 'none';
    annotations?: boolean;
  };
}

const CONFIG_FILES = [
  '.reachvetrc',
  '.reachvetrc.json',
  '.reachvetrc.js',
  '.reachvetrc.cjs',
  'reachvet.config.js',
  'reachvet.config.cjs',
];

/**
 * Load configuration from a specific file
 */
export function loadConfigFromFile(filePath: string): ReachVetConfig | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  const ext = path.extname(filePath);
  const basename = path.basename(filePath);
  
  try {
    if (ext === '.json' || basename === '.reachvetrc') {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
    
    if (ext === '.js' || ext === '.cjs') {
      // Clear require cache to allow reloading
      const absolutePath = path.resolve(filePath);
      delete require.cache[absolutePath];
      
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require(absolutePath);
      return loaded.default ?? loaded;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Load configuration from package.json "reachvet" field
 */
export function loadConfigFromPackageJson(dir: string): ReachVetConfig | null {
  const pkgPath = path.join(dir, 'package.json');
  
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.reachvet ?? null;
  } catch {
    return null;
  }
}

/**
 * Find and load configuration from the project directory
 * Searches in order: explicit file > config files > package.json
 */
export function loadConfig(dir: string, explicitConfigPath?: string): ReachVetConfig | null {
  // 1. Explicit config file takes precedence
  if (explicitConfigPath) {
    const configPath = path.isAbsolute(explicitConfigPath)
      ? explicitConfigPath
      : path.join(dir, explicitConfigPath);
    return loadConfigFromFile(configPath);
  }
  
  // 2. Search for config files in order
  for (const configFile of CONFIG_FILES) {
    const configPath = path.join(dir, configFile);
    const config = loadConfigFromFile(configPath);
    if (config) {
      return config;
    }
  }
  
  // 3. Check package.json "reachvet" field
  return loadConfigFromPackageJson(dir);
}

/**
 * Merge configurations (CLI options override config file)
 */
export function mergeConfig(
  fileConfig: ReachVetConfig | null,
  cliOptions: Partial<ReachVetConfig>
): ReachVetConfig {
  if (!fileConfig) {
    return cliOptions;
  }
  
  // Deep merge for nested objects
  const merged: ReachVetConfig = { ...fileConfig };
  
  // Override with CLI options (non-undefined values only)
  for (const [key, value] of Object.entries(cliOptions)) {
    if (value !== undefined) {
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        // Deep merge nested objects
        const existing = (merged as Record<string, unknown>)[key];
        if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
          (merged as Record<string, unknown>)[key] = { ...existing, ...value };
        } else {
          (merged as Record<string, unknown>)[key] = value;
        }
      } else {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }
  
  return merged;
}

/**
 * Validate configuration
 */
export function validateConfig(config: ReachVetConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate language
  const validLanguages = [
    'javascript', 'typescript', 'python', 'go', 'java', 'rust',
    'ruby', 'php', 'csharp', 'swift', 'kotlin', 'scala',
    'elixir', 'dart', 'perl', 'haskell', 'clojure', 'ocaml'
  ];
  if (config.language && !validLanguages.includes(config.language)) {
    errors.push(`Invalid language: ${config.language}. Valid options: ${validLanguages.join(', ')}`);
  }
  
  // Validate output
  const validOutputs = ['text', 'json', 'sarif'];
  if (config.output && !validOutputs.includes(config.output)) {
    errors.push(`Invalid output: ${config.output}. Valid options: ${validOutputs.join(', ')}`);
  }
  
  // Validate CI failOn
  const validFailOn = ['vulnerable', 'reachable', 'none'];
  if (config.ci?.failOn && !validFailOn.includes(config.ci.failOn)) {
    errors.push(`Invalid ci.failOn: ${config.ci.failOn}. Valid options: ${validFailOn.join(', ')}`);
  }
  
  // Validate paths exist (for sbom)
  if (config.sbom && !fs.existsSync(config.sbom)) {
    errors.push(`SBOM file not found: ${config.sbom}`);
  }
  
  // Validate cache TTL
  if (config.cache?.ttl !== undefined && config.cache.ttl < 0) {
    errors.push('cache.ttl must be a positive number');
  }
  
  // Validate cache maxSize
  if (config.cache?.maxSize !== undefined && config.cache.maxSize < 1) {
    errors.push('cache.maxSize must be at least 1');
  }
  
  // Validate watch debounce
  if (config.watch?.debounce !== undefined && config.watch.debounce < 0) {
    errors.push('watch.debounce must be a positive number');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Generate a sample configuration file
 */
export function generateSampleConfig(format: 'json' | 'js' = 'json'): string {
  const sampleConfig: ReachVetConfig = {
    language: 'javascript',
    ignorePaths: ['node_modules/**', 'dist/**', 'build/**'],
    ignorePackages: [],
    ignoreVulnerabilities: [],
    osv: true,
    cache: {
      enabled: true,
      ttl: 3600000,
      persist: false
    },
    watch: {
      debounce: 500,
      ignore: ['**/*.test.ts', '**/*.spec.ts'],
      quiet: false
    },
    ci: {
      failOn: 'vulnerable',
      annotations: true
    }
  };
  
  if (format === 'json') {
    return JSON.stringify(sampleConfig, null, 2);
  }
  
  // JavaScript format
  return `/** @type {import('reachvet').ReachVetConfig} */
module.exports = ${JSON.stringify(sampleConfig, null, 2)};
`;
}

/**
 * Find configuration file path (for reporting)
 */
export function findConfigPath(dir: string): string | null {
  for (const configFile of CONFIG_FILES) {
    const configPath = path.join(dir, configFile);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  
  // Check package.json
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const content = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      if (pkg.reachvet) {
        return pkgPath + ' (reachvet field)';
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  return null;
}
