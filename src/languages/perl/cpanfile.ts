/**
 * ReachVet - cpanfile/META.json Parser for Perl
 * 
 * Parses cpanfile, META.json, and Makefile.PL files
 */

import { readFile } from 'node:fs/promises';

export interface CpanDependency {
  name: string;
  version: string;
  phase: 'runtime' | 'build' | 'test' | 'develop' | 'configure';
  relationship: 'requires' | 'recommends' | 'suggests';
}

/**
 * Parse cpanfile
 */
export function parseCpanfile(content: string): CpanDependency[] {
  const deps: CpanDependency[] = [];

  // Current phase context
  let currentPhase: CpanDependency['phase'] = 'runtime';

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // on 'test' => sub { ... }
    const phaseMatch = trimmed.match(/^on\s+['"](\w+)['"]/);
    if (phaseMatch) {
      currentPhase = phaseMatch[1] as CpanDependency['phase'];
      continue;
    }

    // requires 'Module', '1.0';
    // requires 'Module';
    const requiresMatch = trimmed.match(/^(requires|recommends|suggests)\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
    if (requiresMatch) {
      deps.push({
        name: requiresMatch[2],
        version: requiresMatch[3] || '*',
        phase: currentPhase,
        relationship: requiresMatch[1] as CpanDependency['relationship']
      });
      continue;
    }

    // Reset phase when closing block
    if (trimmed === '};') {
      currentPhase = 'runtime';
    }
  }

  return deps;
}

/**
 * Parse META.json
 */
export function parseMetaJson(content: string): CpanDependency[] {
  const deps: CpanDependency[] = [];

  try {
    const meta = JSON.parse(content);
    const prereqs = meta.prereqs || {};

    for (const [phase, relationships] of Object.entries(prereqs)) {
      for (const [rel, modules] of Object.entries(relationships as Record<string, Record<string, string>>)) {
        for (const [name, version] of Object.entries(modules)) {
          deps.push({
            name,
            version: version || '*',
            phase: phase as CpanDependency['phase'],
            relationship: rel as CpanDependency['relationship']
          });
        }
      }
    }
  } catch {
    // Invalid JSON
  }

  return deps;
}

/**
 * Parse META.yml (simplified)
 */
export function parseMetaYaml(content: string): CpanDependency[] {
  const deps: CpanDependency[] = [];

  // Simple parsing of requires section
  const requiresMatch = content.match(/^requires:\s*\n((?:\s+[^\n]+\n)*)/m);
  if (requiresMatch) {
    const lines = requiresMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^\s+([A-Za-z][A-Za-z0-9_:]+):\s*['"]?([^'"\n]+)?/);
      if (match) {
        deps.push({
          name: match[1],
          version: match[2]?.trim() || '*',
          phase: 'runtime',
          relationship: 'requires'
        });
      }
    }
  }

  // Build requires
  const buildMatch = content.match(/^build_requires:\s*\n((?:\s+[^\n]+\n)*)/m);
  if (buildMatch) {
    const lines = buildMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^\s+([A-Za-z][A-Za-z0-9_:]+):\s*['"]?([^'"\n]+)?/);
      if (match) {
        deps.push({
          name: match[1],
          version: match[2]?.trim() || '*',
          phase: 'build',
          relationship: 'requires'
        });
      }
    }
  }

  return deps;
}

/**
 * Parse Makefile.PL (simplified)
 */
export function parseMakefilePL(content: string): CpanDependency[] {
  const deps: CpanDependency[] = [];

  // PREREQ_PM => { 'Module' => '1.0' }
  const prereqMatch = content.match(/PREREQ_PM\s*=>\s*\{([^}]+)\}/);
  if (prereqMatch) {
    const entries = prereqMatch[1].matchAll(/['"]([A-Za-z][A-Za-z0-9_:]+)['"]\s*=>\s*['"]?([^,'"}]+)/g);
    for (const entry of entries) {
      deps.push({
        name: entry[1],
        version: entry[2].trim() || '*',
        phase: 'runtime',
        relationship: 'requires'
      });
    }
  }

  // BUILD_REQUIRES => { 'Module' => '1.0' }
  const buildMatch = content.match(/BUILD_REQUIRES\s*=>\s*\{([^}]+)\}/);
  if (buildMatch) {
    const entries = buildMatch[1].matchAll(/['"]([A-Za-z][A-Za-z0-9_:]+)['"]\s*=>\s*['"]?([^,'"}]+)/g);
    for (const entry of entries) {
      deps.push({
        name: entry[1],
        version: entry[2].trim() || '*',
        phase: 'build',
        relationship: 'requires'
      });
    }
  }

  // TEST_REQUIRES => { 'Module' => '1.0' }
  const testMatch = content.match(/TEST_REQUIRES\s*=>\s*\{([^}]+)\}/);
  if (testMatch) {
    const entries = testMatch[1].matchAll(/['"]([A-Za-z][A-Za-z0-9_:]+)['"]\s*=>\s*['"]?([^,'"}]+)/g);
    for (const entry of entries) {
      deps.push({
        name: entry[1],
        version: entry[2].trim() || '*',
        phase: 'test',
        relationship: 'requires'
      });
    }
  }

  return deps;
}

/**
 * Read and parse cpanfile
 */
export async function readCpanfile(filePath: string): Promise<CpanDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseCpanfile(content);
}

/**
 * Get distribution name from META.json
 */
export function getDistName(content: string): string | null {
  try {
    const meta = JSON.parse(content);
    return meta.name || null;
  } catch {
    return null;
  }
}

/**
 * Get Perl version requirement
 */
export function getPerlVersion(content: string): string | null {
  // From cpanfile: requires 'perl', '5.016';
  const cpanMatch = content.match(/requires\s+['"]perl['"]\s*,\s*['"]([^'"]+)['"]/);
  if (cpanMatch) {
    return cpanMatch[1];
  }

  // From META.json
  try {
    const meta = JSON.parse(content);
    return meta.prereqs?.runtime?.requires?.perl || null;
  } catch {
    return null;
  }
}
