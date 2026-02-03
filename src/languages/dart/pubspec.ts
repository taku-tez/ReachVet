/**
 * ReachVet - pubspec.yaml Parser for Dart/Flutter
 * 
 * Parses pubspec.yaml and pubspec.lock files
 */

import { readFile } from 'node:fs/promises';

export interface PubDependency {
  name: string;
  version: string;
  source?: 'hosted' | 'git' | 'path' | 'sdk';
  isDev: boolean;
}

/**
 * Parse pubspec.yaml file
 * Note: Simplified YAML parser for dependency extraction
 */
export function parsePubspecYaml(content: string): PubDependency[] {
  const deps: PubDependency[] = [];

  // Find dependencies section
  const depsMatch = content.match(/^dependencies:\s*\n((?:[ \t]+[^\n]+\n)*)/m);
  if (depsMatch) {
    const depsBlock = depsMatch[1];
    deps.push(...parseDepsBlock(depsBlock, false));
  }

  // Find dev_dependencies section
  const devDepsMatch = content.match(/^dev_dependencies:\s*\n((?:[ \t]+[^\n]+\n)*)/m);
  if (devDepsMatch) {
    const devDepsBlock = devDepsMatch[1];
    deps.push(...parseDepsBlock(devDepsBlock, true));
  }

  return deps;
}

/**
 * Parse a dependencies block
 */
function parseDepsBlock(block: string, isDev: boolean): PubDependency[] {
  const deps: PubDependency[] = [];
  const lines = block.split('\n');
  
  let currentDep: string | null = null;
  let currentVersion = '*';
  let currentSource: PubDependency['source'] = 'hosted';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check indentation level
    const indent = line.search(/\S/);

    // package_name: ^1.0.0
    const simpleMatch = line.match(/^\s{2}([a-z_][a-z0-9_]*):\s*(\^?[\d.]+[^\n#]*)/);
    if (simpleMatch) {
      if (currentDep) {
        deps.push({ name: currentDep, version: currentVersion, source: currentSource, isDev });
      }
      deps.push({ name: simpleMatch[1], version: simpleMatch[2].trim(), source: 'hosted', isDev });
      currentDep = null;
      continue;
    }

    // package_name:
    const startMatch = line.match(/^\s{2}([a-z_][a-z0-9_]*):\s*$/);
    if (startMatch) {
      if (currentDep) {
        deps.push({ name: currentDep, version: currentVersion, source: currentSource, isDev });
      }
      currentDep = startMatch[1];
      currentVersion = '*';
      currentSource = 'hosted';
      continue;
    }

    // Nested properties (git:, path:, version:, sdk:)
    if (currentDep && indent >= 4) {
      const versionMatch = trimmed.match(/^version:\s*(\S+)/);
      if (versionMatch) {
        currentVersion = versionMatch[1];
      }

      if (trimmed.startsWith('git:')) {
        currentSource = 'git';
      } else if (trimmed.startsWith('path:')) {
        currentSource = 'path';
      } else if (trimmed.startsWith('sdk:')) {
        currentSource = 'sdk';
      }

      const refMatch = trimmed.match(/^ref:\s*(\S+)/);
      if (refMatch && currentSource === 'git') {
        currentVersion = refMatch[1];
      }
    }
  }

  // Don't forget last dep
  if (currentDep) {
    deps.push({ name: currentDep, version: currentVersion, source: currentSource, isDev });
  }

  return deps;
}

/**
 * Parse pubspec.lock file
 */
export function parsePubspecLock(content: string): PubDependency[] {
  const deps: PubDependency[] = [];

  // Match package entries
  // package_name:
  //   dependency: "direct main"
  //   source: hosted
  //   version: "1.0.0"
  const packageRegex = /^\s{2}([a-z_][a-z0-9_]*):\s*\n((?:\s{4}[^\n]+\n)+)/gm;

  let match;
  while ((match = packageRegex.exec(content)) !== null) {
    const name = match[1];
    const block = match[2];

    const versionMatch = block.match(/version:\s*"([^"]+)"/);
    const sourceMatch = block.match(/source:\s*(\w+)/);
    const depTypeMatch = block.match(/dependency:\s*"([^"]+)"/);

    const version = versionMatch ? versionMatch[1] : '*';
    const source = sourceMatch ? sourceMatch[1] as PubDependency['source'] : 'hosted';
    const isDev = depTypeMatch ? depTypeMatch[1].includes('dev') : false;

    deps.push({ name, version, source, isDev });
  }

  return deps;
}

/**
 * Read and parse pubspec.yaml
 */
export async function readPubspecYaml(filePath: string): Promise<PubDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parsePubspecYaml(content);
}

/**
 * Get project name from pubspec.yaml
 */
export function getProjectName(content: string): string | null {
  const match = content.match(/^name:\s*(\S+)/m);
  return match ? match[1] : null;
}

/**
 * Get SDK version constraint
 */
export function getSdkVersion(content: string): string | null {
  const envMatch = content.match(/^environment:\s*\n((?:\s+[^\n]+\n)*)/m);
  if (!envMatch) return null;

  const sdkMatch = envMatch[1].match(/sdk:\s*['"]?([^'"}\n]+)/);
  return sdkMatch ? sdkMatch[1].trim() : null;
}

/**
 * Check if it's a Flutter project
 */
export function isFlutterProject(content: string): boolean {
  return content.includes('flutter:') || 
         content.includes("sdk: flutter") ||
         content.includes('flutter_test:');
}

/**
 * Get Flutter SDK constraint
 */
export function getFlutterVersion(content: string): string | null {
  const envMatch = content.match(/^environment:\s*\n((?:\s+[^\n]+\n)*)/m);
  if (!envMatch) return null;

  const flutterMatch = envMatch[1].match(/flutter:\s*['"]?([^'"}\n]+)/);
  return flutterMatch ? flutterMatch[1].trim() : null;
}
