/**
 * ReachVet - Gemfile/Gemfile.lock Parser
 * 
 * Parses Ruby dependency files:
 * - Gemfile (gem declarations)
 * - Gemfile.lock (resolved versions)
 */

import { readFile } from 'node:fs/promises';

export interface GemDependency {
  name: string;
  version?: string;
  groups?: string[];
  source?: string;
  git?: string;
  path?: string;
  require?: string | boolean;
}

export interface GemfileLockInfo {
  gems: Map<string, string>; // name -> version
  platforms: string[];
  rubyVersion?: string;
  bundlerVersion?: string;
}

/**
 * Parse Gemfile content
 */
export function parseGemfile(content: string): GemDependency[] {
  const dependencies: GemDependency[] = [];
  const lines = content.split('\n');
  
  let currentGroup: string[] = [];
  let inGroup = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || !trimmed) continue;

    // Handle group blocks
    const groupMatch = trimmed.match(/^group\s+(.+?)\s+do/);
    if (groupMatch) {
      const groupsStr = groupMatch[1];
      // Parse :development, :test or [:development, :test]
      currentGroup = groupsStr
        .replace(/[\[\]]/g, '')
        .split(/[,\s]+/)
        .filter(g => g.startsWith(':'))
        .map(g => g.slice(1));
      inGroup = true;
      continue;
    }

    if (trimmed === 'end' && inGroup) {
      currentGroup = [];
      inGroup = false;
      continue;
    }

    // Parse gem declaration
    const gemMatch = trimmed.match(/^gem\s+['"]([^'"]+)['"](.*)?/);
    if (gemMatch) {
      const dep: GemDependency = {
        name: gemMatch[1],
      };

      if (currentGroup.length > 0) {
        dep.groups = [...currentGroup];
      }

      // Parse options
      const optionsStr = gemMatch[2] || '';
      
      // Version constraint: gem 'rails', '~> 7.0'
      const versionMatch = optionsStr.match(/,\s*['"]([^'"]+)['"]/);
      if (versionMatch) {
        dep.version = versionMatch[1];
      }

      // Git source: gem 'rails', git: 'https://...'
      const gitMatch = optionsStr.match(/git:\s*['"]([^'"]+)['"]/);
      if (gitMatch) {
        dep.git = gitMatch[1];
      }

      // Path source: gem 'local', path: './local'
      const pathMatch = optionsStr.match(/path:\s*['"]([^'"]+)['"]/);
      if (pathMatch) {
        dep.path = pathMatch[1];
      }

      // Group inline: gem 'rspec', group: :test
      const inlineGroupMatch = optionsStr.match(/group:\s*(\[.+?\]|:\w+)/);
      if (inlineGroupMatch) {
        const groupsStr = inlineGroupMatch[1];
        const groups = groupsStr
          .replace(/[\[\]]/g, '')
          .split(/[,\s]+/)
          .filter(g => g.startsWith(':'))
          .map(g => g.slice(1));
        dep.groups = [...(dep.groups || []), ...groups];
      }

      // Require option: gem 'sass-rails', require: 'sass'
      const requireMatch = optionsStr.match(/require:\s*(false|true|['"][^'"]+['"])/);
      if (requireMatch) {
        const val = requireMatch[1];
        if (val === 'false') dep.require = false;
        else if (val === 'true') dep.require = true;
        else dep.require = val.replace(/['"]/g, '');
      }

      dependencies.push(dep);
    }
  }

  return dependencies;
}

/**
 * Parse Gemfile.lock content
 */
export function parseGemfileLock(content: string): GemfileLockInfo {
  const result: GemfileLockInfo = {
    gems: new Map(),
    platforms: [],
  };

  const lines = content.split('\n');
  let section = '';

  for (const line of lines) {
    // Section headers
    if (line === 'GEM' || line === 'GIT' || line === 'PATH' || 
        line === 'PLATFORMS' || line === 'DEPENDENCIES' || 
        line === 'RUBY VERSION' || line === 'BUNDLED WITH') {
      section = line;
      continue;
    }

    // GEM section - parse specs
    if (section === 'GEM') {
      // Gem spec line: "    rails (7.0.4)"
      const specMatch = line.match(/^\s{4}(\S+)\s+\(([^)]+)\)/);
      if (specMatch) {
        result.gems.set(specMatch[1], specMatch[2]);
      }
    }

    // GIT section - parse specs  
    if (section === 'GIT') {
      const specMatch = line.match(/^\s{4}(\S+)\s+\(([^)]+)\)/);
      if (specMatch) {
        result.gems.set(specMatch[1], specMatch[2]);
      }
    }

    // PATH section - parse specs
    if (section === 'PATH') {
      const specMatch = line.match(/^\s{4}(\S+)\s+\(([^)]+)\)/);
      if (specMatch) {
        result.gems.set(specMatch[1], specMatch[2]);
      }
    }

    // PLATFORMS section
    if (section === 'PLATFORMS') {
      const platform = line.trim();
      if (platform && !platform.startsWith(' ')) {
        result.platforms.push(platform);
      }
    }

    // RUBY VERSION section
    if (section === 'RUBY VERSION') {
      const rubyMatch = line.match(/ruby\s+(\S+)/i);
      if (rubyMatch) {
        result.rubyVersion = rubyMatch[1];
      }
    }

    // BUNDLED WITH section
    if (section === 'BUNDLED WITH') {
      const version = line.trim();
      if (version && /^\d/.test(version)) {
        result.bundlerVersion = version;
      }
    }
  }

  return result;
}

/**
 * Read and parse Gemfile
 */
export async function readGemfile(filePath: string): Promise<GemDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseGemfile(content);
}

/**
 * Read and parse Gemfile.lock
 */
export async function readGemfileLock(filePath: string): Promise<GemfileLockInfo> {
  const content = await readFile(filePath, 'utf-8');
  return parseGemfileLock(content);
}
