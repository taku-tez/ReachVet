/**
 * ReachVet - Clojure Import Parser
 * 
 * Parses Clojure import/require/use statements:
 * - (ns my.namespace (:require [lib.core :as core]) (:import [java.util Date]))
 * - (require '[clojure.string :as str])
 * - (require '[lib.core :refer [func1 func2]])
 * - (use 'clojure.walk)
 * - (import '[java.util Date ArrayList])
 */

import type { CodeLocation } from '../../types.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ClojureImportInfo {
  /** The namespace/class being imported */
  namespaceName: string;
  /** Import style */
  importStyle: 'require' | 'use' | 'import';
  /** Alias if any */
  alias?: string;
  /** Referred symbols (for :refer) */
  referred?: string[];
  /** Whether :refer :all is used */
  referAll?: boolean;
  /** Location in source */
  location: CodeLocation;
}

export interface ClojureUsageInfo {
  /** Namespace/function being used */
  identifier: string;
  /** Function being called */
  function?: string;
  /** Location in source */
  location: CodeLocation;
}

export interface DepsDependency {
  name: string;
  version?: string;
  gitUrl?: string;
  sha?: string;
  localRoot?: string;
}

export interface ProjectDependency {
  name: string;
  version: string;
}

// Map Clojure package names to their namespaces
const PACKAGE_TO_NAMESPACE: Record<string, string[]> = {
  // Core
  'org.clojure/clojure': ['clojure.core', 'clojure.string', 'clojure.set', 'clojure.walk'],
  'org.clojure/clojurescript': ['cljs.core'],
  'org.clojure/spec.alpha': ['clojure.spec.alpha'],
  'org.clojure/core.async': ['clojure.core.async'],
  'org.clojure/core.match': ['clojure.core.match'],
  'org.clojure/core.logic': ['clojure.core.logic'],
  'org.clojure/data.json': ['clojure.data.json'],
  'org.clojure/data.csv': ['clojure.data.csv'],
  'org.clojure/data.xml': ['clojure.data.xml'],
  'org.clojure/tools.logging': ['clojure.tools.logging'],
  'org.clojure/tools.cli': ['clojure.tools.cli'],
  'org.clojure/tools.namespace': ['clojure.tools.namespace'],
  'org.clojure/java.jdbc': ['clojure.java.jdbc'],
  
  // HTTP
  'clj-http/clj-http': ['clj-http.client', 'clj-http.core'],
  'http-kit/http-kit': ['org.httpkit.client', 'org.httpkit.server'],
  'aleph/aleph': ['aleph.http', 'aleph.tcp', 'aleph.netty'],
  'ring/ring': ['ring.adapter.jetty', 'ring.middleware', 'ring.util.response'],
  'ring/ring-core': ['ring.middleware', 'ring.util.response'],
  'ring/ring-jetty-adapter': ['ring.adapter.jetty'],
  'metosin/reitit': ['reitit.core', 'reitit.ring', 'reitit.coercion'],
  'compojure/compojure': ['compojure.core', 'compojure.route'],
  'bidi/bidi': ['bidi.bidi', 'bidi.ring'],
  
  // JSON
  'cheshire/cheshire': ['cheshire.core'],
  'metosin/jsonista': ['jsonista.core'],
  'clojure-msgpack/clojure-msgpack': ['msgpack.core'],
  
  // Database
  'seancorfield/next.jdbc': ['next.jdbc', 'next.jdbc.sql', 'next.jdbc.result-set'],
  'com.github.seancorfield/next.jdbc': ['next.jdbc', 'next.jdbc.sql'],
  'org.postgresql/postgresql': [],
  'mysql/mysql-connector-java': [],
  'com.layerware/hugsql': ['hugsql.core'],
  'korma/korma': ['korma.core', 'korma.db'],
  'toucan/toucan': ['toucan.db', 'toucan.models'],
  'honeysql/honeysql': ['honeysql.core', 'honeysql.helpers'],
  'com.github.seancorfield/honeysql': ['honey.sql', 'honey.sql.helpers'],
  
  // Logging
  'io.pedestal/pedestal.log': ['io.pedestal.log'],
  'com.taoensso/timbre': ['taoensso.timbre'],
  'ch.qos.logback/logback-classic': [],
  'org.slf4j/slf4j-api': [],
  
  // Testing
  'lambdaisland/kaocha': ['kaocha.repl'],
  'nubank/matcher-combinators': ['matcher-combinators.core', 'matcher-combinators.matchers'],
  'mock-clj/mock-clj': ['mock-clj.core'],
  
  // Validation
  'metosin/malli': ['malli.core', 'malli.transform', 'malli.error'],
  'prismatic/schema': ['schema.core'],
  
  // State Management
  'mount/mount': ['mount.core'],
  'integrant/integrant': ['integrant.core'],
  'com.stuartsierra/component': ['com.stuartsierra.component'],
  
  // Async
  'manifold/manifold': ['manifold.deferred', 'manifold.stream'],
  
  // Date/Time
  'clj-time/clj-time': ['clj-time.core', 'clj-time.format', 'clj-time.coerce'],
  'tick/tick': ['tick.core', 'tick.alpha.api'],
  
  // Config
  'aero/aero': ['aero.core'],
  'environ/environ': ['environ.core'],
  'cprop/cprop': ['cprop.core', 'cprop.source'],
  
  // Crypto
  'buddy/buddy-core': ['buddy.core.crypto', 'buddy.core.codecs', 'buddy.core.hash'],
  'buddy/buddy-auth': ['buddy.auth', 'buddy.auth.middleware'],
  'buddy/buddy-sign': ['buddy.sign.jwt', 'buddy.sign.jws'],
  
  // AWS
  'amazonica/amazonica': ['amazonica.aws.s3', 'amazonica.aws.sqs', 'amazonica.aws.dynamodbv2'],
  'com.cognitect.aws/api': ['cognitect.aws.client.api'],
  'com.cognitect.aws/s3': [],
  
  // HTML/Templates
  'hiccup/hiccup': ['hiccup.core', 'hiccup.page', 'hiccup.element'],
  'selmer/selmer': ['selmer.parser', 'selmer.filters'],
  'enlive/enlive': ['net.cgrand.enlive-html'],
  
  // Utilities
  'medley/medley': ['medley.core'],
  'prismatic/plumbing': ['plumbing.core'],
  'weavejester/dependency': ['com.stuartsierra.dependency'],
  
  // GraphQL
  'com.walmartlabs/lacinia': ['com.walmartlabs.lacinia', 'com.walmartlabs.lacinia.schema'],
  
  // Kafka
  'fundingcircle/jackdaw': ['jackdaw.client', 'jackdaw.streams'],
  
  // Redis
  'com.taoensso/carmine': ['taoensso.carmine'],
  
  // REPL/Dev
  'nrepl/nrepl': ['nrepl.server'],
  'cider/cider-nrepl': ['cider.nrepl'],
  'hashp/hashp': ['hashp.core'],
};

// Clojure standard library namespaces
const STANDARD_NAMESPACES = new Set([
  'clojure.core',
  'clojure.string',
  'clojure.set',
  'clojure.walk',
  'clojure.zip',
  'clojure.pprint',
  'clojure.repl',
  'clojure.test',
  'clojure.edn',
  'clojure.java.io',
  'clojure.java.shell',
  'clojure.reflect',
  'clojure.stacktrace',
  'clojure.template',
  'clojure.xml',
  'clojure.main',
  'clojure.instant',
  'clojure.uuid',
  'cljs.core',
  'cljs.pprint',
  'cljs.reader',
]);

/**
 * Parse Clojure source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.clj'): ClojureImportInfo[] {
  const imports: ClojureImportInfo[] = [];
  const lines = source.split('\n');

  // Track which line we're on
  let lineBuffer = '';
  let bufferStartLine = 0;
  let parenDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith(';') || trimmed.startsWith('#_')) {
      continue;
    }

    // Track paren depth for multiline forms
    const openCount = (line.match(/\(/g) || []).length;
    const closeCount = (line.match(/\)/g) || []).length;
    
    if (lineBuffer === '') {
      bufferStartLine = lineNum;
    }
    lineBuffer += (lineBuffer ? ' ' : '') + line;
    parenDepth += openCount - closeCount;

    // If we've completed a form (or single line), process it
    if (parenDepth <= 0) {
      const combined = lineBuffer;
      lineBuffer = '';
      parenDepth = 0;

      // Parse ns form
      const nsMatch = combined.match(/\(\s*ns\s+([a-zA-Z0-9._-]+)/);
      if (nsMatch) {
        // Extract :require blocks
        parseNsRequire(combined, imports, fileName, bufferStartLine);
        // Extract :import blocks
        parseNsImport(combined, imports, fileName, bufferStartLine);
        // Extract :use blocks
        parseNsUse(combined, imports, fileName, bufferStartLine);
        continue;
      }

      // Parse standalone (require ...)
      if (/\(\s*require\s/.test(combined)) {
        parseRequire(combined, imports, fileName, bufferStartLine);
        continue;
      }

      // Parse standalone (use ...)
      if (/\(\s*use\s/.test(combined)) {
        parseUse(combined, imports, fileName, bufferStartLine);
        continue;
      }

      // Parse standalone (import ...)
      if (/\(\s*import\s/.test(combined)) {
        parseImportStandalone(combined, imports, fileName, bufferStartLine);
        continue;
      }
    }
  }

  return imports;
}

/**
 * Parse :require from ns form
 */
function parseNsRequire(source: string, imports: ClojureImportInfo[], fileName: string, lineNum: number): void {
  // Match (:require ...) block
  const requireMatch = source.match(/\(:require\s+([\s\S]*?)\)(?=\s*(?:\(:|$|\)))/);
  if (!requireMatch) return;

  const requireBlock = requireMatch[1];
  
  // First pattern: vector form with possible :as and :refer
  let match;
  const vectorPattern = /\[\s*([a-zA-Z0-9._-]+)(?:\s+:as\s+([a-zA-Z0-9._-]+))?(?:\s+:refer\s+(?::all|\[([^\]]*)\]))?\s*\]/g;
  while ((match = vectorPattern.exec(requireBlock)) !== null) {
    const ns = match[1];
    const alias = match[2];
    const referred = match[3]?.split(/\s+/).filter(Boolean);
    const referAll = requireBlock.includes(':refer :all');

    imports.push({
      namespaceName: ns,
      importStyle: 'require',
      alias,
      referred: referred?.length ? referred : undefined,
      referAll,
      location: {
        file: fileName,
        line: lineNum,
        snippet: `(:require [${ns}${alias ? ' :as ' + alias : ''}])`
      }
    });
  }
}

/**
 * Parse :use from ns form
 */
function parseNsUse(source: string, imports: ClojureImportInfo[], fileName: string, lineNum: number): void {
  const useMatch = source.match(/\(:use\s+([\s\S]*?)\)(?=\s*(?:\(:|$|\)))/);
  if (!useMatch) return;

  const useBlock = useMatch[1];
  const foundNamespaces = new Set<string>();
  
  // Match [namespace] or namespace or [namespace :only [...]]
  const vectorPattern = /\[\s*([a-zA-Z0-9._-]+)(?:\s+:only\s+\[([^\]]*)\])?\s*\]/g;
  let match;
  while ((match = vectorPattern.exec(useBlock)) !== null) {
    const ns = match[1];
    const only = match[2]?.split(/\s+/).filter(Boolean);
    foundNamespaces.add(ns);

    imports.push({
      namespaceName: ns,
      importStyle: 'use',
      referred: only?.length ? only : undefined,
      referAll: !only?.length,
      location: {
        file: fileName,
        line: lineNum,
        snippet: `(:use [${ns}])`
      }
    });
  }

  // Simple namespace (without vector) - only at the start or after whitespace
  // Match 'namespace or namespace but not inside vectors
  const simplePattern = /(?:^|\s)'?([a-zA-Z][a-zA-Z0-9._-]*)(?=\s|$)/g;
  while ((match = simplePattern.exec(useBlock)) !== null) {
    const ns = match[1];
    // Skip if already found in vector form or if it's a keyword
    if (foundNamespaces.has(ns) || ns.startsWith(':') || ns === 'only') {
      continue;
    }

    imports.push({
      namespaceName: ns,
      importStyle: 'use',
      referAll: true,
      location: {
        file: fileName,
        line: lineNum,
        snippet: `(:use ${ns})`
      }
    });
    foundNamespaces.add(ns);
  }
}

/**
 * Parse :import from ns form
 */
function parseNsImport(source: string, imports: ClojureImportInfo[], fileName: string, lineNum: number): void {
  const importMatch = source.match(/\(:import\s+([\s\S]*?)\)(?=\s*(?:\(:|$|\)))/);
  if (!importMatch) return;

  const importBlock = importMatch[1];
  
  // Match [java.package Class1 Class2] or (java.package Class1 Class2)
  const vectorPattern = /[\[(]\s*([a-zA-Z0-9._]+)\s+([^\]\)]+)[\])]/g;
  let match;
  while ((match = vectorPattern.exec(importBlock)) !== null) {
    const pkg = match[1];
    const classes = match[2].split(/\s+/).filter(Boolean);
    
    for (const cls of classes) {
      imports.push({
        namespaceName: `${pkg}.${cls}`,
        importStyle: 'import',
        location: {
          file: fileName,
          line: lineNum,
          snippet: `(:import [${pkg} ${cls}])`
        }
      });
    }
  }

  // Simple fully qualified class
  const simplePattern = /([a-zA-Z0-9._]+\.[A-Z][a-zA-Z0-9_]*)(?!\s*[^\s\]\)])/g;
  while ((match = simplePattern.exec(importBlock)) !== null) {
    if (!importBlock.includes(`[${match[1].substring(0, match[1].lastIndexOf('.'))}`)) {
      imports.push({
        namespaceName: match[1],
        importStyle: 'import',
        location: {
          file: fileName,
          line: lineNum,
          snippet: `(:import ${match[1]})`
        }
      });
    }
  }
}

/**
 * Parse standalone (require ...) form
 */
function parseRequire(source: string, imports: ClojureImportInfo[], fileName: string, lineNum: number): void {
  // (require '[lib.core :as c])
  const vectorPattern = /\[\s*([a-zA-Z0-9._-]+)(?:\s+:as\s+([a-zA-Z0-9._-]+))?(?:\s+:refer\s+(?::all|\[([^\]]*)\]))?\s*\]/g;
  let match;
  while ((match = vectorPattern.exec(source)) !== null) {
    imports.push({
      namespaceName: match[1],
      importStyle: 'require',
      alias: match[2],
      referred: match[3]?.split(/\s+/).filter(Boolean),
      location: {
        file: fileName,
        line: lineNum,
        snippet: source.trim().slice(0, 100)
      }
    });
  }

  // (require 'lib.core)
  const simplePattern = /'([a-zA-Z0-9._-]+)(?!\s*[:\[])/g;
  while ((match = simplePattern.exec(source)) !== null) {
    if (!source.includes(`[${match[1]}`)) {
      imports.push({
        namespaceName: match[1],
        importStyle: 'require',
        location: {
          file: fileName,
          line: lineNum,
          snippet: source.trim().slice(0, 100)
        }
      });
    }
  }
}

/**
 * Parse standalone (use ...) form
 */
function parseUse(source: string, imports: ClojureImportInfo[], fileName: string, lineNum: number): void {
  // (use '[lib.core :only [x y]])
  const vectorPattern = /\[\s*([a-zA-Z0-9._-]+)(?:\s+:only\s+\[([^\]]*)\])?\s*\]/g;
  let match;
  while ((match = vectorPattern.exec(source)) !== null) {
    imports.push({
      namespaceName: match[1],
      importStyle: 'use',
      referred: match[2]?.split(/\s+/).filter(Boolean),
      referAll: !match[2],
      location: {
        file: fileName,
        line: lineNum,
        snippet: source.trim().slice(0, 100)
      }
    });
  }

  // (use 'lib.core)
  const simplePattern = /'([a-zA-Z0-9._-]+)(?!\s*[:\[])/g;
  while ((match = simplePattern.exec(source)) !== null) {
    if (!source.includes(`[${match[1]}`)) {
      imports.push({
        namespaceName: match[1],
        importStyle: 'use',
        referAll: true,
        location: {
          file: fileName,
          line: lineNum,
          snippet: source.trim().slice(0, 100)
        }
      });
    }
  }
}

/**
 * Parse standalone (import ...) form
 */
function parseImportStandalone(source: string, imports: ClojureImportInfo[], fileName: string, lineNum: number): void {
  // (import '[java.util Date ArrayList])
  const vectorPattern = /[\[(]\s*([a-zA-Z0-9._]+)\s+([^\]\)]+)[\])]/g;
  let match;
  while ((match = vectorPattern.exec(source)) !== null) {
    const pkg = match[1];
    const classes = match[2].split(/\s+/).filter(Boolean);
    
    for (const cls of classes) {
      imports.push({
        namespaceName: `${pkg}.${cls}`,
        importStyle: 'import',
        location: {
          file: fileName,
          line: lineNum,
          snippet: source.trim().slice(0, 100)
        }
      });
    }
  }
}

/**
 * Find namespace/function usages in source code
 */
export function findNamespaceUsages(source: string, namespaceNames: string[], fileName: string = 'file.clj'): ClojureUsageInfo[] {
  const usages: ClojureUsageInfo[] = [];
  const lines = source.split('\n');

  // Build alias map from source
  const aliasMap = new Map<string, string>();
  const imports = parseSource(source, fileName);
  for (const imp of imports) {
    if (imp.alias) {
      aliasMap.set(imp.alias, imp.namespaceName);
    }
  }

  // Build patterns for namespace names and aliases
  const allPatterns: string[] = [];
  for (const ns of namespaceNames) {
    allPatterns.push(ns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Add short form (last segment)
    const parts = ns.split('.');
    if (parts.length > 1) {
      allPatterns.push(parts[parts.length - 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  }
  // Add known aliases
  for (const [alias, ns] of aliasMap) {
    if (namespaceNames.includes(ns)) {
      allPatterns.push(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  }

  if (allPatterns.length === 0) return usages;

  const nsPattern = allPatterns.join('|');
  // Match ns/function or (ns/function ...)
  const regex = new RegExp(`(?:^|[\\s(])(?:${nsPattern})/([a-zA-Z0-9_!?*+-]+)`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    if (line.trim().startsWith(';')) {
      continue;
    }

    // Skip ns/require/use/import forms
    if (/^\s*\(\s*(ns|require|use|import)\s/.test(line)) {
      continue;
    }

    let match;
    while ((match = regex.exec(line)) !== null) {
      usages.push({
        identifier: match[0].trim().replace(/^[(]/, ''),
        function: match[1],
        location: {
          file: fileName,
          line: lineNum,
          column: match.index + 1,
          snippet: line.trim().slice(0, 100)
        }
      });
    }
  }

  return usages;
}

/**
 * Parse deps.edn file
 */
export async function parseDepsEdn(filePath: string): Promise<DepsDependency[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return parseDepsEdnContent(content);
  } catch {
    return [];
  }
}

/**
 * Extract balanced braces content starting from position
 */
function extractBalancedBraces(content: string, startPos: number): string | null {
  if (content[startPos] !== '{') return null;
  
  let depth = 0;
  let pos = startPos;
  
  while (pos < content.length) {
    const char = content[pos];
    if (char === '{') depth++;
    else if (char === '}') depth--;
    
    if (depth === 0) {
      return content.slice(startPos + 1, pos);
    }
    pos++;
  }
  
  return null;
}

/**
 * Parse deps.edn content
 */
export function parseDepsEdnContent(content: string): DepsDependency[] {
  const deps: DepsDependency[] = [];

  // Find :deps { position
  const depsKeyMatch = content.match(/:deps\s*\{/);
  if (!depsKeyMatch || depsKeyMatch.index === undefined) return deps;

  const braceStart = depsKeyMatch.index + depsKeyMatch[0].length - 1;
  const depsBlock = extractBalancedBraces(content, braceStart);
  if (!depsBlock) return deps;
  
  // Match package/name followed by { and extract its balanced content
  const packagePattern = /([a-zA-Z0-9._/-]+)\s*\{/g;
  let match;
  
  while ((match = packagePattern.exec(depsBlock)) !== null) {
    const name = match[1];
    // Position of { in depsBlock
    const optsBraceStart = match.index + match[0].length - 1;
    const opts = extractBalancedBraces(depsBlock, optsBraceStart);
    
    if (opts) {
      const versionMatch = opts.match(/:mvn\/version\s+"([^"]+)"/);
      const gitMatch = opts.match(/:git\/url\s+"([^"]+)"/);
      const shaMatch = opts.match(/:(?:git\/)?sha\s+"([^"]+)"/);
      const localMatch = opts.match(/:local\/root\s+"([^"]+)"/);

      deps.push({
        name,
        version: versionMatch?.[1],
        gitUrl: gitMatch?.[1],
        sha: shaMatch?.[1],
        localRoot: localMatch?.[1]
      });
    }
  }

  return deps;
}

/**
 * Parse project.clj (Leiningen) file
 */
export async function parseProjectClj(filePath: string): Promise<ProjectDependency[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return parseProjectCljContent(content);
  } catch {
    return [];
  }
}

/**
 * Parse project.clj content
 */
export function parseProjectCljContent(content: string): ProjectDependency[] {
  const deps: ProjectDependency[] = [];

  // Match :dependencies [[...] [...]]
  const depsMatch = content.match(/:dependencies\s*\[([\s\S]*?)\](?=\s*(?::|$|\)))/);
  if (!depsMatch) return deps;

  const depsBlock = depsMatch[1];
  
  // Match [package/name "version"]
  const depPattern = /\[\s*([a-zA-Z0-9._/-]+)\s+"([^"]+)"/g;
  let match;
  
  while ((match = depPattern.exec(depsBlock)) !== null) {
    deps.push({
      name: match[1],
      version: match[2]
    });
  }

  return deps;
}

/**
 * Get namespaces for a package
 */
export function getNamespacesForPackage(packageName: string): string[] {
  // Normalize package name (can be org/name or just name)
  const normalized = packageName.includes('/') ? packageName : `${packageName}/${packageName}`;
  
  if (PACKAGE_TO_NAMESPACE[normalized]) {
    return PACKAGE_TO_NAMESPACE[normalized];
  }
  if (PACKAGE_TO_NAMESPACE[packageName]) {
    return PACKAGE_TO_NAMESPACE[packageName];
  }

  // Infer from package name
  // e.g., "my-lib/my-lib" -> "my-lib.core"
  const parts = packageName.split('/');
  const libName = parts[parts.length - 1];
  return [`${libName}.core`, libName];
}

/**
 * Check if a namespace is from standard library
 */
export function isStandardNamespace(namespace: string): boolean {
  return STANDARD_NAMESPACES.has(namespace) || 
         namespace.startsWith('clojure.') ||
         namespace.startsWith('cljs.') ||
         namespace.startsWith('java.');
}

/**
 * Detect project type from source directory
 */
export async function detectProjectType(sourceDir: string): Promise<'deps.edn' | 'leiningen' | 'unknown'> {
  if (existsSync(join(sourceDir, 'deps.edn'))) {
    return 'deps.edn';
  }
  if (existsSync(join(sourceDir, 'project.clj'))) {
    return 'leiningen';
  }
  return 'unknown';
}
