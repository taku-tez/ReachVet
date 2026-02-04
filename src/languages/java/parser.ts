/**
 * ReachVet - Java Import Parser
 * Parses Java import statements, pom.xml, and build.gradle files
 */

import type { CodeLocation } from '../../types.js';

export interface JavaImportInfo {
  // Full import path (e.g., 'org.apache.commons.lang3.StringUtils')
  path: string;
  // Package part (e.g., 'org.apache.commons.lang3')
  packagePath: string;
  // Class name (e.g., 'StringUtils') or '*' for wildcard
  className: string;
  // Is static import
  isStatic?: boolean;
  // Is wildcard import (import pkg.*)
  isWildcard?: boolean;
  // Static member name (for static imports)
  staticMember?: string;
  // Location
  location: CodeLocation;
}

export interface MavenDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;  // compile, test, provided, runtime, etc.
  optional?: boolean;
}

export interface GradleDependency {
  configuration: string;  // implementation, api, testImplementation, etc.
  group?: string;
  name: string;
  version?: string;
  // String notation: 'group:name:version'
  notation?: string;
}

export interface PomInfo {
  groupId?: string;
  artifactId?: string;
  version?: string;
  packaging?: string;
  dependencies: MavenDependency[];
}

export interface GradleInfo {
  plugins: string[];
  dependencies: GradleDependency[];
}

/**
 * Parse Java source and extract import statements
 */
export function parseJavaSource(source: string, file: string): JavaImportInfo[] {
  const imports: JavaImportInfo[] = [];
  const lines = source.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    const line = lines[lineIdx];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    // Stop at class/interface/enum declaration (imports must come before)
    if (/^(public\s+)?(abstract\s+)?(final\s+)?(class|interface|enum|@interface)\s+/.test(trimmed)) {
      break;
    }

    // Match import statements
    // import pkg.Class;
    // import pkg.*;
    // import static pkg.Class.method;
    // import static pkg.Class.*;
    const importMatch = trimmed.match(/^import\s+(static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?);\s*$/);
    if (importMatch) {
      const isStatic = !!importMatch[1];
      const fullPath = importMatch[2];

      const importInfo = parseImportPath(fullPath, isStatic, file, lineNum, trimmed);
      if (importInfo) {
        imports.push(importInfo);
      }
    }
  }

  return imports;
}

/**
 * Parse import path and extract components
 */
function parseImportPath(
  fullPath: string,
  isStatic: boolean,
  file: string,
  lineNum: number,
  snippet: string
): JavaImportInfo | null {
  const isWildcard = fullPath.endsWith('.*');
  
  // Remove trailing .* for wildcard imports
  const cleanPath = isWildcard ? fullPath.slice(0, -2) : fullPath;
  const parts = cleanPath.split('.');
  
  if (parts.length < 2) return null;

  if (isStatic) {
    // Static import: import static pkg.Class.member;
    // or wildcard: import static pkg.Class.*;
    if (isWildcard) {
      // import static pkg.Class.*;
      const className = parts[parts.length - 1];
      const packagePath = parts.slice(0, -1).join('.');
      return {
        path: fullPath,
        packagePath,
        className,
        isStatic: true,
        isWildcard: true,
        location: { file, line: lineNum, snippet }
      };
    } else {
      // import static pkg.Class.member;
      const staticMember = parts[parts.length - 1];
      const className = parts[parts.length - 2];
      const packagePath = parts.slice(0, -2).join('.');
      return {
        path: fullPath,
        packagePath,
        className,
        isStatic: true,
        staticMember,
        location: { file, line: lineNum, snippet }
      };
    }
  } else if (isWildcard) {
    // Wildcard import: import pkg.*;
    return {
      path: fullPath,
      packagePath: cleanPath,
      className: '*',
      isWildcard: true,
      location: { file, line: lineNum, snippet }
    };
  } else {
    // Regular import: import pkg.Class;
    const className = parts[parts.length - 1];
    const packagePath = parts.slice(0, -1).join('.');
    return {
      path: fullPath,
      packagePath,
      className,
      location: { file, line: lineNum, snippet }
    };
  }
}

/**
 * Parse pom.xml file (Maven)
 */
export function parsePomXml(content: string): PomInfo {
  const dependencies: MavenDependency[] = [];
  
  // Extract project info
  const groupIdMatch = content.match(/<groupId>([^<]+)<\/groupId>/);
  const artifactIdMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
  const versionMatch = content.match(/<version>([^<]+)<\/version>/);
  const packagingMatch = content.match(/<packaging>([^<]+)<\/packaging>/);

  // Extract dependencies
  // Match <dependencies>...</dependencies> block
  const depsMatch = content.match(/<dependencies>([\s\S]*?)<\/dependencies>/);
  if (depsMatch) {
    const depsContent = depsMatch[1];
    
    // Match individual <dependency>...</dependency>
    const depRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
    let depMatch;
    
    while ((depMatch = depRegex.exec(depsContent)) !== null) {
      const depContent = depMatch[1];
      const dep = parseDependencyBlock(depContent);
      if (dep) {
        dependencies.push(dep);
      }
    }
  }

  return {
    groupId: groupIdMatch?.[1],
    artifactId: artifactIdMatch?.[1],
    version: versionMatch?.[1],
    packaging: packagingMatch?.[1],
    dependencies
  };
}

/**
 * Parse a single <dependency> block
 */
function parseDependencyBlock(content: string): MavenDependency | null {
  const groupIdMatch = content.match(/<groupId>([^<]+)<\/groupId>/);
  const artifactIdMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
  
  if (!groupIdMatch || !artifactIdMatch) return null;

  const versionMatch = content.match(/<version>([^<]+)<\/version>/);
  const scopeMatch = content.match(/<scope>([^<]+)<\/scope>/);
  const optionalMatch = content.match(/<optional>([^<]+)<\/optional>/);

  return {
    groupId: groupIdMatch[1].trim(),
    artifactId: artifactIdMatch[1].trim(),
    version: versionMatch?.[1]?.trim(),
    scope: scopeMatch?.[1]?.trim(),
    optional: optionalMatch?.[1]?.trim().toLowerCase() === 'true'
  };
}

/**
 * Parse build.gradle file (Groovy DSL)
 */
export function parseBuildGradle(content: string): GradleInfo {
  const dependencies: GradleDependency[] = [];
  const plugins: string[] = [];

  // Extract plugins
  // plugins { id 'java' } or plugins { id("java") }
  const pluginsMatch = content.match(/plugins\s*\{([\s\S]*?)\}/);
  if (pluginsMatch) {
    const pluginLines = pluginsMatch[1].split('\n');
    for (const line of pluginLines) {
      const trimmed = line.trim();
      // id 'java' or id("java") or id "java"
      const pluginMatch = trimmed.match(/id\s*[('"]([^'"()]+)['")\s]/);
      if (pluginMatch) {
        plugins.push(pluginMatch[1]);
      }
    }
  }

  // Extract dependencies
  const depsMatch = content.match(/dependencies\s*\{([\s\S]*?)\n\}/);
  if (depsMatch) {
    const depsContent = depsMatch[1];
    const lines = depsContent.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      const dep = parseGradleDependencyLine(trimmed);
      if (dep) {
        dependencies.push(dep);
      }
    }
  }

  return { plugins, dependencies };
}

/**
 * Parse a single Gradle dependency line
 */
function parseGradleDependencyLine(line: string): GradleDependency | null {
  // Configurations: implementation, api, compileOnly, runtimeOnly, 
  // testImplementation, testRuntimeOnly, annotationProcessor, etc.
  const configs = [
    'implementation', 'api', 'compileOnly', 'runtimeOnly',
    'testImplementation', 'testCompileOnly', 'testRuntimeOnly',
    'annotationProcessor', 'kapt', 'compile', 'testCompile',
    'providedCompile', 'providedRuntime'
  ];

  for (const config of configs) {
    // String notation: implementation 'group:name:version'
    // or: implementation("group:name:version")
    const stringMatch = line.match(new RegExp(`${config}\\s*[('"]([^'"()]+)['"\\)]`));
    if (stringMatch) {
      const notation = stringMatch[1];
      const parts = notation.split(':');
      if (parts.length >= 2) {
        return {
          configuration: config,
          group: parts[0] || undefined,
          name: parts[1],
          version: parts[2],
          notation
        };
      }
    }

    // Map notation: implementation group: 'com.example', name: 'lib', version: '1.0'
    const mapMatch = line.match(new RegExp(`${config}\\s+group:\\s*['"]([^'"]+)['"]\\s*,\\s*name:\\s*['"]([^'"]+)['"](?:\\s*,\\s*version:\\s*['"]([^'"]+)['"])?`));
    if (mapMatch) {
      return {
        configuration: config,
        group: mapMatch[1],
        name: mapMatch[2],
        version: mapMatch[3]
      };
    }

    // Project dependency: implementation project(':submodule')
    const projectMatch = line.match(new RegExp(`${config}\\s+project\\s*\\(['"]([^'"]+)['"]\\)`));
    if (projectMatch) {
      return {
        configuration: config,
        name: projectMatch[1],
        notation: `project:${projectMatch[1]}`
      };
    }
  }

  return null;
}

/**
 * Parse build.gradle.kts file (Kotlin DSL)
 */
export function parseBuildGradleKts(content: string): GradleInfo {
  // Kotlin DSL is very similar to Groovy, reuse the parser
  // Main differences:
  // - Uses () instead of '' for function calls: implementation("group:name:version")
  // - Uses val/var for variables
  return parseBuildGradle(content);
}

/**
 * Find class usages in Java source
 * Tracks patterns like: ClassName.method(), new ClassName(), ClassName.CONSTANT
 */
export function findClassUsages(
  source: string,
  className: string
): string[] {
  const usages = new Set<string>();
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Method calls: ClassName.methodName(
  const methodPattern = new RegExp(`\\b${escaped}\\.(\\w+)\\s*\\(`, 'g');
  let match;
  while ((match = methodPattern.exec(source)) !== null) {
    usages.add(match[1]);
  }

  // Static field access: ClassName.FIELD_NAME
  const fieldPattern = new RegExp(`\\b${escaped}\\.([A-Z_][A-Z0-9_]*)\\b`, 'g');
  while ((match = fieldPattern.exec(source)) !== null) {
    usages.add(match[1]);
  }

  // Constructor: new ClassName(
  const constructorPattern = new RegExp(`\\bnew\\s+${escaped}\\s*[(<]`, 'g');
  if (constructorPattern.test(source)) {
    usages.add('<init>');
  }

  // Type usage: ClassName varName or ClassName<Generic>
  const typePattern = new RegExp(`\\b${escaped}(?:<[^>]+>)?\\s+\\w+`, 'g');
  if (typePattern.test(source)) {
    usages.add('<type>');
  }

  return [...usages];
}

/**
 * Extract artifact from package path
 * Maps Java packages to Maven coordinates
 */
export function extractArtifactFromPackage(packagePath: string): string | null {
  // Common mappings
  const packageMappings: Record<string, string> = {
    // Apache Commons
    'org.apache.commons.lang3': 'org.apache.commons:commons-lang3',
    'org.apache.commons.io': 'commons-io:commons-io',
    'org.apache.commons.collections4': 'org.apache.commons:commons-collections4',
    'org.apache.commons.codec': 'commons-codec:commons-codec',
    'org.apache.commons.text': 'org.apache.commons:commons-text',
    'org.apache.commons.text.lookup': 'org.apache.commons:commons-text',
    
    // Logging
    'org.slf4j': 'org.slf4j:slf4j-api',
    'org.apache.logging.log4j': 'org.apache.logging.log4j:log4j-core',
    'ch.qos.logback': 'ch.qos.logback:logback-classic',
    
    // JSON
    'com.google.gson': 'com.google.code.gson:gson',
    'com.fasterxml.jackson': 'com.fasterxml.jackson.core:jackson-databind',
    'org.json': 'org.json:json',
    
    // HTTP
    'org.apache.http': 'org.apache.httpcomponents:httpclient',
    'okhttp3': 'com.squareup.okhttp3:okhttp',
    
    // Testing
    'org.junit.jupiter': 'org.junit.jupiter:junit-jupiter',
    'org.junit': 'junit:junit',
    'org.mockito': 'org.mockito:mockito-core',
    'org.assertj': 'org.assertj:assertj-core',
    
    // Spring
    'org.springframework': 'org.springframework:spring-core',
    'org.springframework.boot': 'org.springframework.boot:spring-boot',
    
    // Google
    'com.google.common': 'com.google.guava:guava',
    'com.google.protobuf': 'com.google.protobuf:protobuf-java',
    
    // AWS
    'software.amazon.awssdk': 'software.amazon.awssdk:aws-core',
    'com.amazonaws': 'com.amazonaws:aws-java-sdk-core',
    
    // Utilities
    'org.projectlombok': 'org.projectlombok:lombok',
    'javax.validation': 'javax.validation:validation-api',
    'jakarta.validation': 'jakarta.validation:jakarta.validation-api',
  };

  // Try exact match first
  if (packageMappings[packagePath]) {
    return packageMappings[packagePath];
  }

  // Try prefix match
  for (const [prefix, artifact] of Object.entries(packageMappings)) {
    if (packagePath.startsWith(prefix + '.')) {
      return artifact;
    }
  }

  // Default: group = first 3 segments, artifact = segment 3 or 4
  const parts = packagePath.split('.');
  if (parts.length >= 3) {
    const groupId = parts.slice(0, 3).join('.');
    const artifactId = parts[2];
    return `${groupId}:${artifactId}`;
  }

  return null;
}

/**
 * Check if a package is from the Java standard library
 */
export function isJavaStandardLibrary(packagePath: string): boolean {
  const stdPrefixes = [
    'java.',
    'javax.',
    'sun.',
    'com.sun.',
    'jdk.',
    'org.w3c.',
    'org.xml.',
    'org.ietf.',
  ];
  
  return stdPrefixes.some(prefix => packagePath.startsWith(prefix));
}

/**
 * Map Maven groupId:artifactId to common name
 */
export const MAVEN_ARTIFACT_ALIASES: Record<string, string> = {
  // Apache Commons
  'commons-lang3': 'org.apache.commons:commons-lang3',
  'commons-io': 'commons-io:commons-io',
  'commons-codec': 'commons-codec:commons-codec',
  
  // JSON
  'gson': 'com.google.code.gson:gson',
  'jackson': 'com.fasterxml.jackson.core:jackson-databind',
  
  // HTTP
  'httpclient': 'org.apache.httpcomponents:httpclient',
  'okhttp': 'com.squareup.okhttp3:okhttp',
  
  // Logging
  'slf4j': 'org.slf4j:slf4j-api',
  'log4j': 'org.apache.logging.log4j:log4j-core',
  'logback': 'ch.qos.logback:logback-classic',
  
  // Testing
  'junit': 'junit:junit',
  'junit5': 'org.junit.jupiter:junit-jupiter',
  'mockito': 'org.mockito:mockito-core',
  
  // Spring
  'spring-core': 'org.springframework:spring-core',
  'spring-boot': 'org.springframework.boot:spring-boot',
  
  // Google
  'guava': 'com.google.guava:guava',
  'protobuf': 'com.google.protobuf:protobuf-java',
  
  // Other
  'lombok': 'org.projectlombok:lombok',
};

/**
 * Dynamic class loading detection result
 */
export interface ReflectionWarning {
  type: 'Class.forName' | 'loadClass' | 'newInstance' | 'getMethod' | 'invoke';
  location: CodeLocation;
  className?: string; // If detectable from string literal
}

/**
 * Detect reflection/dynamic class loading in Java code
 */
export function detectReflection(source: string, file: string): ReflectionWarning[] {
  const warnings: ReflectionWarning[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Class.forName("className")
    const forNameMatch = trimmed.match(/Class\.forName\s*\(\s*"([^"]+)"/);
    if (forNameMatch) {
      warnings.push({
        type: 'Class.forName',
        location: { file, line: lineNum, snippet: trimmed.slice(0, 100) },
        className: forNameMatch[1]
      });
    }

    // .loadClass("className")
    const loadClassMatch = trimmed.match(/\.loadClass\s*\(\s*"([^"]+)"/);
    if (loadClassMatch) {
      warnings.push({
        type: 'loadClass',
        location: { file, line: lineNum, snippet: trimmed.slice(0, 100) },
        className: loadClassMatch[1]
      });
    }

    // .newInstance()
    if (trimmed.includes('.newInstance()')) {
      warnings.push({
        type: 'newInstance',
        location: { file, line: lineNum, snippet: trimmed.slice(0, 100) }
      });
    }

    // .getMethod("methodName"
    const getMethodMatch = trimmed.match(/\.getMethod\s*\(\s*"([^"]+)"/);
    if (getMethodMatch) {
      warnings.push({
        type: 'getMethod',
        location: { file, line: lineNum, snippet: trimmed.slice(0, 100) }
      });
    }

    // .invoke(
    if (trimmed.includes('.invoke(')) {
      warnings.push({
        type: 'invoke',
        location: { file, line: lineNum, snippet: trimmed.slice(0, 100) }
      });
    }
  }

  return warnings;
}
