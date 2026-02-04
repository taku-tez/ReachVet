/**
 * ReachVet - OCaml Import Parser
 * Parses OCaml open/include statements, dune files, and opam files
 */

import type { CodeLocation } from '../../types.js';

export interface OCamlOpenInfo {
  // Module name (e.g., 'Printf', 'Lwt.Syntax')
  moduleName: string;
  // Type: open, include, module alias, local open
  kind: 'open' | 'include' | 'alias' | 'local_open' | 'qualified';
  // Alias name (for module M = N)
  alias?: string;
  // Is open! (shadow warnings suppressed)
  bang?: boolean;
  // Location
  location: CodeLocation;
}

export interface DuneDependency {
  // Library/package name
  name: string;
  // Optional version constraint
  version?: string;
}

export interface DuneLibrary {
  // Library name (internal)
  name: string;
  // Public name (package.lib format)
  publicName?: string;
  // Dependencies
  libraries: string[];
}

export interface DuneExecutable {
  // Executable name
  name: string;
  // Dependencies
  libraries: string[];
}

export interface DuneInfo {
  // Libraries defined
  libraries: DuneLibrary[];
  // Executables defined
  executables: DuneExecutable[];
  // All dependencies collected
  dependencies: DuneDependency[];
}

export interface OpamDependency {
  // Package name
  name: string;
  // Version constraint
  version?: string;
}

export interface OpamInfo {
  // Package name
  name: string;
  // Package version
  version: string;
  // Dependencies
  depends: OpamDependency[];
  // Dev dependencies (with-test, with-doc)
  devDepends: OpamDependency[];
  // Build dependencies
  buildDepends: OpamDependency[];
}

/**
 * Common OPAM package to module mapping
 * Maps package name to typical module names
 */
export const OPAM_PACKAGE_TO_MODULES: Record<string, string[]> = {
  // Core/Standard Library Extensions
  'base': ['Base', 'Base.List', 'Base.String', 'Base.Int', 'Base.Float', 'Base.Option', 'Base.Result'],
  'core': ['Core', 'Core.Unix', 'Core.Time', 'Core.Command'],
  'core_kernel': ['Core_kernel', 'Core_kernel.Time_ns'],
  'containers': ['Containers', 'CCList', 'CCString', 'CCOpt', 'CCResult'],
  'batteries': ['BatList', 'BatString', 'BatIO', 'BatEnum', 'BatPervasives'],
  'stdint': ['Stdint', 'Int8', 'Int16', 'Int32', 'Int64', 'Uint8', 'Uint16'],
  
  // Concurrency
  'lwt': ['Lwt', 'Lwt.Syntax', 'Lwt_io', 'Lwt_unix', 'Lwt_stream', 'Lwt_list'],
  'lwt_ppx': ['Lwt', 'Lwt.Syntax'],
  'async': ['Async', 'Async_kernel', 'Async_unix', 'Deferred'],
  'async_kernel': ['Async_kernel', 'Deferred'],
  'async_unix': ['Async_unix'],
  'eio': ['Eio', 'Eio.Fiber', 'Eio.Promise', 'Eio_main'],
  
  // Web/HTTP
  'cohttp': ['Cohttp', 'Cohttp_lwt', 'Cohttp_lwt_unix'],
  'cohttp-lwt': ['Cohttp_lwt', 'Cohttp_lwt_unix'],
  'cohttp-async': ['Cohttp_async'],
  'dream': ['Dream'],
  'opium': ['Opium', 'Opium.App'],
  'httpaf': ['Httpaf', 'Httpaf_lwt_unix'],
  'piaf': ['Piaf'],
  'ocaml-tls': ['Tls', 'Tls_lwt'],
  'tls': ['Tls', 'Tls_lwt'],
  'ssl': ['Ssl'],
  
  // JSON/Serialization
  'yojson': ['Yojson', 'Yojson.Safe', 'Yojson.Basic'],
  'jsonm': ['Jsonm'],
  'ezjsonm': ['Ezjsonm'],
  'atdgen': ['Atdgen_runtime'],
  'ppx_deriving_yojson': ['Ppx_deriving_yojson_runtime'],
  'ppx_yojson_conv': [],
  
  // Parsing
  'menhir': ['MenhirLib'],
  'ocamllex': [],
  'sedlex': ['Sedlex', 'Sedlex.Utf8'],
  'angstrom': ['Angstrom'],
  're': ['Re', 'Re.Pcre', 'Re.Posix', 'Re.Glob'],
  'pcre': ['Pcre'],
  
  // Database
  'caqti': ['Caqti', 'Caqti_lwt', 'Caqti_async'],
  'caqti-lwt': ['Caqti_lwt'],
  'caqti-async': ['Caqti_async'],
  'caqti-driver-postgresql': [],
  'caqti-driver-sqlite3': [],
  'caqti-driver-mariadb': [],
  'pgocaml': ['PGOCaml'],
  'postgresql': ['Postgresql'],
  'sqlite3': ['Sqlite3'],
  'mysql': ['Mysql'],
  'irmin': ['Irmin', 'Irmin_mem', 'Irmin_fs'],
  
  // Testing
  'alcotest': ['Alcotest'],
  'ounit': ['OUnit', 'OUnit2'],
  'ounit2': ['OUnit2'],
  'qcheck': ['QCheck', 'QCheck2'],
  'crowbar': ['Crowbar'],
  'expect_test_helpers_core': [],
  
  // Build/CLI
  'cmdliner': ['Cmdliner', 'Cmdliner.Arg', 'Cmdliner.Term'],
  'dune': [],
  'dune-build-info': ['Build_info'],
  
  // Logging
  'logs': ['Logs', 'Logs_lwt'],
  'fmt': ['Fmt'],
  
  // Crypto
  'digestif': ['Digestif', 'Digestif.SHA256', 'Digestif.MD5'],
  'mirage-crypto': ['Mirage_crypto', 'Mirage_crypto_rng'],
  'mirage-crypto-pk': ['Mirage_crypto_pk', 'Mirage_crypto_pk.Rsa'],
  'nocrypto': ['Nocrypto'],
  'cryptokit': ['Cryptokit'],
  
  // Data Structures
  'zarith': ['Z', 'Q'],
  'bigarray': ['Bigarray'],
  'bigstringaf': ['Bigstringaf'],
  'cstruct': ['Cstruct'],
  'astring': ['Astring', 'Astring.String'],
  'stringext': ['Stringext'],
  'fpath': ['Fpath'],
  'bos': ['Bos', 'Bos.OS'],
  'rresult': ['Rresult', 'R'],
  
  // PPX/Metaprogramming
  'ppx_deriving': ['Ppx_deriving_runtime'],
  'ppx_jane': [],
  'ppx_sexp_conv': ['Sexplib0', 'Ppx_sexp_conv_lib'],
  'ppx_compare': ['Ppx_compare_lib'],
  'ppx_hash': ['Ppx_hash_lib'],
  'ppx_inline_test': [],
  'ppx_expect': [],
  'ppx_let': [],
  
  // Sexp
  'sexplib': ['Sexplib', 'Sexp'],
  'sexplib0': ['Sexplib0'],
  'parsexp': ['Parsexp'],
  
  // Network/Protocol
  'uri': ['Uri'],
  'ipaddr': ['Ipaddr', 'Ipaddr.V4', 'Ipaddr.V6'],
  'domain-name': ['Domain_name'],
  'dns': ['Dns', 'Dns_client'],
  'conduit': ['Conduit', 'Conduit_lwt'],
  'websocket': ['Websocket', 'Websocket_lwt_unix'],
  
  // XML/HTML
  'xmlm': ['Xmlm'],
  'markup': ['Markup', 'Markup_lwt'],
  'lambdasoup': ['Soup'],
  'tyxml': ['Tyxml', 'Tyxml.Html', 'Tyxml.Svg'],
  
  // Graphics/UI
  'graphics': ['Graphics'],
  'lablgtk': ['GMain', 'GWindow', 'GMisc'],
  'tsdl': ['Tsdl', 'Sdl'],
  'notty': ['Notty', 'Notty_unix'],
  
  // System
  'unix': ['Unix'],
  'threads': ['Thread', 'Mutex', 'Condition'],
  'fileutils': ['FileUtil'],
  
  // Math/Science
  'owl': ['Owl', 'Owl.Dense', 'Owl.Linalg'],
  'lacaml': ['Lacaml'],
  'gsl': ['Gsl'],
  
  // Error Handling
  'result': ['Result'],
  'option': ['Option'],
};

/**
 * Standard library modules (don't need external packages)
 */
export const STDLIB_MODULES = new Set([
  // Core modules (always available)
  'Pervasives', 'Stdlib',
  // Standard library modules
  'Arg', 'Array', 'ArrayLabels', 'Bigarray', 'Bool', 'Buffer', 'Bytes', 'BytesLabels',
  'Callback', 'Char', 'Complex', 'Digest', 'Either', 'Ephemeron', 'Filename', 'Float',
  'Format', 'Fun', 'Gc', 'Hashtbl', 'In_channel', 'Int', 'Int32', 'Int64', 'Lazy',
  'Lexing', 'List', 'ListLabels', 'Map', 'Marshal', 'MoreLabels', 'Nativeint', 'Obj',
  'Oo', 'Option', 'Out_channel', 'Parsing', 'Printexc', 'Printf', 'Queue', 'Random',
  'Result', 'Scanf', 'Seq', 'Set', 'Stack', 'StdLabels', 'Stream', 'String', 'StringLabels',
  'Sys', 'Uchar', 'Unit', 'Unix', 'Weak',
  // Compiler libs
  'Compiler_libs', 'Dynlink',
  // Runtime
  'CamlinternalFormat', 'CamlinternalFormatBasics', 'CamlinternalLazy', 'CamlinternalMod',
  'CamlinternalOO',
]);

/**
 * Parse OCaml source code to extract open/include/module statements
 */
export function parseOCamlSource(content: string, filePath: string): OCamlOpenInfo[] {
  const results: OCamlOpenInfo[] = [];
  const lines = content.split('\n');
  
  // Track if we're in a comment or string
  let inBlockComment = 0;
  let inString = false;
  
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;
    
    // Simple comment/string tracking (not perfect but good enough)
    for (let i = 0; i < line.length; i++) {
      if (line.substring(i, i + 2) === '(*' && !inString) {
        inBlockComment++;
        i++;
      } else if (line.substring(i, i + 2) === '*)' && !inString && inBlockComment > 0) {
        inBlockComment--;
        i++;
      }
    }
    
    if (inBlockComment > 0) continue;
    
    // Skip string contents
    let processedLine = line;
    // Remove strings for processing
    processedLine = processedLine.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    
    // Match: open Module or open! Module
    const openMatch = processedLine.match(/^\s*open(!?)\s+([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)/);
    if (openMatch) {
      results.push({
        moduleName: openMatch[2],
        kind: 'open',
        bang: openMatch[1] === '!',
        location: { file: filePath, line: lineNum, column: openMatch.index! + 1 }
      });
    }
    
    // Match: include Module
    const includeMatch = processedLine.match(/^\s*include\s+([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)/);
    if (includeMatch) {
      results.push({
        moduleName: includeMatch[1],
        kind: 'include',
        location: { file: filePath, line: lineNum, column: includeMatch.index! + 1 }
      });
    }
    
    // Match: module M = N (module alias)
    const aliasMatch = processedLine.match(/^\s*module\s+([A-Z][A-Za-z0-9_]*)\s*=\s*([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)/);
    if (aliasMatch) {
      results.push({
        moduleName: aliasMatch[2],
        kind: 'alias',
        alias: aliasMatch[1],
        location: { file: filePath, line: lineNum, column: aliasMatch.index! + 1 }
      });
    }
    
    // Match: let open Module in ... (local open)
    const letOpenRegex = /let\s+open\s+([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)\s+in/g;
    let letOpenMatch;
    while ((letOpenMatch = letOpenRegex.exec(processedLine)) !== null) {
      results.push({
        moduleName: letOpenMatch[1],
        kind: 'local_open',
        location: { file: filePath, line: lineNum, column: letOpenMatch.index + 1 }
      });
    }
    
    // Match: Module.(expr) (local open expression)
    const localOpenExprRegex = /([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)\.\(/g;
    let localOpenExprMatch;
    while ((localOpenExprMatch = localOpenExprRegex.exec(processedLine)) !== null) {
      results.push({
        moduleName: localOpenExprMatch[1],
        kind: 'local_open',
        location: { file: filePath, line: lineNum, column: localOpenExprMatch.index + 1 }
      });
    }
    
    // Match: Module.function (qualified access)
    const qualifiedRegex = /([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)\.([a-z_][a-z0-9_]*)/g;
    let qualifiedMatch;
    while ((qualifiedMatch = qualifiedRegex.exec(processedLine)) !== null) {
      // Skip if already captured as local open
      if (processedLine.charAt(qualifiedMatch.index + qualifiedMatch[0].length) === '(') continue;
      results.push({
        moduleName: qualifiedMatch[1],
        kind: 'qualified',
        location: { file: filePath, line: lineNum, column: qualifiedMatch.index + 1 }
      });
    }
  }
  
  return results;
}

/**
 * Parse a dune file to extract library/executable definitions and dependencies
 */
export function parseDuneFile(content: string): DuneInfo {
  const libraries: DuneLibrary[] = [];
  const executables: DuneExecutable[] = [];
  const dependencies = new Map<string, DuneDependency>();
  
  // Parse S-expressions (simplified)
  const sexps = parseSexps(content);
  
  for (const sexp of sexps) {
    if (!Array.isArray(sexp) || sexp.length === 0) continue;
    
    const type = sexp[0];
    
    if (type === 'library') {
      const lib = parseLibraryStanza(sexp.slice(1));
      if (lib) {
        libraries.push(lib);
        for (const dep of lib.libraries) {
          if (!dependencies.has(dep)) {
            dependencies.set(dep, { name: dep });
          }
        }
      }
    } else if (type === 'executable' || type === 'executables') {
      const execs = parseExecutableStanza(sexp.slice(1));
      executables.push(...execs);
      for (const exec of execs) {
        for (const dep of exec.libraries) {
          if (!dependencies.has(dep)) {
            dependencies.set(dep, { name: dep });
          }
        }
      }
    } else if (type === 'test' || type === 'tests') {
      // Tests also have libraries
      const execs = parseExecutableStanza(sexp.slice(1));
      for (const exec of execs) {
        for (const dep of exec.libraries) {
          if (!dependencies.has(dep)) {
            dependencies.set(dep, { name: dep });
          }
        }
      }
    }
  }
  
  return {
    libraries,
    executables,
    dependencies: [...dependencies.values()]
  };
}

/**
 * Parse an opam file to extract package info and dependencies
 */
export function parseOpamFile(content: string): OpamInfo {
  const result: OpamInfo = {
    name: '',
    version: '',
    depends: [],
    devDepends: [],
    buildDepends: []
  };
  
  const lines = content.split('\n');
  let inDepends = false;
  let inDepin = false;
  let bracketDepth = 0;
  let currentField = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Parse name
    const nameMatch = trimmed.match(/^name:\s*"([^"]+)"/);
    if (nameMatch) {
      result.name = nameMatch[1];
      continue;
    }
    
    // Parse version
    const versionMatch = trimmed.match(/^version:\s*"([^"]+)"/);
    if (versionMatch) {
      result.version = versionMatch[1];
      continue;
    }
    
    // Detect field start
    if (trimmed.match(/^depends:\s*\[/)) {
      inDepends = true;
      currentField = 'depends';
      bracketDepth = 1;
      // Check for inline deps
      const inlineDeps = trimmed.match(/depends:\s*\[(.+)\]/);
      if (inlineDeps) {
        parseOpamDeps(inlineDeps[1], result.depends, result.devDepends, result.buildDepends);
        inDepends = false;
        bracketDepth = 0;
      }
      continue;
    }
    
    if (trimmed.match(/^depopts:\s*\[/)) {
      inDepin = true;
      currentField = 'depopts';
      bracketDepth = 1;
      continue;
    }
    
    if (trimmed.match(/^build:\s*\[/) || trimmed.match(/^install:\s*\[/)) {
      inDepends = false;
      inDepin = false;
      continue;
    }
    
    // Track bracket depth
    if (inDepends || inDepin) {
      for (const ch of trimmed) {
        if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth--;
      }
      
      if (bracketDepth <= 0) {
        inDepends = false;
        inDepin = false;
        continue;
      }
      
      // Parse dependency
      if (currentField === 'depends') {
        parseOpamDeps(trimmed, result.depends, result.devDepends, result.buildDepends);
      }
    }
  }
  
  return result;
}

/**
 * Parse opam dependency line(s)
 */
function parseOpamDeps(
  line: string, 
  depends: OpamDependency[], 
  devDepends: OpamDependency[], 
  buildDepends: OpamDependency[]
): void {
  // Match package with optional version constraint
  // "package" or "package" {>= "1.0"}
  const depRegex = /"([a-z0-9_-]+)"(?:\s*\{([^}]*)\})?/g;
  let match;
  
  while ((match = depRegex.exec(line)) !== null) {
    const name = match[1];
    const constraint = match[2] || '';
    
    // Skip build-only deps like ocaml, dune
    if (name === 'ocaml' || name === 'dune' || name === 'dune-configurator') {
      buildDepends.push({ name, version: extractVersion(constraint) });
      continue;
    }
    
    // Check for with-test or with-doc
    if (constraint.includes('with-test') || constraint.includes('with-doc')) {
      devDepends.push({ name, version: extractVersion(constraint) });
    } else {
      depends.push({ name, version: extractVersion(constraint) });
    }
  }
}

/**
 * Extract version constraint from opam constraint string
 */
function extractVersion(constraint: string): string | undefined {
  const versionMatch = constraint.match(/(>=?|<=?|=)\s*"([^"]+)"/);
  if (versionMatch) {
    return `${versionMatch[1]} ${versionMatch[2]}`;
  }
  return undefined;
}

/**
 * Parse S-expressions (simplified for dune files)
 */
function parseSexps(content: string): any[] {
  const results: any[] = [];
  let pos = 0;
  
  // Remove comments
  content = content.replace(/;[^\n]*/g, '');
  
  function skipWhitespace() {
    while (pos < content.length && /\s/.test(content[pos])) pos++;
  }
  
  function parseAtom(): string {
    const start = pos;
    if (content[pos] === '"') {
      // Quoted string
      pos++;
      while (pos < content.length && content[pos] !== '"') {
        if (content[pos] === '\\') pos++;
        pos++;
      }
      pos++; // closing quote
      return content.slice(start + 1, pos - 1);
    } else {
      // Unquoted atom
      while (pos < content.length && !/[\s()]/.test(content[pos])) pos++;
      return content.slice(start, pos);
    }
  }
  
  function parseSexp(): any {
    skipWhitespace();
    if (pos >= content.length) return null;
    
    if (content[pos] === '(') {
      pos++; // skip (
      const list: any[] = [];
      skipWhitespace();
      while (pos < content.length && content[pos] !== ')') {
        const item = parseSexp();
        if (item !== null) list.push(item);
        skipWhitespace();
      }
      pos++; // skip )
      return list;
    } else if (content[pos] === ')') {
      return null;
    } else {
      return parseAtom();
    }
  }
  
  while (pos < content.length) {
    skipWhitespace();
    if (pos >= content.length) break;
    const sexp = parseSexp();
    if (sexp !== null) results.push(sexp);
  }
  
  return results;
}

/**
 * Parse library stanza from dune
 */
function parseLibraryStanza(fields: any[]): DuneLibrary | null {
  let name = '';
  let publicName: string | undefined;
  const libraries: string[] = [];
  
  for (const field of fields) {
    if (!Array.isArray(field) || field.length < 2) continue;
    
    const key = field[0];
    if (key === 'name') {
      name = field[1];
    } else if (key === 'public_name') {
      publicName = field[1];
    } else if (key === 'libraries') {
      for (let i = 1; i < field.length; i++) {
        const dep = field[i];
        if (typeof dep === 'string') {
          libraries.push(dep);
        } else if (Array.isArray(dep) && dep[0] === 'select') {
          // (select ... from lib1 lib2)
          for (let j = 1; j < dep.length; j++) {
            if (typeof dep[j] === 'string' && dep[j] !== 'from' && !dep[j].includes('->')) {
              libraries.push(dep[j]);
            }
          }
        }
      }
    }
  }
  
  if (!name) return null;
  
  return { name, publicName, libraries };
}

/**
 * Parse executable/executables stanza from dune
 */
function parseExecutableStanza(fields: any[]): DuneExecutable[] {
  const results: DuneExecutable[] = [];
  let names: string[] = [];
  const libraries: string[] = [];
  
  for (const field of fields) {
    if (!Array.isArray(field) || field.length < 2) continue;
    
    const key = field[0];
    if (key === 'name') {
      names = [field[1]];
    } else if (key === 'names') {
      names = field.slice(1).filter((n: any) => typeof n === 'string');
    } else if (key === 'libraries') {
      for (let i = 1; i < field.length; i++) {
        const dep = field[i];
        if (typeof dep === 'string') {
          libraries.push(dep);
        }
      }
    }
  }
  
  for (const name of names) {
    results.push({ name, libraries: [...libraries] });
  }
  
  return results;
}

/**
 * Find function usages from opened/included modules
 */
export function findUsages(
  content: string,
  filePath: string,
  opens: OCamlOpenInfo[]
): Map<string, { moduleName: string; function: string; locations: CodeLocation[] }> {
  const usages = new Map<string, { moduleName: string; function: string; locations: CodeLocation[] }>();
  const lines = content.split('\n');
  
  // Build a map of module aliases
  const aliases = new Map<string, string>();
  for (const open of opens) {
    if (open.kind === 'alias' && open.alias) {
      aliases.set(open.alias, open.moduleName);
    }
  }
  
  // Get opened modules for unqualified access
  const openedModules = opens
    .filter(o => o.kind === 'open' || o.kind === 'local_open' || o.kind === 'include')
    .map(o => o.moduleName);
  
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;
    
    // Skip comments
    if (line.trim().startsWith('(*')) continue;
    
    // Match qualified calls: Module.func
    const qualifiedRegex = /([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)\.([a-z_][a-z0-9_]*)/g;
    let match;
    while ((match = qualifiedRegex.exec(line)) !== null) {
      let moduleName = match[1];
      const funcName = match[2];
      
      // Resolve alias
      const topModule = moduleName.split('.')[0];
      if (aliases.has(topModule)) {
        moduleName = aliases.get(topModule)! + moduleName.slice(topModule.length);
      }
      
      const key = `${moduleName}.${funcName}`;
      if (!usages.has(key)) {
        usages.set(key, { moduleName, function: funcName, locations: [] });
      }
      usages.get(key)!.locations.push({
        file: filePath,
        line: lineNum,
        column: match.index + 1
      });
    }
    
    // Match unqualified function calls from opened modules
    // Look for function application patterns: func arg or func (arg)
    if (openedModules.length > 0) {
      // Match identifier followed by space and argument (simple heuristic)
      const funcCallRegex = /\b([a-z_][a-z0-9_]*)\s*(?:\(|[a-z_"'\[])/g;
      let funcMatch;
      while ((funcMatch = funcCallRegex.exec(line)) !== null) {
        const funcName = funcMatch[1];
        // Skip OCaml keywords
        const keywords = new Set(['let', 'in', 'if', 'then', 'else', 'match', 'with', 'fun', 'function', 
          'type', 'module', 'open', 'include', 'struct', 'sig', 'end', 'val', 'and', 'or', 'not',
          'true', 'false', 'begin', 'for', 'while', 'do', 'done', 'to', 'downto', 'rec', 'of',
          'try', 'exception', 'raise', 'assert', 'lazy', 'mutable', 'private', 'virtual', 'method',
          'object', 'class', 'inherit', 'initializer', 'constraint', 'as', 'when', 'external']);
        if (keywords.has(funcName)) continue;
        
        // Attribute this to the first opened module (heuristic)
        for (const mod of openedModules) {
          const key = `${mod}.${funcName}`;
          if (!usages.has(key)) {
            usages.set(key, { moduleName: mod, function: funcName, locations: [] });
          }
          usages.get(key)!.locations.push({
            file: filePath,
            line: lineNum,
            column: funcMatch.index + 1
          });
          break; // Only attribute to first module
        }
      }
    }
  }
  
  return usages;
}

/**
 * Map module name to possible OPAM packages
 */
export function moduleToPackages(moduleName: string): string[] {
  const packages: string[] = [];
  const topModule = moduleName.split('.')[0];
  
  // Check all mappings
  for (const [pkg, modules] of Object.entries(OPAM_PACKAGE_TO_MODULES)) {
    for (const mod of modules) {
      if (moduleName === mod || moduleName.startsWith(mod + '.') || topModule === mod) {
        if (!packages.includes(pkg)) {
          packages.push(pkg);
        }
      }
    }
  }
  
  // Try lowercase conversion (e.g., Lwt -> lwt)
  const lowered = topModule.toLowerCase().replace(/_/g, '-');
  if (!packages.includes(lowered) && OPAM_PACKAGE_TO_MODULES[lowered]) {
    packages.push(lowered);
  }
  
  return packages;
}

/**
 * Check if a module is from the standard library
 */
export function isStdlibModule(moduleName: string): boolean {
  const topModule = moduleName.split('.')[0];
  return STDLIB_MODULES.has(topModule);
}
