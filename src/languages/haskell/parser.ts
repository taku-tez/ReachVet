/**
 * ReachVet - Haskell Import Parser
 * Parses Haskell import statements, .cabal files, and stack.yaml
 */

import type { CodeLocation } from '../../types.js';

export interface HaskellImportInfo {
  // Module name (e.g., 'Data.Map')
  moduleName: string;
  // Is qualified import
  qualified?: boolean;
  // Alias (as Alias)
  alias?: string;
  // Specific imports (fromMaybe, maybe)
  importList?: string[];
  // Hidden items (hiding (foo, bar))
  hidingList?: string[];
  // Is package import ({-# SOURCE #-} or "package-name" style)
  packageImport?: string;
  // Location
  location: CodeLocation;
}

export interface CabalDependency {
  // Package name
  name: string;
  // Version constraint (>=1.0, <2.0)
  version?: string;
}

export interface CabalInfo {
  // Package name
  name: string;
  // Package version
  version: string;
  // Dependencies (build-depends from all components)
  dependencies: CabalDependency[];
  // Exposed modules (from library)
  exposedModules?: string[];
}

export interface StackInfo {
  // Resolver (lts-20.0, nightly-2023-01-01)
  resolver: string;
  // Extra dependencies
  extraDeps: CabalDependency[];
  // Packages (local directories)
  packages: string[];
}

/**
 * Common Hackage package to module mapping
 * Maps package name to typical module prefixes
 */
export const HACKAGE_PACKAGE_TO_MODULES: Record<string, string[]> = {
  // Text and ByteString
  'text': ['Data.Text', 'Data.Text.Lazy', 'Data.Text.IO', 'Data.Text.Encoding'],
  'bytestring': ['Data.ByteString', 'Data.ByteString.Lazy', 'Data.ByteString.Char8'],
  
  // Containers
  'containers': ['Data.Map', 'Data.Set', 'Data.Sequence', 'Data.IntMap', 'Data.IntSet', 'Data.Tree', 'Data.Graph'],
  'unordered-containers': ['Data.HashMap', 'Data.HashSet'],
  'vector': ['Data.Vector', 'Data.Vector.Mutable', 'Data.Vector.Unboxed'],
  'array': ['Data.Array'],
  
  // Parsing
  'parsec': ['Text.Parsec', 'Text.Parsec.Char', 'Text.Parsec.Combinator'],
  'megaparsec': ['Text.Megaparsec', 'Text.Megaparsec.Char'],
  'attoparsec': ['Data.Attoparsec', 'Data.Attoparsec.Text', 'Data.Attoparsec.ByteString'],
  
  // Web
  'aeson': ['Data.Aeson', 'Data.Aeson.Types', 'Data.Aeson.TH'],
  'http-client': ['Network.HTTP.Client'],
  'http-types': ['Network.HTTP.Types'],
  'warp': ['Network.Wai.Handler.Warp'],
  'wai': ['Network.Wai'],
  'servant': ['Servant', 'Servant.API', 'Servant.Server'],
  'scotty': ['Web.Scotty'],
  'yesod': ['Yesod', 'Yesod.Core'],
  
  // Database
  'persistent': ['Database.Persist', 'Database.Persist.Sql'],
  'esqueleto': ['Database.Esqueleto'],
  'postgresql-simple': ['Database.PostgreSQL.Simple'],
  'mysql-simple': ['Database.MySQL.Simple'],
  'sqlite-simple': ['Database.SQLite.Simple'],
  'hdbc': ['Database.HDBC'],
  
  // Concurrency
  'async': ['Control.Concurrent.Async'],
  'stm': ['Control.Concurrent.STM', 'Control.Monad.STM'],
  
  // Monads and Transformers
  'mtl': ['Control.Monad.Reader', 'Control.Monad.Writer', 'Control.Monad.State', 'Control.Monad.Except'],
  'transformers': ['Control.Monad.Trans', 'Control.Monad.Trans.Reader', 'Control.Monad.Trans.State'],
  'free': ['Control.Monad.Free'],
  'lens': ['Control.Lens', 'Lens.Micro'],
  'optics': ['Optics', 'Optics.Core'],
  
  // Testing
  'hspec': ['Test.Hspec'],
  'QuickCheck': ['Test.QuickCheck'],
  'tasty': ['Test.Tasty'],
  'HUnit': ['Test.HUnit'],
  
  // Logging
  'monad-logger': ['Control.Monad.Logger'],
  'katip': ['Katip'],
  'fast-logger': ['System.Log.FastLogger'],
  
  // Time
  'time': ['Data.Time', 'Data.Time.Clock', 'Data.Time.Calendar', 'Data.Time.Format'],
  
  // File system
  'directory': ['System.Directory'],
  'filepath': ['System.FilePath'],
  'unix': ['System.Posix'],
  
  // Crypto
  'cryptonite': ['Crypto.Hash', 'Crypto.Cipher', 'Crypto.Random'],
  'cryptohash-sha256': ['Crypto.Hash.SHA256'],
  
  // Networking
  'network': ['Network.Socket'],
  'websockets': ['Network.WebSockets'],
  
  // Command line
  'optparse-applicative': ['Options.Applicative'],
  'cmdargs': ['System.Console.CmdArgs'],
  
  // Configuration
  'yaml': ['Data.Yaml'],
  'configurator': ['Data.Configurator'],
  
  // Misc
  'uuid': ['Data.UUID'],
  'random': ['System.Random'],
  'hashable': ['Data.Hashable'],
  'deepseq': ['Control.DeepSeq'],
  'exceptions': ['Control.Monad.Catch'],
  'resourcet': ['Control.Monad.Trans.Resource'],
  'conduit': ['Data.Conduit', 'Conduit'],
  'pipes': ['Pipes'],
  'streaming': ['Streaming'],
};

/**
 * Standard library (base) modules that don't need external packages
 */
export const STD_MODULES: Set<string> = new Set([
  'Prelude',
  'Control.Applicative',
  'Control.Arrow',
  'Control.Category',
  'Control.Concurrent',
  'Control.Concurrent.Chan',
  'Control.Concurrent.MVar',
  'Control.Concurrent.QSem',
  'Control.Concurrent.QSemN',
  'Control.Exception',
  'Control.Monad',
  'Control.Monad.Fail',
  'Control.Monad.Fix',
  'Control.Monad.IO.Class',
  'Control.Monad.Instances',
  'Control.Monad.Zip',
  'Data.Bifoldable',
  'Data.Bifunctor',
  'Data.Bitraversable',
  'Data.Bool',
  'Data.Char',
  'Data.Coerce',
  'Data.Complex',
  'Data.Data',
  'Data.Dynamic',
  'Data.Either',
  'Data.Eq',
  'Data.Fixed',
  'Data.Foldable',
  'Data.Function',
  'Data.Functor',
  'Data.Functor.Classes',
  'Data.Functor.Compose',
  'Data.Functor.Const',
  'Data.Functor.Identity',
  'Data.Functor.Product',
  'Data.Functor.Sum',
  'Data.IORef',
  'Data.Int',
  'Data.Ix',
  'Data.Kind',
  'Data.List',
  'Data.List.NonEmpty',
  'Data.Maybe',
  'Data.Monoid',
  'Data.Ord',
  'Data.Proxy',
  'Data.Ratio',
  'Data.Semigroup',
  'Data.String',
  'Data.Traversable',
  'Data.Tuple',
  'Data.Type.Bool',
  'Data.Type.Coercion',
  'Data.Type.Equality',
  'Data.Typeable',
  'Data.Unique',
  'Data.Version',
  'Data.Void',
  'Data.Word',
  'Debug.Trace',
  'Foreign',
  'Foreign.C',
  'Foreign.C.Error',
  'Foreign.C.String',
  'Foreign.C.Types',
  'Foreign.Concurrent',
  'Foreign.ForeignPtr',
  'Foreign.Marshal',
  'Foreign.Marshal.Alloc',
  'Foreign.Marshal.Array',
  'Foreign.Marshal.Error',
  'Foreign.Marshal.Pool',
  'Foreign.Marshal.Utils',
  'Foreign.Ptr',
  'Foreign.StablePtr',
  'Foreign.Storable',
  'GHC.Base',
  'GHC.Enum',
  'GHC.Err',
  'GHC.Exts',
  'GHC.Float',
  'GHC.Generics',
  'GHC.IO',
  'GHC.IO.Exception',
  'GHC.IO.Handle',
  'GHC.Int',
  'GHC.List',
  'GHC.Num',
  'GHC.Real',
  'GHC.Show',
  'GHC.Stack',
  'GHC.TypeLits',
  'GHC.TypeNats',
  'GHC.Word',
  'Numeric',
  'Numeric.Natural',
  'System.Console.GetOpt',
  'System.CPUTime',
  'System.Environment',
  'System.Exit',
  'System.IO',
  'System.IO.Error',
  'System.IO.Unsafe',
  'System.Info',
  'System.Mem',
  'System.Mem.StableName',
  'System.Mem.Weak',
  'System.Posix.Internals',
  'System.Posix.Types',
  'System.Timeout',
  'Text.ParserCombinators.ReadP',
  'Text.ParserCombinators.ReadPrec',
  'Text.Printf',
  'Text.Read',
  'Text.Read.Lex',
  'Text.Show',
  'Text.Show.Functions',
  'Type.Reflection',
  'Unsafe.Coerce',
]);

/**
 * Check if a module is from standard library (base)
 */
export function isStdModule(moduleName: string): boolean {
  // Check exact match
  if (STD_MODULES.has(moduleName)) {
    return true;
  }
  // Check if it's a submodule of a known std module
  for (const stdMod of STD_MODULES) {
    if (moduleName.startsWith(stdMod + '.')) {
      return true;
    }
  }
  return false;
}

/**
 * Map a module name to possible Hackage packages
 */
export function moduleToPackages(moduleName: string): string[] {
  const packages: string[] = [];
  
  for (const [pkg, modules] of Object.entries(HACKAGE_PACKAGE_TO_MODULES)) {
    for (const mod of modules) {
      if (moduleName === mod || moduleName.startsWith(mod + '.')) {
        packages.push(pkg);
        break;
      }
    }
  }
  
  return packages;
}

/**
 * Parse Haskell source and extract import statements
 */
export function parseHaskellSource(source: string, file: string): HaskellImportInfo[] {
  const imports: HaskellImportInfo[] = [];
  const lines = source.split('\n');
  
  let multilineImport = '';
  let multilineStart = 0;
  let braceCount = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    let line = lines[lineIdx];
    
    // Remove line comments
    const commentIdx = line.indexOf('--');
    if (commentIdx >= 0) {
      // Make sure it's not inside a string
      const beforeComment = line.slice(0, commentIdx);
      const quoteCount = (beforeComment.match(/"/g) || []).length;
      if (quoteCount % 2 === 0) {
        line = beforeComment;
      }
    }
    
    // Remove block comments {- ... -}
    line = line.replace(/\{-.*?-\}/g, ' ');
    
    const trimmed = line.trim();
    
    // Skip empty lines
    if (trimmed === '') continue;
    
    // Skip module declaration
    if (trimmed.startsWith('module ')) continue;
    
    // Handle multiline imports (with parentheses)
    if (multilineImport) {
      multilineImport += ' ' + trimmed;
      braceCount += (trimmed.match(/\(/g) || []).length;
      braceCount -= (trimmed.match(/\)/g) || []).length;
      
      if (braceCount <= 0 || trimmed.endsWith(')')) {
        const parsed = parseImportStatement(multilineImport, file, multilineStart);
        if (parsed) {
          imports.push(parsed);
        }
        multilineImport = '';
        braceCount = 0;
      }
      continue;
    }
    
    // Check for import statement
    if (trimmed.startsWith('import ')) {
      // Count parentheses
      braceCount = (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length;
      
      if (braceCount > 0) {
        // Multiline import (parenthesis on same line)
        multilineImport = trimmed;
        multilineStart = lineNum;
      } else {
        // Check if next line starts with ( which indicates multiline import
        const nextLine = lineIdx + 1 < lines.length ? lines[lineIdx + 1].trim() : '';
        if (nextLine.startsWith('(')) {
          // Multiline import (parenthesis on next line)
          multilineImport = trimmed;
          multilineStart = lineNum;
          braceCount = 0; // Will be updated on next iteration
        } else {
          // Single line import
          const parsed = parseImportStatement(trimmed, file, lineNum);
          if (parsed) {
            imports.push(parsed);
          }
        }
      }
    }
    
    // Stop parsing after first non-import top-level declaration
    // (imports must be at the top of the module after module declaration)
    if (!trimmed.startsWith('import ') && !trimmed.startsWith('{-') && 
        !trimmed.startsWith('--') && !multilineImport &&
        /^[a-z_]/i.test(trimmed) && !trimmed.startsWith('type ') && 
        !trimmed.startsWith('data ') && !trimmed.startsWith('class ') &&
        !trimmed.startsWith('instance ') && !trimmed.startsWith('newtype ')) {
      // Likely a function definition, stop parsing
      break;
    }
  }

  return imports;
}

/**
 * Parse a single import statement
 */
function parseImportStatement(stmt: string, file: string, lineNum: number): HaskellImportInfo | null {
  // Remove "import" prefix
  let rest = stmt.slice(7).trim();
  
  const result: HaskellImportInfo = {
    moduleName: '',
    location: { file, line: lineNum }
  };
  
  // Check for {-# SOURCE #-} pragma
  if (rest.startsWith('{-#')) {
    const pragmaEnd = rest.indexOf('#-}');
    if (pragmaEnd > 0) {
      const pragma = rest.slice(3, pragmaEnd).trim();
      if (pragma === 'SOURCE') {
        result.packageImport = 'SOURCE';
      }
      rest = rest.slice(pragmaEnd + 3).trim();
    }
  }
  
  // Check for package import "package-name"
  const pkgMatch = rest.match(/^"([^"]+)"\s+/);
  if (pkgMatch) {
    result.packageImport = pkgMatch[1];
    rest = rest.slice(pkgMatch[0].length).trim();
  }
  
  // Check for qualified
  if (rest.startsWith('qualified ')) {
    result.qualified = true;
    rest = rest.slice(10).trim();
  }
  
  // Parse module name
  const moduleMatch = rest.match(/^([A-Z][A-Za-z0-9_']*(?:\.[A-Z][A-Za-z0-9_']*)*)/);
  if (!moduleMatch) {
    return null;
  }
  
  result.moduleName = moduleMatch[1];
  rest = rest.slice(moduleMatch[0].length).trim();
  
  // Check for "as Alias"
  const asMatch = rest.match(/^as\s+([A-Z][A-Za-z0-9_']*)/);
  if (asMatch) {
    result.alias = asMatch[1];
    rest = rest.slice(asMatch[0].length).trim();
  }
  
  // Check for "hiding (...)"
  if (rest.startsWith('hiding')) {
    rest = rest.slice(6).trim();
    if (rest.startsWith('(')) {
      const closeIdx = findMatchingParen(rest);
      if (closeIdx > 0) {
        const hidingContent = rest.slice(1, closeIdx);
        result.hidingList = parseImportList(hidingContent);
        rest = rest.slice(closeIdx + 1).trim();
      }
    }
  }
  // Check for explicit import list "(a, b, c)"
  else if (rest.startsWith('(')) {
    const closeIdx = findMatchingParen(rest);
    if (closeIdx > 0) {
      const importContent = rest.slice(1, closeIdx);
      result.importList = parseImportList(importContent);
    }
  }
  
  return result;
}

/**
 * Find matching closing parenthesis
 */
function findMatchingParen(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parse import list content
 */
function parseImportList(content: string): string[] {
  const items: string[] = [];
  let current = '';
  let parenDepth = 0;
  
  for (const char of content) {
    if (char === '(') {
      parenDepth++;
      current += char;
    } else if (char === ')') {
      parenDepth--;
      current += char;
    } else if (char === ',' && parenDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = '';
    } else {
      current += char;
    }
  }
  
  const trimmed = current.trim();
  if (trimmed) items.push(trimmed);
  
  return items;
}

/**
 * Parse .cabal file
 */
export function parseCabalFile(content: string): CabalInfo {
  const result: CabalInfo = {
    name: '',
    version: '',
    dependencies: []
  };
  
  const lines = content.split('\n');
  let inBuildDepends = false;
  const dependencies = new Map<string, CabalDependency>();
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/--.*$/, '').trim();
    
    if (!trimmed) continue;
    
    // Check for section headers (library, executable, etc.)
    if (/^(library|executable|test-suite|benchmark|common)\s*/i.test(trimmed)) {
      inBuildDepends = false;
      continue;
    }
    
    // Check for top-level fields
    const fieldMatch = trimmed.match(/^([a-z-]+):\s*(.*)$/i);
    if (fieldMatch) {
      const [, field, value] = fieldMatch;
      const fieldLower = field.toLowerCase();
      
      if (fieldLower === 'name' && !result.name) {
        result.name = value.trim();
      } else if (fieldLower === 'version' && !result.version) {
        result.version = value.trim();
      } else if (fieldLower === 'exposed-modules') {
        result.exposedModules = value.split(',').map(m => m.trim()).filter(m => m);
      } else if (fieldLower === 'build-depends') {
        inBuildDepends = true;
        
        // Parse inline deps after colon
        if (value.trim()) {
          const deps = parseDependencyList(value);
          for (const dep of deps) {
            dependencies.set(dep.name, dep);
          }
        }
      } else {
        inBuildDepends = false;
      }
      continue;
    }
    
    // Handle continuation of build-depends
    if (inBuildDepends) {
      const indent = line.search(/\S/);
      if (indent > 0) {
        const deps = parseDependencyList(trimmed);
        for (const dep of deps) {
          dependencies.set(dep.name, dep);
        }
      } else {
        inBuildDepends = false;
      }
    }
  }
  
  result.dependencies = [...dependencies.values()];
  return result;
}

/**
 * Parse a comma-separated dependency list
 */
function parseDependencyList(content: string): CabalDependency[] {
  const deps: CabalDependency[] = [];
  const parts = content.split(',');
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Match: package-name version-constraint
    // e.g., "base >=4.7 && <5", "text", "containers ==0.6.*"
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*(.*)$/);
    if (match) {
      const dep: CabalDependency = { name: match[1] };
      if (match[2].trim()) {
        dep.version = match[2].trim();
      }
      deps.push(dep);
    }
  }
  
  return deps;
}

/**
 * Parse stack.yaml file
 */
export function parseStackYaml(content: string): StackInfo {
  const result: StackInfo = {
    resolver: '',
    extraDeps: [],
    packages: []
  };
  
  const lines = content.split('\n');
  let currentKey = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Check for key: value
    const keyMatch = trimmed.match(/^([a-z-]+):\s*(.*)$/i);
    if (keyMatch && line[0] !== ' ' && line[0] !== '-') {
      const [, key, value] = keyMatch;
      currentKey = key.toLowerCase();
      
      if (currentKey === 'resolver' && value.trim()) {
        result.resolver = value.trim();
      } else if (currentKey === 'extra-deps' || currentKey === 'packages') {
        // Check for inline list
        if (value.trim().startsWith('[')) {
          const inlineList = parseYamlInlineList(value.trim());
          if (currentKey === 'extra-deps') {
            result.extraDeps = inlineList.map(parseExtraDep);
          } else {
            result.packages = inlineList;
          }
        }
      } else {
        currentKey = '';
      }
      continue;
    }
    
    // Handle list items
    if (trimmed.startsWith('- ')) {
      let value = trimmed.slice(2).trim();
      // Strip inline comments from list items
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) {
        value = value.slice(0, commentIdx).trim();
      }
      
      if (currentKey === 'extra-deps') {
        result.extraDeps.push(parseExtraDep(value));
      } else if (currentKey === 'packages') {
        result.packages.push(value);
      }
    }
  }
  
  return result;
}

/**
 * Parse YAML inline list [a, b, c]
 */
function parseYamlInlineList(value: string): string[] {
  const match = value.match(/^\[(.*)\]$/);
  if (!match) return [];
  
  return match[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(s => s);
}

/**
 * Parse extra-dep entry (package-version or git url)
 */
function parseExtraDep(value: string): CabalDependency {
  // Check for git source
  if (value.includes('git:') || value.includes('github:')) {
    const nameMatch = value.match(/([a-zA-Z0-9_-]+)-\d/);
    return { name: nameMatch ? nameMatch[1] : value, version: value };
  }
  
  // Standard format: package-1.2.3
  const match = value.match(/^([a-zA-Z0-9_-]+)-(\d[0-9.]*)$/);
  if (match) {
    return { name: match[1], version: match[2] };
  }
  
  // Just package name
  return { name: value.replace(/@.*$/, '') };
}

/**
 * Find function/value usages in Haskell source
 * Returns map of qualified name -> usage locations
 */
export function findUsages(
  source: string,
  file: string,
  imports: HaskellImportInfo[]
): Map<string, { module: string, locations: CodeLocation[] }> {
  const usages = new Map<string, { module: string, locations: CodeLocation[] }>();
  const lines = source.split('\n');
  
  // Build alias map
  const aliasToModule = new Map<string, string>();
  for (const imp of imports) {
    if (imp.alias) {
      aliasToModule.set(imp.alias, imp.moduleName);
    }
    // Also map module last part
    const lastPart = imp.moduleName.split('.').pop()!;
    if (!aliasToModule.has(lastPart)) {
      aliasToModule.set(lastPart, imp.moduleName);
    }
  }
  
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    const line = lines[lineIdx];
    
    // Skip imports
    if (line.trim().startsWith('import ') || line.trim().startsWith('module ')) {
      continue;
    }
    
    // Find qualified usages: Module.function or Alias.function
    const qualifiedPattern = /([A-Z][A-Za-z0-9_']*(?:\.[A-Z][A-Za-z0-9_']*)*)\.([a-z_][A-Za-z0-9_']*)/g;
    let match;
    
    while ((match = qualifiedPattern.exec(line)) !== null) {
      const [, qualifier, func] = match;
      const moduleName = aliasToModule.get(qualifier) || qualifier;
      const key = `${moduleName}.${func}`;
      
      if (!usages.has(key)) {
        usages.set(key, { module: moduleName, locations: [] });
      }
      usages.get(key)!.locations.push({ file, line: lineNum, column: match.index + 1 });
    }
  }
  
  return usages;
}
