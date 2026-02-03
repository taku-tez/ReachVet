/**
 * ReachVet - Elixir Import Parser
 * 
 * Parses Elixir import/alias/use/require statements:
 * - import Module
 * - import Module, only: [func: 1]
 * - alias Module.SubModule
 * - alias Module.SubModule, as: Short
 * - use Module
 * - require Module
 */

import type { CodeLocation } from '../../types.js';

export interface ElixirImportInfo {
  /** The module being imported/aliased/used */
  moduleName: string;
  /** Import style */
  importStyle: 'import' | 'alias' | 'use' | 'require';
  /** Alias if any */
  alias?: string;
  /** Only/except specifiers */
  only?: string[];
  except?: string[];
  /** Location in source */
  location: CodeLocation;
}

export interface ElixirUsageInfo {
  /** Module/function being used */
  identifier: string;
  /** Function being called */
  function?: string;
  /** Location in source */
  location: CodeLocation;
}

// Map hex package names to their modules
const PACKAGE_TO_MODULE: Record<string, string[]> = {
  // Phoenix
  'phoenix': ['Phoenix', 'Phoenix.Controller', 'Phoenix.Router', 'Phoenix.Channel', 'Phoenix.Socket'],
  'phoenix_html': ['Phoenix.HTML'],
  'phoenix_live_view': ['Phoenix.LiveView', 'Phoenix.LiveComponent'],
  'phoenix_ecto': ['Phoenix.Ecto'],
  
  // Ecto
  'ecto': ['Ecto', 'Ecto.Changeset', 'Ecto.Schema', 'Ecto.Query', 'Ecto.Repo'],
  'ecto_sql': ['Ecto.Adapters.SQL'],
  'postgrex': ['Postgrex'],
  'myxql': ['MyXQL'],
  
  // HTTP
  'httpoison': ['HTTPoison'],
  'tesla': ['Tesla'],
  'finch': ['Finch'],
  'req': ['Req'],
  'mint': ['Mint.HTTP'],
  
  // JSON
  'jason': ['Jason'],
  'poison': ['Poison'],
  'jiffy': ['Jiffy'],
  
  // Auth
  'guardian': ['Guardian'],
  'pow': ['Pow'],
  'ueberauth': ['Ueberauth'],
  'comeonin': ['Comeonin'],
  'bcrypt_elixir': ['Bcrypt'],
  'argon2_elixir': ['Argon2'],
  
  // Testing
  'ex_unit': ['ExUnit', 'ExUnit.Case'],
  'mox': ['Mox'],
  'bypass': ['Bypass'],
  'mock': ['Mock'],
  'faker': ['Faker'],
  'ex_machina': ['ExMachina'],
  
  // Logging/Monitoring
  'logger': ['Logger'],
  'telemetry': ['Telemetry'],
  'new_relic_agent': ['NewRelic'],
  'sentry': ['Sentry'],
  
  // Job Processing
  'oban': ['Oban', 'Oban.Worker'],
  'exq': ['Exq'],
  'quantum': ['Quantum'],
  
  // Utils
  'timex': ['Timex'],
  'decimal': ['Decimal'],
  'uuid': ['UUID'],
  'earmark': ['Earmark'],
  'floki': ['Floki'],
  'nimble_csv': ['NimbleCSV'],
  'nimble_parsec': ['NimbleParsec'],
  
  // GraphQL
  'absinthe': ['Absinthe', 'Absinthe.Schema', 'Absinthe.Middleware'],
  
  // PubSub/Channels
  'phoenix_pubsub': ['Phoenix.PubSub'],
  
  // Caching
  'cachex': ['Cachex'],
  'nebulex': ['Nebulex'],
  'con_cache': ['ConCache'],
  
  // AWS
  'ex_aws': ['ExAws'],
  'ex_aws_s3': ['ExAws.S3'],
  
  // Validation
  'ecto_enum': ['EctoEnum'],
  'typed_struct': ['TypedStruct'],
};

// Elixir/Erlang standard modules
const STANDARD_MODULES = new Set([
  'Kernel', 'Enum', 'Map', 'List', 'String', 'Integer', 'Float',
  'File', 'IO', 'Path', 'System', 'Process', 'Agent', 'Task',
  'GenServer', 'Supervisor', 'Application', 'Logger', 'Stream',
  'DateTime', 'Date', 'Time', 'NaiveDateTime', 'Calendar',
  'Access', 'Keyword', 'MapSet', 'Range', 'Regex', 'URI',
  'Module', 'Macro', 'Code', 'Kernel.SpecialForms',
  ':erlang', ':ets', ':mnesia', ':gen_server', ':supervisor',
]);

/**
 * Parse Elixir source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.ex'): ElixirImportInfo[] {
  const imports: ElixirImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('#')) {
      continue;
    }

    // use Module or use Module, opts
    const useMatch = trimmed.match(/^use\s+([A-Z][A-Za-z0-9_.]*)/);
    if (useMatch) {
      imports.push({
        moduleName: useMatch[1],
        importStyle: 'use',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // require Module
    const requireMatch = trimmed.match(/^require\s+([A-Z][A-Za-z0-9_.]*)/);
    if (requireMatch) {
      imports.push({
        moduleName: requireMatch[1],
        importStyle: 'require',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // alias Module.SubModule, as: Short
    const aliasWithAsMatch = trimmed.match(/^alias\s+([A-Z][A-Za-z0-9_.]*)\s*,\s*as:\s*([A-Z][A-Za-z0-9_]*)/);
    if (aliasWithAsMatch) {
      imports.push({
        moduleName: aliasWithAsMatch[1],
        importStyle: 'alias',
        alias: aliasWithAsMatch[2],
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // alias Module.{SubModule1, SubModule2}
    const aliasMultiMatch = trimmed.match(/^alias\s+([A-Z][A-Za-z0-9_.]*)\.\{([^}]+)\}/);
    if (aliasMultiMatch) {
      const baseMod = aliasMultiMatch[1];
      const subModules = aliasMultiMatch[2].split(',').map(s => s.trim());
      for (const sub of subModules) {
        imports.push({
          moduleName: `${baseMod}.${sub}`,
          importStyle: 'alias',
          location: {
            file: fileName,
            line: lineNum,
            snippet: trimmed.slice(0, 100)
          }
        });
      }
      continue;
    }

    // alias Module.SubModule
    const aliasMatch = trimmed.match(/^alias\s+([A-Z][A-Za-z0-9_.]*)/);
    if (aliasMatch) {
      imports.push({
        moduleName: aliasMatch[1],
        importStyle: 'alias',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // import Module, only: [...] or import Module
    const importMatch = trimmed.match(/^import\s+([A-Z][A-Za-z0-9_.]*)/);
    if (importMatch) {
      const onlyMatch = trimmed.match(/only:\s*\[([^\]]+)\]/);
      const exceptMatch = trimmed.match(/except:\s*\[([^\]]+)\]/);
      
      imports.push({
        moduleName: importMatch[1],
        importStyle: 'import',
        only: onlyMatch ? onlyMatch[1].split(',').map(s => s.trim().replace(/:\s*\d+/, '')) : undefined,
        except: exceptMatch ? exceptMatch[1].split(',').map(s => s.trim().replace(/:\s*\d+/, '')) : undefined,
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
 * Find module/function usages in source code
 */
export function findModuleUsages(source: string, moduleNames: string[], fileName: string = 'file.ex'): ElixirUsageInfo[] {
  const usages: ElixirUsageInfo[] = [];
  const lines = source.split('\n');

  const patterns = moduleNames.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (patterns.length === 0) return usages;

  const modulePattern = patterns.join('|');
  // Match Module.function() or Module.function(args)
  const regex = new RegExp(`\\b(${modulePattern})\\.([a-z_][a-z0-9_!?]*)`, 'gi');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    if (line.trim().startsWith('#')) {
      continue;
    }

    // Skip import/alias/use/require lines
    if (/^\s*(import|alias|use|require)\s/.test(line)) {
      continue;
    }

    let match;
    while ((match = regex.exec(line)) !== null) {
      usages.push({
        identifier: match[1],
        function: match[2],
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
 * Get modules for a hex package
 */
export function getModulesForPackage(packageName: string): string[] {
  if (PACKAGE_TO_MODULE[packageName]) {
    return PACKAGE_TO_MODULE[packageName];
  }

  // Infer from package name
  // e.g., "my_package" -> "MyPackage"
  const pascalCase = packageName
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  
  return [pascalCase];
}

/**
 * Check if a module is from standard library
 */
export function isStandardModule(moduleName: string): boolean {
  return STANDARD_MODULES.has(moduleName) || 
         moduleName.startsWith(':') ||
         moduleName === 'Kernel' ||
         moduleName.startsWith('Kernel.');
}
