/**
 * ReachVet - Mix Parser for Elixir
 * 
 * Parses mix.exs and mix.lock files
 */

import { readFile } from 'node:fs/promises';

export interface MixDependency {
  name: string;
  version: string;
  source?: 'hex' | 'git' | 'path';
  only?: string[]; // :dev, :test, etc.
}

/**
 * Parse mix.exs file
 */
export function parseMixExs(content: string): MixDependency[] {
  const deps: MixDependency[] = [];

  // Find deps function content
  const depsMatch = content.match(/defp?\s+deps\s*(?:\([^)]*\))?\s*do\s*\[([\s\S]*?)\]\s*end/);
  if (!depsMatch) {
    // Try simpler pattern for inline deps
    const inlineMatch = content.match(/deps:\s*\[([\s\S]*?)\]/);
    if (inlineMatch) {
      return parseDepsBlock(inlineMatch[1]);
    }
    return deps;
  }

  return parseDepsBlock(depsMatch[1]);
}

/**
 * Parse deps block content
 */
function parseDepsBlock(depsContent: string): MixDependency[] {
  const deps: MixDependency[] = [];

  // Match {:package, "~> 1.0"} or {:package, "~> 1.0", only: :test}
  // Also match {:package, git: "url", tag: "v1.0"}
  const depRegex = /\{\s*:([a-z_][a-z0-9_]*)\s*,\s*(?:"([^"]+)"|([^}]+))\}/gi;

  let match;
  while ((match = depRegex.exec(depsContent)) !== null) {
    const name = match[1];
    let version = match[2] || '*';
    const opts = match[3] || '';

    // Parse options
    let source: MixDependency['source'] = 'hex';
    const only: string[] = [];

    if (opts.includes('git:')) {
      source = 'git';
      const tagMatch = opts.match(/tag:\s*"([^"]+)"/);
      const branchMatch = opts.match(/branch:\s*"([^"]+)"/);
      version = tagMatch?.[1] || branchMatch?.[1] || 'git';
    } else if (opts.includes('path:')) {
      source = 'path';
      version = 'local';
    }

    // Parse only: option
    const onlyMatch = (match[2] ? depsContent.slice(match.index) : opts).match(/only:\s*(?::(\w+)|\[([^\]]+)\])/);
    if (onlyMatch) {
      if (onlyMatch[1]) {
        only.push(onlyMatch[1]);
      } else if (onlyMatch[2]) {
        const envs = onlyMatch[2].match(/:(\w+)/g);
        if (envs) {
          only.push(...envs.map(e => e.slice(1)));
        }
      }
    }

    deps.push({
      name,
      version,
      source,
      only: only.length > 0 ? only : undefined
    });
  }

  return deps;
}

/**
 * Parse mix.lock file
 */
export function parseMixLock(content: string): MixDependency[] {
  const deps: MixDependency[] = [];

  // Match "package_name": {:hex, :package_name, "1.0.0", ...}
  // Also match "package_name": {:git, "url", "ref", ...}
  const lockRegex = /"([a-z_][a-z0-9_]*)"\s*:\s*\{:(\w+),\s*(?::([a-z_][a-z0-9_]*)|"([^"]+)")\s*,\s*"([^"]+)"/gi;

  let match;
  while ((match = lockRegex.exec(content)) !== null) {
    const name = match[1];
    const source = match[2] as MixDependency['source'];
    const version = match[5];

    deps.push({
      name,
      version,
      source
    });
  }

  return deps;
}

/**
 * Read and parse mix.exs
 */
export async function readMixExs(filePath: string): Promise<MixDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseMixExs(content);
}

/**
 * Get Elixir version from mix.exs
 */
export function getElixirVersion(content: string): string | null {
  const match = content.match(/elixir:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Get OTP application name
 */
export function getAppName(content: string): string | null {
  const match = content.match(/app:\s*:([a-z_][a-z0-9_]*)/);
  return match ? match[1] : null;
}

/**
 * Check if it's an umbrella project
 */
export function isUmbrellaProject(content: string): boolean {
  return content.includes('apps_path:') || content.includes('in_umbrella:');
}

/**
 * Get extra applications
 */
export function getExtraApplications(content: string): string[] {
  const match = content.match(/extra_applications:\s*\[([^\]]+)\]/);
  if (!match) return [];

  const apps: string[] = [];
  const appRegex = /:([a-z_][a-z0-9_]*)/g;
  let appMatch;
  while ((appMatch = appRegex.exec(match[1])) !== null) {
    apps.push(appMatch[1]);
  }
  return apps;
}
