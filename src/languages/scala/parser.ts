/**
 * ReachVet - Scala Import Parser
 * 
 * Parses Scala import statements:
 * - import package.name.Class
 * - import package.name._
 * - import package.name.{Class1, Class2}
 * - import package.name.{Class => Alias}
 * - import package.name.given
 */

import type { CodeLocation } from '../../types.js';

export interface ScalaImportInfo {
  /** The package/object being imported */
  moduleName: string;
  /** Import style */
  importStyle: 'class' | 'wildcard' | 'selective' | 'alias' | 'given';
  /** Specific members imported (for selective imports) */
  members?: string[];
  /** Alias mappings */
  aliases?: Map<string, string>;
  /** Location in source */
  location: CodeLocation;
}

export interface ScalaUsageInfo {
  /** Type/class being used */
  identifier: string;
  /** Method being called */
  method?: string;
  /** Is it an object method (static-like) */
  isObjectMethod: boolean;
  /** Location in source */
  location: CodeLocation;
}

// Map artifact IDs to their packages
const ARTIFACT_TO_PACKAGE: Record<string, string[]> = {
  // Akka
  'akka-actor': ['akka.actor'],
  'akka-stream': ['akka.stream'],
  'akka-http': ['akka.http'],
  'akka-cluster': ['akka.cluster'],
  'akka-persistence': ['akka.persistence'],
  
  // Cats
  'cats-core': ['cats', 'cats.data', 'cats.syntax', 'cats.instances'],
  'cats-effect': ['cats.effect'],
  'cats-free': ['cats.free'],
  
  // ZIO
  'zio': ['zio', 'zio.stream'],
  'zio-json': ['zio.json'],
  'zio-http': ['zio.http'],
  'zio-kafka': ['zio.kafka'],
  'zio-test': ['zio.test'],
  
  // Play Framework
  'play': ['play.api', 'play.api.mvc', 'play.api.libs.json'],
  'play-json': ['play.api.libs.json'],
  'play-slick': ['play.api.db.slick'],
  
  // Database
  'slick': ['slick', 'slick.jdbc'],
  'doobie-core': ['doobie', 'doobie.implicits'],
  'quill': ['io.getquill'],
  'scalikejdbc': ['scalikejdbc'],
  
  // JSON
  'circe-core': ['io.circe', 'io.circe.syntax', 'io.circe.parser'],
  'circe-generic': ['io.circe.generic'],
  'spray-json': ['spray.json'],
  'json4s': ['org.json4s'],
  'upickle': ['upickle'],
  
  // HTTP
  'http4s-core': ['org.http4s'],
  'http4s-dsl': ['org.http4s.dsl'],
  'http4s-client': ['org.http4s.client'],
  'sttp-core': ['sttp.client3'],
  'requests-scala': ['requests'],
  
  // Streaming
  'fs2-core': ['fs2'],
  'monix': ['monix', 'monix.eval', 'monix.execution'],
  
  // Testing
  'scalatest': ['org.scalatest'],
  'specs2-core': ['org.specs2'],
  'munit': ['munit'],
  'scalacheck': ['org.scalacheck'],
  'mockito-scala': ['org.mockito'],
  
  // Logging
  'scala-logging': ['com.typesafe.scalalogging'],
  'logback-classic': ['ch.qos.logback'],
  
  // Config
  'pureconfig': ['pureconfig'],
  'typesafe-config': ['com.typesafe.config'],
  
  // Misc
  'shapeless': ['shapeless'],
  'refined': ['eu.timepit.refined'],
  'enumeratum': ['enumeratum'],
  'chimney': ['io.scalaland.chimney'],
  'monocle': ['monocle'],
  'spark-core': ['org.apache.spark', 'org.apache.spark.sql'],
  'spark-sql': ['org.apache.spark.sql'],
};

// Scala/Java standard packages
const STANDARD_PACKAGES = new Set([
  'scala', 'scala.collection', 'scala.concurrent', 'scala.io', 'scala.util',
  'scala.math', 'scala.reflect', 'scala.sys', 'scala.annotation',
  'java.lang', 'java.util', 'java.io', 'java.net', 'java.time', 'java.nio',
]);

/**
 * Parse Scala source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.scala'): ScalaImportInfo[] {
  const imports: ScalaImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Stop at class/object/trait/def (imports should be at top)
    if (/^(class|object|trait|case\s+class|sealed\s+trait|def|val|var)\s/.test(trimmed)) {
      break;
    }

    // import package.name.given (Scala 3)
    const givenMatch = trimmed.match(/^import\s+([A-Za-z0-9_.]+)\.given\s*$/);
    if (givenMatch) {
      imports.push({
        moduleName: givenMatch[1],
        importStyle: 'given',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // import package.name._ (wildcard)
    const wildcardMatch = trimmed.match(/^import\s+([A-Za-z0-9_.]+)\._\s*$/);
    if (wildcardMatch) {
      imports.push({
        moduleName: wildcardMatch[1],
        importStyle: 'wildcard',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // import package.name.{Class1, Class2, Old => New}
    const selectiveMatch = trimmed.match(/^import\s+([A-Za-z0-9_.]+)\.\{([^}]+)\}\s*$/);
    if (selectiveMatch) {
      const members: string[] = [];
      const aliases = new Map<string, string>();
      
      const memberParts = selectiveMatch[2].split(',').map(m => m.trim());
      for (const part of memberParts) {
        // Check for alias: Old => New
        const aliasMatch = part.match(/([A-Za-z0-9_]+)\s*=>\s*([A-Za-z0-9_]+)/);
        if (aliasMatch) {
          aliases.set(aliasMatch[1], aliasMatch[2]);
          members.push(aliasMatch[2]);
        } else if (part === '_') {
          // Wildcard in selective import
          members.push('_');
        } else {
          members.push(part);
        }
      }
      
      imports.push({
        moduleName: selectiveMatch[1],
        importStyle: aliases.size > 0 ? 'alias' : 'selective',
        members,
        aliases: aliases.size > 0 ? aliases : undefined,
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // import package.name.Class
    const classMatch = trimmed.match(/^import\s+([A-Za-z0-9_.]+)\s*$/);
    if (classMatch) {
      imports.push({
        moduleName: classMatch[1],
        importStyle: 'class',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }
  }

  return imports;
}

/**
 * Find usages of types/objects in source code
 */
export function findTypeUsages(source: string, typeNames: string[], fileName: string = 'file.scala'): ScalaUsageInfo[] {
  const usages: ScalaUsageInfo[] = [];
  const lines = source.split('\n');

  const patterns = typeNames.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (patterns.length === 0) return usages;

  const typePattern = patterns.join('|');
  // Match TypeName.method or TypeName[T] or TypeName(...)
  const regex = new RegExp(`\\b(${typePattern})(?:\\[|\\.|\\()`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Skip import lines
    if (trimmed.startsWith('import ')) {
      continue;
    }

    let match;
    while ((match = regex.exec(line)) !== null) {
      // Extract method if present
      const afterMatch = line.slice(match.index + match[1].length);
      const methodMatch = afterMatch.match(/^\.(\w+)/);
      
      usages.push({
        identifier: match[1],
        method: methodMatch ? methodMatch[1] : undefined,
        isObjectMethod: afterMatch.startsWith('.'),
        location: {
          file: fileName,
          line: lineNum,
          column: match.index + 1,
          snippet: trimmed.slice(0, 100)
        }
      });
    }
  }

  return usages;
}

/**
 * Get packages for an artifact
 */
export function getPackagesForArtifact(artifactId: string): string[] {
  // Try direct match
  if (ARTIFACT_TO_PACKAGE[artifactId]) {
    return ARTIFACT_TO_PACKAGE[artifactId];
  }

  // Try with _2.13, _3 suffix stripped
  const baseArtifact = artifactId.replace(/_[23]\.?\d*$/, '');
  if (ARTIFACT_TO_PACKAGE[baseArtifact]) {
    return ARTIFACT_TO_PACKAGE[baseArtifact];
  }

  // Infer from artifact name
  return [
    artifactId.replace(/-/g, '.'),
    artifactId.replace(/_/g, '.'),
  ];
}

/**
 * Check if a package is from standard library
 */
export function isStandardPackage(packageName: string): boolean {
  if (STANDARD_PACKAGES.has(packageName)) {
    return true;
  }
  
  for (const std of STANDARD_PACKAGES) {
    if (packageName.startsWith(std + '.')) {
      return true;
    }
  }
  
  return false;
}
