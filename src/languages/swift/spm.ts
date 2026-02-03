/**
 * ReachVet - Swift Package Manager Parser
 * 
 * Parses Package.swift, Podfile, Cartfile, and Package.resolved
 */

import { readFile } from 'node:fs/promises';

export interface SwiftDependency {
  name: string;
  version: string;
  source?: 'spm' | 'cocoapods' | 'carthage';
  url?: string;
}

/**
 * Parse Package.swift
 * Note: This is a simplified parser as Package.swift is actual Swift code
 */
export function parsePackageSwift(content: string): SwiftDependency[] {
  const deps: SwiftDependency[] = [];

  // Match .package(url: "...", from: "...") or .package(url: "...", .upToNextMajor(from: "..."))
  const packageRegex = /\.package\s*\(\s*(?:name:\s*"([^"]+)",\s*)?url:\s*"([^"]+)"[^)]*(?:from:\s*"([^"]+)"|exact:\s*"([^"]+)"|\.upToNextMajor\s*\(\s*from:\s*"([^"]+)"\)|\.upToNextMinor\s*\(\s*from:\s*"([^"]+)"\)|branch:\s*"([^"]+)"|revision:\s*"([^"]+)")/g;

  let match;
  while ((match = packageRegex.exec(content)) !== null) {
    const url = match[2];
    const version = match[3] || match[4] || match[5] || match[6] || match[7] || match[8] || '*';
    
    // Extract package name from URL
    let name = match[1];
    if (!name) {
      // Try to extract from URL like https://github.com/Alamofire/Alamofire.git
      const urlMatch = url.match(/\/([^\/]+?)(?:\.git)?$/);
      name = urlMatch ? urlMatch[1] : url;
    }

    deps.push({
      name,
      version,
      source: 'spm',
      url
    });
  }

  // Also match .package(name: "...", path: "...") for local packages
  const localPackageRegex = /\.package\s*\(\s*name:\s*"([^"]+)"\s*,\s*path:\s*"([^"]+)"\s*\)/g;
  while ((match = localPackageRegex.exec(content)) !== null) {
    deps.push({
      name: match[1],
      version: 'local',
      source: 'spm',
      url: match[2]
    });
  }

  return deps;
}

/**
 * Parse Package.resolved (SPM lockfile)
 */
export function parsePackageResolved(content: string): SwiftDependency[] {
  const deps: SwiftDependency[] = [];

  try {
    const resolved = JSON.parse(content);
    
    // V2 format (Swift 5.6+)
    if (resolved.pins) {
      for (const pin of resolved.pins) {
        deps.push({
          name: pin.identity || pin.package,
          version: pin.state?.version || pin.state?.revision || '*',
          source: 'spm',
          url: pin.location
        });
      }
    }
    
    // V1 format
    if (resolved.object?.pins) {
      for (const pin of resolved.object.pins) {
        deps.push({
          name: pin.package,
          version: pin.state?.version || pin.state?.revision || '*',
          source: 'spm',
          url: pin.repositoryURL
        });
      }
    }
  } catch {
    // Invalid JSON
  }

  return deps;
}

/**
 * Parse Podfile (CocoaPods)
 */
export function parsePodfile(content: string): SwiftDependency[] {
  const deps: SwiftDependency[] = [];

  // Match pod 'Name', '~> 1.0' or pod 'Name', :git => '...'
  const podRegex = /^\s*pod\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/gm;

  let match;
  while ((match = podRegex.exec(content)) !== null) {
    deps.push({
      name: match[1],
      version: match[2] || '*',
      source: 'cocoapods'
    });
  }

  return deps;
}

/**
 * Parse Podfile.lock
 */
export function parsePodfileLock(content: string): SwiftDependency[] {
  const deps: SwiftDependency[] = [];

  // Match " - PodName (1.0.0)" or " - PodName (1.0.0):"
  const podRegex = /^\s+-\s+([A-Za-z0-9_.-]+)(?:\/[A-Za-z0-9_.-]+)?\s+\(([^)]+)\)/gm;

  let match;
  while ((match = podRegex.exec(content)) !== null) {
    // Avoid duplicates
    const name = match[1];
    if (!deps.find(d => d.name === name)) {
      deps.push({
        name,
        version: match[2],
        source: 'cocoapods'
      });
    }
  }

  return deps;
}

/**
 * Parse Cartfile (Carthage)
 */
export function parseCartfile(content: string): SwiftDependency[] {
  const deps: SwiftDependency[] = [];

  // Match github "Owner/Repo" ~> 1.0 or github "Owner/Repo" == 1.0.0 or git "url" "branch"
  const cartfileRegex = /^\s*(?:github|git|binary)\s+["']([^"']+)["'](?:\s+(?:~>|==|>=|")\s*["']?([^"'\s]+)["']?)?/gm;

  let match;
  while ((match = cartfileRegex.exec(content)) !== null) {
    const source = match[1];
    const version = match[2] || '*';
    
    // Extract name from github "Owner/Repo" format
    let name: string;
    if (source.includes('/')) {
      const parts = source.split('/');
      name = parts[parts.length - 1].replace('.git', '');
    } else {
      name = source.replace('.git', '');
    }

    deps.push({
      name,
      version,
      source: 'carthage',
      url: source.includes('://') ? source : `https://github.com/${source}`
    });
  }

  return deps;
}

/**
 * Parse Cartfile.resolved
 */
export function parseCartfileResolved(content: string): SwiftDependency[] {
  const deps: SwiftDependency[] = [];

  // Match github "Owner/Repo" "v1.0.0"
  const resolvedRegex = /^\s*(?:github|git|binary)\s+["']([^"']+)["']\s+["']([^"']+)["']/gm;

  let match;
  while ((match = resolvedRegex.exec(content)) !== null) {
    const source = match[1];
    const version = match[2];
    
    let name: string;
    if (source.includes('/')) {
      const parts = source.split('/');
      name = parts[parts.length - 1].replace('.git', '');
    } else {
      name = source.replace('.git', '');
    }

    deps.push({
      name,
      version,
      source: 'carthage',
      url: source.includes('://') ? source : `https://github.com/${source}`
    });
  }

  return deps;
}

/**
 * Read and parse Package.swift
 */
export async function readPackageSwift(filePath: string): Promise<SwiftDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parsePackageSwift(content);
}

/**
 * Read and parse Podfile
 */
export async function readPodfile(filePath: string): Promise<SwiftDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parsePodfile(content);
}

/**
 * Get target platform from Package.swift
 */
export function getTargetPlatform(content: string): string[] {
  const platforms: string[] = [];
  
  // Match .iOS(.v15), .macOS(.v12), etc.
  const platformRegex = /\.(iOS|macOS|tvOS|watchOS|visionOS)\s*\(\s*\.v(\d+)/g;
  
  let match;
  while ((match = platformRegex.exec(content)) !== null) {
    platforms.push(`${match[1]} ${match[2]}+`);
  }
  
  return platforms;
}
