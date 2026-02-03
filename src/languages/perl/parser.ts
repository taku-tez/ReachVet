/**
 * ReachVet - Perl Import Parser
 * 
 * Parses Perl use/require statements:
 * - use Module;
 * - use Module qw(func1 func2);
 * - use Module ();
 * - require Module;
 * - use parent 'Module';
 * - use base 'Module';
 */

import type { CodeLocation } from '../../types.js';

export interface PerlImportInfo {
  /** The module being imported */
  moduleName: string;
  /** Import style */
  importStyle: 'use' | 'require' | 'parent' | 'base';
  /** Imported symbols */
  imports?: string[];
  /** Excluded from import (use Module ()) */
  noImport: boolean;
  /** Location in source */
  location: CodeLocation;
}

export interface PerlUsageInfo {
  /** Module/function being used */
  identifier: string;
  /** Method being called */
  method?: string;
  /** Is it an OO call (->) */
  isOO: boolean;
  /** Location in source */
  location: CodeLocation;
}

// Map CPAN distribution names to their modules
const DIST_TO_MODULE: Record<string, string[]> = {
  // Web Frameworks
  'Mojolicious': ['Mojolicious', 'Mojo::Base', 'Mojo::UserAgent'],
  'Dancer2': ['Dancer2'],
  'Catalyst-Runtime': ['Catalyst', 'Catalyst::Controller'],
  'Plack': ['Plack', 'Plack::Request', 'Plack::Response'],
  
  // Database
  'DBI': ['DBI'],
  'DBIx-Class': ['DBIx::Class', 'DBIx::Class::Schema'],
  'DBIx-Connector': ['DBIx::Connector'],
  'SQL-Abstract': ['SQL::Abstract'],
  
  // ORM/Data
  'Moose': ['Moose'],
  'Moo': ['Moo'],
  'Mouse': ['Mouse'],
  'Type-Tiny': ['Type::Tiny', 'Types::Standard'],
  
  // JSON/XML
  'JSON': ['JSON'],
  'JSON-XS': ['JSON::XS'],
  'JSON-MaybeXS': ['JSON::MaybeXS'],
  'Cpanel-JSON-XS': ['Cpanel::JSON::XS'],
  'XML-LibXML': ['XML::LibXML'],
  'XML-Simple': ['XML::Simple'],
  
  // HTTP/Networking
  'LWP': ['LWP::UserAgent', 'LWP::Simple'],
  'HTTP-Tiny': ['HTTP::Tiny'],
  'Furl': ['Furl'],
  'AnyEvent-HTTP': ['AnyEvent::HTTP'],
  'IO-Socket-SSL': ['IO::Socket::SSL'],
  
  // Templating
  'Template-Toolkit': ['Template'],
  'Text-Xslate': ['Text::Xslate'],
  'HTML-Template': ['HTML::Template'],
  
  // Testing
  'Test-More': ['Test::More', 'Test::Simple'],
  'Test2-Suite': ['Test2::V0', 'Test2::Bundle'],
  'Test-Deep': ['Test::Deep'],
  'Test-MockModule': ['Test::MockModule'],
  'Test-MockObject': ['Test::MockObject'],
  
  // Logging
  'Log-Log4perl': ['Log::Log4perl'],
  'Log-Any': ['Log::Any'],
  'Log-Dispatch': ['Log::Dispatch'],
  
  // Config
  'Config-General': ['Config::General'],
  'YAML': ['YAML'],
  'YAML-XS': ['YAML::XS'],
  'YAML-Tiny': ['YAML::Tiny'],
  
  // Date/Time
  'DateTime': ['DateTime'],
  'Time-Piece': ['Time::Piece'],
  'Date-Calc': ['Date::Calc'],
  
  // Async
  'AnyEvent': ['AnyEvent'],
  'IO-Async': ['IO::Async', 'IO::Async::Loop'],
  'Mojo-IOLoop': ['Mojo::IOLoop'],
  
  // Security
  'Crypt-Bcrypt': ['Crypt::Bcrypt'],
  'Digest-SHA': ['Digest::SHA'],
  'Crypt-JWT': ['Crypt::JWT'],
  
  // Email
  'Email-Simple': ['Email::Simple'],
  'Email-Sender': ['Email::Sender'],
  'Email-MIME': ['Email::MIME'],
  
  // Utils
  'Try-Tiny': ['Try::Tiny'],
  'Path-Tiny': ['Path::Tiny'],
  'File-Slurp': ['File::Slurp'],
  'List-MoreUtils': ['List::MoreUtils'],
  'Data-Dumper': ['Data::Dumper'],
};

// Core Perl modules
const CORE_MODULES = new Set([
  'strict', 'warnings', 'utf8', 'feature',
  'Carp', 'Exporter', 'Scalar::Util', 'List::Util',
  'File::Spec', 'File::Basename', 'File::Path',
  'Getopt::Long', 'Pod::Usage', 'Data::Dumper',
  'Encode', 'POSIX', 'Socket', 'Storable',
  'Time::HiRes', 'Time::Local', 'IO::File',
]);

/**
 * Parse Perl source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.pm'): PerlImportInfo[] {
  const imports: PerlImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments and POD
    if (trimmed.startsWith('#') || trimmed.startsWith('=')) {
      continue;
    }

    // use parent 'Module' or use parent qw(Module1 Module2)
    const parentMatch = trimmed.match(/^use\s+parent\s+(?:qw[(\[{\/]([^)\]}\/]+)[)\]}\/]|['"]([^'"]+)['"])/);
    if (parentMatch) {
      const modules = (parentMatch[1] || parentMatch[2]).split(/\s+/).filter(Boolean);
      for (const mod of modules) {
        imports.push({
          moduleName: mod,
          importStyle: 'parent',
          noImport: false,
          location: {
            file: fileName,
            line: lineNum,
            snippet: trimmed.slice(0, 100)
          }
        });
      }
      continue;
    }

    // use base 'Module' or use base qw(Module1 Module2)
    const baseMatch = trimmed.match(/^use\s+base\s+(?:qw[(\[{\/]([^)\]}\/]+)[)\]}\/]|['"]([^'"]+)['"])/);
    if (baseMatch) {
      const modules = (baseMatch[1] || baseMatch[2]).split(/\s+/).filter(Boolean);
      for (const mod of modules) {
        imports.push({
          moduleName: mod,
          importStyle: 'base',
          noImport: false,
          location: {
            file: fileName,
            line: lineNum,
            snippet: trimmed.slice(0, 100)
          }
        });
      }
      continue;
    }

    // use Module (); - import nothing
    const useEmptyMatch = trimmed.match(/^use\s+([A-Za-z][A-Za-z0-9_:]*)\s*\(\s*\)\s*;/);
    if (useEmptyMatch) {
      imports.push({
        moduleName: useEmptyMatch[1],
        importStyle: 'use',
        noImport: true,
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // use Module qw(func1 func2)
    const useQwMatch = trimmed.match(/^use\s+([A-Za-z][A-Za-z0-9_:]*)\s+qw[(\[{\/]([^)\]}\/]*)[)\]}\/]/);
    if (useQwMatch) {
      imports.push({
        moduleName: useQwMatch[1],
        importStyle: 'use',
        imports: useQwMatch[2].split(/\s+/).filter(Boolean),
        noImport: false,
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // use Module;
    const useMatch = trimmed.match(/^use\s+([A-Za-z][A-Za-z0-9_:]*)\s*;/);
    if (useMatch) {
      imports.push({
        moduleName: useMatch[1],
        importStyle: 'use',
        noImport: false,
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // require Module;
    const requireMatch = trimmed.match(/^require\s+([A-Za-z][A-Za-z0-9_:]*)\s*;/);
    if (requireMatch) {
      imports.push({
        moduleName: requireMatch[1],
        importStyle: 'require',
        noImport: true,
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
 * Find module/method usages in source code
 */
export function findModuleUsages(source: string, moduleNames: string[], fileName: string = 'file.pm'): PerlUsageInfo[] {
  const usages: PerlUsageInfo[] = [];
  const lines = source.split('\n');

  const patterns = moduleNames.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (patterns.length === 0) return usages;

  const modulePattern = patterns.join('|');
  // Match Module->method() or Module::function()
  const regex = new RegExp(`\\b(${modulePattern})(?:->|::)(\\w+)`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    if (line.trim().startsWith('#')) {
      continue;
    }

    // Skip use/require lines
    if (/^\s*(use|require)\s/.test(line)) {
      continue;
    }

    let match;
    while ((match = regex.exec(line)) !== null) {
      usages.push({
        identifier: match[1],
        method: match[2],
        isOO: line.includes('->'),
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
 * Get modules for a CPAN distribution
 */
export function getModulesForDist(distName: string): string[] {
  if (DIST_TO_MODULE[distName]) {
    return DIST_TO_MODULE[distName];
  }

  // Infer from distribution name
  // e.g., "My-Module" -> "My::Module"
  return [distName.replace(/-/g, '::')];
}

/**
 * Check if a module is from core Perl
 */
export function isCoreModule(moduleName: string): boolean {
  return CORE_MODULES.has(moduleName) || 
         moduleName.startsWith('CORE::');
}
