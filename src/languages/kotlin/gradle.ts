/**
 * ReachVet - Gradle Parser for Kotlin
 * 
 * Parses build.gradle.kts, build.gradle, and related files
 */

import { readFile } from 'node:fs/promises';

export interface GradleDependency {
  groupId: string;
  artifactId: string;
  version: string;
  configuration: string; // implementation, api, testImplementation, etc.
}

/**
 * Parse build.gradle.kts (Kotlin DSL)
 */
export function parseGradleKts(content: string): GradleDependency[] {
  const deps: GradleDependency[] = [];

  // Match: implementation("group:artifact:version")
  // Match: implementation("group:artifact") { version { ... } }
  // Match: implementation(libs.something) - version catalog
  const depRegex = /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|kapt|ksp|annotationProcessor)\s*\(\s*"([^"]+)"\s*\)/g;

  let match;
  while ((match = depRegex.exec(content)) !== null) {
    const config = match[1];
    const dep = match[2];
    
    const parts = dep.split(':');
    if (parts.length >= 2) {
      deps.push({
        groupId: parts[0],
        artifactId: parts[1],
        version: parts[2] || '*',
        configuration: config
      });
    }
  }

  // Match: implementation(kotlin("stdlib"))
  const kotlinDepRegex = /\b(implementation|api)\s*\(\s*kotlin\s*\(\s*"([^"]+)"\s*\)\s*\)/g;
  while ((match = kotlinDepRegex.exec(content)) !== null) {
    deps.push({
      groupId: 'org.jetbrains.kotlin',
      artifactId: `kotlin-${match[2]}`,
      version: '*',
      configuration: match[1]
    });
  }

  // Match: implementation(project(":module"))
  const projectDepRegex = /\b(implementation|api)\s*\(\s*project\s*\(\s*"([^"]+)"\s*\)\s*\)/g;
  while ((match = projectDepRegex.exec(content)) !== null) {
    deps.push({
      groupId: 'project',
      artifactId: match[2].replace(/^:/, ''),
      version: 'local',
      configuration: match[1]
    });
  }

  return deps;
}

/**
 * Parse build.gradle (Groovy DSL)
 */
export function parseGradleGroovy(content: string): GradleDependency[] {
  const deps: GradleDependency[] = [];

  // Match: implementation 'group:artifact:version'
  // Match: implementation "group:artifact:version"
  const depRegex = /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|kapt|ksp|annotationProcessor)\s+['"]([^'"]+)['"]/g;

  let match;
  while ((match = depRegex.exec(content)) !== null) {
    const config = match[1];
    const dep = match[2];
    
    const parts = dep.split(':');
    if (parts.length >= 2) {
      deps.push({
        groupId: parts[0],
        artifactId: parts[1],
        version: parts[2] || '*',
        configuration: config
      });
    }
  }

  // Match: implementation group: 'group', name: 'artifact', version: 'version'
  const mapDepRegex = /\b(implementation|api)\s+group:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*(?:,\s*version:\s*['"]([^'"]+)['"])?/g;
  while ((match = mapDepRegex.exec(content)) !== null) {
    deps.push({
      groupId: match[2],
      artifactId: match[3],
      version: match[4] || '*',
      configuration: match[1]
    });
  }

  return deps;
}

/**
 * Parse settings.gradle.kts or settings.gradle for included modules
 */
export function parseSettingsGradle(content: string): string[] {
  const modules: string[] = [];

  // Match: include(":app", ":library")
  // Match: include ":app", ":library"
  // Match: include(":app")
  const includeRegex = /include\s*\(?\s*([^)]+)\)?/g;

  let match;
  while ((match = includeRegex.exec(content)) !== null) {
    const includes = match[1];
    const moduleRegex = /['"]([^'"]+)['"]/g;
    
    let modMatch;
    while ((modMatch = moduleRegex.exec(includes)) !== null) {
      modules.push(modMatch[1].replace(/^:/, ''));
    }
  }

  return modules;
}

/**
 * Parse gradle.properties for version info
 */
export function parseGradleProperties(content: string): Map<string, string> {
  const props = new Map<string, string>();
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([^=]+)=(.+)$/);
    if (match) {
      props.set(match[1].trim(), match[2].trim());
    }
  }

  return props;
}

/**
 * Parse version catalog (libs.versions.toml)
 */
export function parseVersionCatalog(content: string): GradleDependency[] {
  const deps: GradleDependency[] = [];

  // Simple parsing of [libraries] section
  const librariesMatch = content.match(/\[libraries\]([\s\S]*?)(?:\[|$)/);
  if (!librariesMatch) return deps;

  const librariesSection = librariesMatch[1];
  const lines = librariesSection.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match: name = { group = "group", name = "artifact", version = "version" }
    const mapMatch = trimmed.match(/^\w+\s*=\s*\{\s*group\s*=\s*"([^"]+)"\s*,\s*name\s*=\s*"([^"]+)"(?:\s*,\s*version(?:\.ref)?\s*=\s*"([^"]+)")?\s*\}/);
    if (mapMatch) {
      deps.push({
        groupId: mapMatch[1],
        artifactId: mapMatch[2],
        version: mapMatch[3] || '*',
        configuration: 'library'
      });
      continue;
    }

    // Match: name = "group:artifact:version"
    const stringMatch = trimmed.match(/^\w+\s*=\s*"([^:]+):([^:]+):?([^"]*)?"/);
    if (stringMatch) {
      deps.push({
        groupId: stringMatch[1],
        artifactId: stringMatch[2],
        version: stringMatch[3] || '*',
        configuration: 'library'
      });
    }
  }

  return deps;
}

/**
 * Read and parse build.gradle.kts
 */
export async function readBuildGradleKts(filePath: string): Promise<GradleDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseGradleKts(content);
}

/**
 * Read and parse build.gradle
 */
export async function readBuildGradle(filePath: string): Promise<GradleDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseGradleGroovy(content);
}

/**
 * Detect Kotlin version from build.gradle(.kts)
 */
export function detectKotlinVersion(content: string): string | null {
  // Match: kotlin("jvm") version "1.9.0"
  const versionMatch = content.match(/kotlin\s*\(\s*["'][^"']+["']\s*\)\s*version\s*["']([^"']+)["']/);
  if (versionMatch) {
    return versionMatch[1];
  }

  // Match: id("org.jetbrains.kotlin.jvm") version "1.9.0"
  const idMatch = content.match(/id\s*\(\s*["']org\.jetbrains\.kotlin[^"']+["']\s*\)\s*version\s*["']([^"']+)["']/);
  if (idMatch) {
    return idMatch[1];
  }

  return null;
}
