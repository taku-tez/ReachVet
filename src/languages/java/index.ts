/**
 * ReachVet - Java Language Adapter
 * Analyzes Java projects for dependency reachability
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { constants } from 'node:fs';

import { BaseLanguageAdapter } from '../base.js';
import type { 
  Component, 
  ComponentResult, 
  SupportedLanguage,
  CodeLocation,
  UsageInfo,
  AnalysisWarning 
} from '../../types.js';
import {
  parseJavaSource,
  parsePomXml,
  parseBuildGradle,
  parseBuildGradleKts,
  findClassUsages,
  extractArtifactFromPackage,
  isJavaStandardLibrary,
  detectReflection,
  type JavaImportInfo,
  type PomInfo,
  type GradleInfo
} from './parser.js';

interface ParsedFile {
  file: string;
  imports: JavaImportInfo[];
  source: string;
}

/**
 * Java Language Adapter
 */
export class JavaLanguageAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'java';
  fileExtensions = ['.java'];

  private parsedFiles: Map<string, ParsedFile> = new Map();
  private pomInfo: PomInfo | null = null;
  private gradleInfo: GradleInfo | null = null;

  /**
   * Check if this adapter can handle the directory
   */
  async canHandle(sourceDir: string): Promise<boolean> {
    // Check for Maven (pom.xml) or Gradle (build.gradle, build.gradle.kts)
    const pomExists = await this.fileExists(join(sourceDir, 'pom.xml'));
    const gradleExists = await this.fileExists(join(sourceDir, 'build.gradle'));
    const gradleKtsExists = await this.fileExists(join(sourceDir, 'build.gradle.kts'));
    
    if (pomExists || gradleExists || gradleKtsExists) return true;

    // Check for .java files
    return await this.hasJavaFiles(sourceDir);
  }

  /**
   * Analyze components for reachability
   */
  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    // Reset state
    this.parsedFiles.clear();
    this.pomInfo = null;
    this.gradleInfo = null;

    // Parse build files
    await this.parseBuildFiles(sourceDir);

    // Parse Java source files
    await this.parseAllSourceFiles(sourceDir);

    // Analyze each component
    const results: ComponentResult[] = [];
    for (const component of components) {
      const result = await this.analyzeComponent(component);
      results.push(result);
    }

    return results;
  }

  /**
   * Parse pom.xml or build.gradle
   */
  private async parseBuildFiles(sourceDir: string): Promise<void> {
    // Try Maven first
    const pomPath = join(sourceDir, 'pom.xml');
    if (await this.fileExists(pomPath)) {
      try {
        const content = await readFile(pomPath, 'utf-8');
        this.pomInfo = parsePomXml(content);
      } catch {
        // Ignore parse errors
      }
    }

    // Try Gradle
    const gradlePath = join(sourceDir, 'build.gradle');
    if (await this.fileExists(gradlePath)) {
      try {
        const content = await readFile(gradlePath, 'utf-8');
        this.gradleInfo = parseBuildGradle(content);
      } catch {
        // Ignore parse errors
      }
    }

    // Try Gradle Kotlin DSL
    const gradleKtsPath = join(sourceDir, 'build.gradle.kts');
    if (await this.fileExists(gradleKtsPath) && !this.gradleInfo) {
      try {
        const content = await readFile(gradleKtsPath, 'utf-8');
        this.gradleInfo = parseBuildGradleKts(content);
      } catch {
        // Ignore parse errors
      }
    }
  }

  /**
   * Parse all Java source files
   */
  private async parseAllSourceFiles(sourceDir: string): Promise<void> {
    const javaFiles = await this.findJavaFiles(sourceDir);
    
    for (const file of javaFiles) {
      try {
        const content = await readFile(file, 'utf-8');
        const imports = parseJavaSource(content, relative(sourceDir, file));
        
        this.parsedFiles.set(file, {
          file: relative(sourceDir, file),
          imports,
          source: content
        });
      } catch {
        // Skip files that can't be read
      }
    }
  }

  /**
   * Analyze a single component
   */
  private async analyzeComponent(component: Component): Promise<ComponentResult> {
    const warnings: AnalysisWarning[] = [];
    const locations: CodeLocation[] = [];
    const usedMembers = new Set<string>();

    // Extract groupId:artifactId from component name or purl
    const { groupId, artifactId } = this.extractMavenCoordinates(component);
    
    if (!groupId || !artifactId) {
      return this.unknown(component, ['Could not determine Maven coordinates']);
    }

    // Find matching imports across all files
    for (const [, parsed] of this.parsedFiles) {
      for (const imp of parsed.imports) {
        // Skip standard library
        if (isJavaStandardLibrary(imp.packagePath)) continue;

        // Try to match import to component
        const artifact = extractArtifactFromPackage(imp.packagePath);
        if (artifact) {
          const [artGroupId, artArtifactId] = artifact.split(':');
          
          // Check if this import matches our component
          if (this.matchesCoordinates(groupId, artifactId, artGroupId, artArtifactId)) {
            locations.push(imp.location);

            // Add warnings for special import types
            if (imp.isWildcard && !imp.isStatic) {
              warnings.push({
                code: 'star_import',
                message: `Wildcard import: ${imp.path} - specific classes unknown`,
                location: imp.location,
                severity: 'warning'
              });
            }

            // Find usages of this class
            if (!imp.isWildcard && imp.className !== '*') {
              const usages = findClassUsages(parsed.source, imp.className);
              for (const usage of usages) {
                usedMembers.add(usage);
              }
            }

            // For static imports, add the member
            if (imp.isStatic && imp.staticMember) {
              usedMembers.add(imp.staticMember);
            }
          }
        }
      }
    }

    // Detect reflection usage
    for (const [file, parsed] of this.parsedFiles) {
      const reflectionWarnings = detectReflection(parsed.source, file);
      for (const rw of reflectionWarnings) {
        const typeMessages: Record<string, string> = {
          'Class.forName': `Class.forName() detected${rw.className ? `: ${rw.className}` : ''} - dynamic class loading`,
          'loadClass': `ClassLoader.loadClass() detected${rw.className ? `: ${rw.className}` : ''} - dynamic class loading`,
          'newInstance': 'newInstance() detected - reflection-based instantiation',
          'getMethod': 'getMethod() detected - reflection method access',
          'invoke': 'Method.invoke() detected - reflection method call'
        };
        warnings.push({
          code: 'reflection',
          message: typeMessages[rw.type] || `Reflection: ${rw.type}`,
          location: rw.location,
          severity: 'warning'
        });
      }
    }

    // No imports found
    if (locations.length === 0) {
      // Check if it's in dependencies but not used
      if (this.isInDependencies(groupId, artifactId)) {
        return this.notReachable(
          component,
          ['Declared in dependencies but not imported'],
          warnings
        );
      }
      return this.notReachable(component, undefined, warnings);
    }

    // Build usage info
    const usage: UsageInfo = {
      importStyle: 'esm',  // Java uses import statements
      usedMembers: usedMembers.size > 0 ? [...usedMembers] : undefined,
      locations
    };

    // Determine if vulnerable functions are reachable
    const vulnFunctions = component.vulnerabilities?.flatMap(v => v.affectedFunctions || []) || [];
    const reachableVulnFunctions = vulnFunctions.filter(fn => usedMembers.has(fn));

    if (reachableVulnFunctions.length > 0) {
      return this.reachable(
        component,
        usage,
        'high',
        [`Vulnerable function(s) reachable: ${reachableVulnFunctions.join(', ')}`],
        warnings
      );
    }

    // Has usages
    if (usedMembers.size > 0) {
      return this.reachable(component, usage, 'high', undefined, warnings);
    }

    // Only imported, no clear usage (might be wildcard or type-only)
    if (warnings.some(w => w.code === 'star_import')) {
      return this.imported(
        component,
        usage,
        ['Wildcard import - specific usage cannot be determined'],
        warnings
      );
    }

    return this.imported(component, usage, undefined, warnings);
  }

  /**
   * Extract Maven coordinates from component
   */
  private extractMavenCoordinates(component: Component): { groupId?: string; artifactId?: string } {
    // Try purl first: pkg:maven/groupId/artifactId@version
    if (component.purl) {
      const purlMatch = component.purl.match(/pkg:maven\/([^/]+)\/([^@]+)/);
      if (purlMatch) {
        return { groupId: purlMatch[1], artifactId: purlMatch[2] };
      }
    }

    // Try name as groupId:artifactId
    if (component.name.includes(':')) {
      const [groupId, artifactId] = component.name.split(':');
      return { groupId, artifactId };
    }

    // Fallback: assume name is artifactId, try to find in dependencies
    if (this.pomInfo) {
      const dep = this.pomInfo.dependencies.find(d => d.artifactId === component.name);
      if (dep) {
        return { groupId: dep.groupId, artifactId: dep.artifactId };
      }
    }

    if (this.gradleInfo) {
      const dep = this.gradleInfo.dependencies.find(d => d.name === component.name);
      if (dep && dep.group) {
        return { groupId: dep.group, artifactId: dep.name };
      }
    }

    return {};
  }

  /**
   * Check if coordinates match (with fuzzy matching)
   */
  private matchesCoordinates(
    targetGroupId: string,
    targetArtifactId: string,
    importGroupId: string,
    importArtifactId: string
  ): boolean {
    // Exact match
    if (targetGroupId === importGroupId && targetArtifactId === importArtifactId) {
      return true;
    }

    // Artifact ID match (groupId might be guessed differently)
    if (targetArtifactId === importArtifactId) {
      // Check if groupIds are related
      if (targetGroupId.includes(importGroupId) || importGroupId.includes(targetGroupId)) {
        return true;
      }
    }

    // Handle multi-module projects: jackson-databind, jackson-core, etc.
    if (targetArtifactId.startsWith(importArtifactId) || importArtifactId.startsWith(targetArtifactId)) {
      if (targetGroupId === importGroupId) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if component is declared in dependencies
   */
  private isInDependencies(groupId: string, artifactId: string): boolean {
    if (this.pomInfo) {
      return this.pomInfo.dependencies.some(
        d => d.groupId === groupId && d.artifactId === artifactId
      );
    }

    if (this.gradleInfo) {
      return this.gradleInfo.dependencies.some(
        d => d.group === groupId && d.name === artifactId
      );
    }

    return false;
  }

  /**
   * Find all Java files in directory
   */
  private async findJavaFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    const scanDir = async (currentDir: string): Promise<void> => {
      try {
        const entries = await readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name);
          
          // Skip common non-source directories
          if (entry.isDirectory()) {
            if (!['node_modules', 'target', 'build', '.git', '.gradle'].includes(entry.name)) {
              await scanDir(fullPath);
            }
          } else if (entry.isFile() && entry.name.endsWith('.java')) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    await scanDir(dir);
    return files;
  }

  /**
   * Check if directory has Java files
   */
  private async hasJavaFiles(dir: string): Promise<boolean> {
    const files = await this.findJavaFiles(dir);
    return files.length > 0;
  }

  /**
   * Check if file exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a new Java adapter instance
 */
export function createJavaAdapter(): JavaLanguageAdapter {
  return new JavaLanguageAdapter();
}

/**
 * Parse pom.xml file (exported for testing)
 */
export async function parsePomFile(pomPath: string): Promise<PomInfo> {
  const content = await readFile(pomPath, 'utf-8');
  return parsePomXml(content);
}

/**
 * Parse build.gradle file (exported for testing)
 */
export async function parseGradleFile(gradlePath: string): Promise<GradleInfo> {
  const content = await readFile(gradlePath, 'utf-8');
  if (gradlePath.endsWith('.kts')) {
    return parseBuildGradleKts(content);
  }
  return parseBuildGradle(content);
}

// Export singleton instance
export const javaAdapter = createJavaAdapter();

// Re-export parser functions
export {
  parseJavaSource,
  parsePomXml,
  parseBuildGradle,
  parseBuildGradleKts,
  findClassUsages,
  extractArtifactFromPackage,
  isJavaStandardLibrary,
  MAVEN_ARTIFACT_ALIASES
} from './parser.js';

// Re-export types
export type {
  JavaImportInfo,
  MavenDependency,
  GradleDependency,
  PomInfo,
  GradleInfo
} from './parser.js';
