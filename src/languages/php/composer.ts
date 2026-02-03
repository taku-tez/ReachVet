/**
 * ReachVet - Composer.json/lock Parser
 */

import { readFile } from 'node:fs/promises';

export interface ComposerDependency {
  name: string;
  version: string;
  type?: 'require' | 'require-dev';
}

export interface ComposerJson {
  name?: string;
  description?: string;
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
  autoload?: {
    'psr-4'?: Record<string, string | string[]>;
    'psr-0'?: Record<string, string | string[]>;
    classmap?: string[];
    files?: string[];
  };
}

export interface ComposerLock {
  packages: Array<{
    name: string;
    version: string;
    type?: string;
    autoload?: ComposerJson['autoload'];
  }>;
  'packages-dev'?: Array<{
    name: string;
    version: string;
    type?: string;
  }>;
}

/**
 * Parse composer.json content
 */
export function parseComposerJson(content: string): ComposerJson {
  return JSON.parse(content) as ComposerJson;
}

/**
 * Parse composer.lock content
 */
export function parseComposerLock(content: string): ComposerLock {
  return JSON.parse(content) as ComposerLock;
}

/**
 * Get dependencies from composer.json
 */
export function getDependencies(composerJson: ComposerJson): ComposerDependency[] {
  const deps: ComposerDependency[] = [];

  if (composerJson.require) {
    for (const [name, version] of Object.entries(composerJson.require)) {
      // Skip PHP version and extensions
      if (name === 'php' || name.startsWith('ext-')) continue;
      deps.push({ name, version, type: 'require' });
    }
  }

  if (composerJson['require-dev']) {
    for (const [name, version] of Object.entries(composerJson['require-dev'])) {
      if (name === 'php' || name.startsWith('ext-')) continue;
      deps.push({ name, version, type: 'require-dev' });
    }
  }

  return deps;
}

/**
 * Get resolved dependencies from composer.lock
 */
export function getLockedDependencies(composerLock: ComposerLock): ComposerDependency[] {
  const deps: ComposerDependency[] = [];

  for (const pkg of composerLock.packages) {
    deps.push({
      name: pkg.name,
      version: pkg.version.replace(/^v/, ''), // Remove 'v' prefix
      type: 'require'
    });
  }

  if (composerLock['packages-dev']) {
    for (const pkg of composerLock['packages-dev']) {
      deps.push({
        name: pkg.name,
        version: pkg.version.replace(/^v/, ''),
        type: 'require-dev'
      });
    }
  }

  return deps;
}

/**
 * Get PSR-4 autoload mappings
 */
export function getAutoloadMappings(composerJson: ComposerJson): Map<string, string[]> {
  const mappings = new Map<string, string[]>();

  if (composerJson.autoload?.['psr-4']) {
    for (const [namespace, paths] of Object.entries(composerJson.autoload['psr-4'])) {
      const pathArray = Array.isArray(paths) ? paths : [paths];
      mappings.set(namespace.replace(/\\$/, ''), pathArray);
    }
  }

  if (composerJson.autoload?.['psr-0']) {
    for (const [namespace, paths] of Object.entries(composerJson.autoload['psr-0'])) {
      const pathArray = Array.isArray(paths) ? paths : [paths];
      mappings.set(namespace.replace(/\\$/, ''), pathArray);
    }
  }

  return mappings;
}

/**
 * Read and parse composer.json
 */
export async function readComposerJson(filePath: string): Promise<ComposerJson> {
  const content = await readFile(filePath, 'utf-8');
  return parseComposerJson(content);
}

/**
 * Read and parse composer.lock
 */
export async function readComposerLock(filePath: string): Promise<ComposerLock> {
  const content = await readFile(filePath, 'utf-8');
  return parseComposerLock(content);
}
