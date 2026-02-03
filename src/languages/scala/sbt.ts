/**
 * ReachVet - sbt Parser for Scala
 * 
 * Parses build.sbt and related files
 */

import { readFile } from 'node:fs/promises';

export interface SbtDependency {
  groupId: string;
  artifactId: string;
  version: string;
  configuration?: string; // Test, Provided, etc.
  crossVersion?: boolean; // Uses %% for cross-version
}

/**
 * Parse build.sbt file
 */
export function parseBuildSbt(content: string): SbtDependency[] {
  const deps: SbtDependency[] = [];

  // Match various sbt dependency formats:
  // "org" % "artifact" % "version"
  // "org" %% "artifact" % "version"
  // "org" %% "artifact" % "version" % Test
  // "org" %% "artifact" % "version" % "test"
  
  // libraryDependencies += ...
  // libraryDependencies ++= Seq(...)
  
  const singleDepRegex = /"([^"]+)"\s*(%{1,2})\s*"([^"]+)"\s*%\s*"([^"]+)"(?:\s*%\s*(?:"([^"]+)"|(\w+)))?/g;

  let match;
  while ((match = singleDepRegex.exec(content)) !== null) {
    deps.push({
      groupId: match[1],
      artifactId: match[3],
      version: match[4],
      configuration: match[5] || match[6], // Either quoted or bare word
      crossVersion: match[2] === '%%'
    });
  }

  return deps;
}

/**
 * Parse plugins.sbt file
 */
export function parsePluginsSbt(content: string): SbtDependency[] {
  const deps: SbtDependency[] = [];

  // addSbtPlugin("org" % "artifact" % "version")
  const pluginRegex = /addSbtPlugin\s*\(\s*"([^"]+)"\s*%\s*"([^"]+)"\s*%\s*"([^"]+)"\s*\)/g;

  let match;
  while ((match = pluginRegex.exec(content)) !== null) {
    deps.push({
      groupId: match[1],
      artifactId: match[2],
      version: match[3],
      configuration: 'plugin'
    });
  }

  return deps;
}

/**
 * Parse Dependencies.scala (common pattern for multi-project builds)
 */
export function parseDependenciesScala(content: string): SbtDependency[] {
  const deps: SbtDependency[] = [];

  // Match val definitions with dependencies
  // val circe = "io.circe" %% "circe-core" % "0.14.5"
  const depRegex = /val\s+\w+\s*=\s*"([^"]+)"\s*(%{1,2})\s*"([^"]+)"\s*%\s*"([^"]+)"/g;

  let match;
  while ((match = depRegex.exec(content)) !== null) {
    deps.push({
      groupId: match[1],
      artifactId: match[3],
      version: match[4],
      crossVersion: match[2] === '%%'
    });
  }

  return deps;
}

/**
 * Parse build.properties to get sbt version
 */
export function parseBuildProperties(content: string): string | null {
  const match = content.match(/sbt\.version\s*=\s*(.+)/);
  return match ? match[1].trim() : null;
}

/**
 * Get Scala version from build.sbt
 */
export function getScalaVersion(content: string): string | null {
  // scalaVersion := "2.13.12"
  const match = content.match(/scalaVersion\s*:=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Get cross Scala versions from build.sbt
 */
export function getCrossScalaVersions(content: string): string[] {
  // crossScalaVersions := Seq("2.12.18", "2.13.12", "3.3.1")
  const match = content.match(/crossScalaVersions\s*:=\s*Seq\s*\(([^)]+)\)/);
  if (!match) return [];

  const versions: string[] = [];
  const versionRegex = /"([^"]+)"/g;
  let vMatch;
  while ((vMatch = versionRegex.exec(match[1])) !== null) {
    versions.push(vMatch[1]);
  }
  return versions;
}

/**
 * Read and parse build.sbt
 */
export async function readBuildSbt(filePath: string): Promise<SbtDependency[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseBuildSbt(content);
}

/**
 * Detect if it's a multi-project build
 */
export function isMultiProjectBuild(content: string): boolean {
  // Look for lazy val definitions with .project or .settings
  return /lazy\s+val\s+\w+\s*=\s*\(?project/i.test(content) ||
         /\.aggregate\s*\(/i.test(content);
}

/**
 * Get project names from multi-project build
 */
export function getSubProjects(content: string): string[] {
  const projects: string[] = [];
  
  // lazy val core = project
  // lazy val api = (project in file("api"))
  const projectRegex = /lazy\s+val\s+(\w+)\s*=\s*\(?project/gi;
  
  let match;
  while ((match = projectRegex.exec(content)) !== null) {
    projects.push(match[1]);
  }
  
  return projects;
}
