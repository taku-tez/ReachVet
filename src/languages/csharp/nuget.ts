/**
 * ReachVet - NuGet Project File Parsers
 * 
 * Parses .csproj (SDK-style and legacy) and packages.config
 */

import { readFile } from 'node:fs/promises';

export interface NuGetDependency {
  name: string;
  version: string;
  isPrivateAssets?: boolean;
}

/**
 * Parse SDK-style .csproj file (XML)
 */
export function parseCsprojSdk(content: string): NuGetDependency[] {
  const deps: NuGetDependency[] = [];

  // Match <PackageReference Include="Name" Version="1.0.0" />
  // or <PackageReference Include="Name" Version="1.0.0">...</PackageReference>
  const packageRefRegex = /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?([^/>]*?)(?:\/>|>[\s\S]*?<\/PackageReference>)/gi;
  
  let match;
  while ((match = packageRefRegex.exec(content)) !== null) {
    const name = match[1];
    let version = match[2] || '';
    const attributes = match[3] || '';

    // Check for Version in nested element
    if (!version) {
      const versionMatch = match[0].match(/<Version>([^<]+)<\/Version>/i);
      if (versionMatch) {
        version = versionMatch[1];
      }
    }

    // Check for PrivateAssets
    const isPrivateAssets = attributes.includes('PrivateAssets="All"') || 
                            match[0].includes('<PrivateAssets>All</PrivateAssets>');

    deps.push({
      name,
      version: version || '*',
      isPrivateAssets
    });
  }

  return deps;
}

/**
 * Parse legacy packages.config file (XML)
 */
export function parsePackagesConfig(content: string): NuGetDependency[] {
  const deps: NuGetDependency[] = [];

  // Match <package id="Name" version="1.0.0" ... />
  const packageRegex = /<package\s+id="([^"]+)"\s+version="([^"]+)"[^/>]*\/>/gi;
  
  let match;
  while ((match = packageRegex.exec(content)) !== null) {
    deps.push({
      name: match[1],
      version: match[2]
    });
  }

  return deps;
}

/**
 * Parse Directory.Packages.props (Central Package Management)
 */
export function parseDirectoryPackagesProps(content: string): Map<string, string> {
  const versions = new Map<string, string>();

  // Match <PackageVersion Include="Name" Version="1.0.0" />
  const packageVersionRegex = /<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"[^/>]*\/>/gi;
  
  let match;
  while ((match = packageVersionRegex.exec(content)) !== null) {
    versions.set(match[1], match[2]);
  }

  return versions;
}

/**
 * Parse .NET project file (auto-detect format)
 */
export function parseProjectFile(content: string): NuGetDependency[] {
  // Check if it's SDK-style (has <Project Sdk=)
  if (content.includes('<Project Sdk=') || content.includes('<PackageReference')) {
    return parseCsprojSdk(content);
  }
  
  // Check if it's packages.config
  if (content.includes('<packages>')) {
    return parsePackagesConfig(content);
  }

  return [];
}

/**
 * Read and parse .csproj file
 */
export async function readCsproj(filePath: string): Promise<NuGetDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseCsprojSdk(content);
}

/**
 * Read and parse packages.config
 */
export async function readPackagesConfig(filePath: string): Promise<NuGetDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parsePackagesConfig(content);
}

/**
 * Get target framework from .csproj
 */
export function getTargetFramework(content: string): string | null {
  // <TargetFramework>net8.0</TargetFramework>
  const match = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/i);
  if (match) {
    return match[1];
  }

  // <TargetFrameworks>net6.0;net7.0</TargetFrameworks>
  const multiMatch = content.match(/<TargetFrameworks>([^<]+)<\/TargetFrameworks>/i);
  if (multiMatch) {
    return multiMatch[1].split(';')[0]; // Return first framework
  }

  return null;
}
