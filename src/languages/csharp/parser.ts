/**
 * ReachVet - C# Import Parser
 * 
 * Parses C# using statements:
 * - using Namespace;
 * - using Namespace.SubNamespace;
 * - using static Namespace.Class;
 * - using Alias = Namespace.Class;
 * - global using Namespace;
 */

import type { CodeLocation } from '../../types.js';

export interface CSharpImportInfo {
  /** The namespace being imported */
  moduleName: string;
  /** Import style */
  importStyle: 'using' | 'using_static' | 'using_alias' | 'global_using';
  /** Alias if any */
  alias?: string;
  /** Location in source */
  location: CodeLocation;
}

export interface CSharpUsageInfo {
  /** Class/type being used */
  identifier: string;
  /** Method being called (if any) */
  method?: string;
  /** Is it a static call */
  isStatic: boolean;
  /** Location in source */
  location: CodeLocation;
}

// Map NuGet package names to their namespaces
const PACKAGE_TO_NAMESPACE: Record<string, string[]> = {
  'Newtonsoft.Json': ['Newtonsoft.Json'],
  'System.Text.Json': ['System.Text.Json'],
  'Microsoft.Extensions.DependencyInjection': ['Microsoft.Extensions.DependencyInjection'],
  'Microsoft.Extensions.Logging': ['Microsoft.Extensions.Logging'],
  'Microsoft.Extensions.Configuration': ['Microsoft.Extensions.Configuration'],
  'Microsoft.Extensions.Http': ['Microsoft.Extensions.Http'],
  'Microsoft.EntityFrameworkCore': ['Microsoft.EntityFrameworkCore'],
  'Microsoft.EntityFrameworkCore.SqlServer': ['Microsoft.EntityFrameworkCore'],
  'Microsoft.AspNetCore.Mvc': ['Microsoft.AspNetCore.Mvc'],
  'Microsoft.AspNetCore.Http': ['Microsoft.AspNetCore.Http'],
  'Microsoft.AspNetCore.Identity': ['Microsoft.AspNetCore.Identity'],
  'AutoMapper': ['AutoMapper'],
  'FluentValidation': ['FluentValidation'],
  'MediatR': ['MediatR'],
  'Serilog': ['Serilog'],
  'Serilog.Sinks.Console': ['Serilog'],
  'Serilog.Sinks.File': ['Serilog'],
  'NLog': ['NLog'],
  'Dapper': ['Dapper'],
  'StackExchange.Redis': ['StackExchange.Redis'],
  'Npgsql': ['Npgsql'],
  'MySql.Data': ['MySql.Data'],
  'MongoDB.Driver': ['MongoDB.Driver', 'MongoDB.Bson'],
  'RabbitMQ.Client': ['RabbitMQ.Client'],
  'MassTransit': ['MassTransit'],
  'Polly': ['Polly'],
  'RestSharp': ['RestSharp'],
  'Refit': ['Refit'],
  'Hangfire': ['Hangfire'],
  'Quartz': ['Quartz'],
  'xunit': ['Xunit'],
  'NUnit': ['NUnit.Framework'],
  'Moq': ['Moq'],
  'FluentAssertions': ['FluentAssertions'],
  'Bogus': ['Bogus'],
  'AWSSDK.Core': ['Amazon'],
  'AWSSDK.S3': ['Amazon.S3'],
  'AWSSDK.DynamoDBv2': ['Amazon.DynamoDBv2'],
  'Azure.Storage.Blobs': ['Azure.Storage.Blobs'],
  'Azure.Identity': ['Azure.Identity'],
  'Microsoft.Azure.Cosmos': ['Microsoft.Azure.Cosmos'],
  'Swashbuckle.AspNetCore': ['Swashbuckle.AspNetCore'],
  'IdentityServer4': ['IdentityServer4'],
  'Ocelot': ['Ocelot'],
  'GraphQL': ['GraphQL'],
  'HotChocolate': ['HotChocolate'],
};

// System namespaces (BCL)
const SYSTEM_NAMESPACES = new Set([
  'System', 'System.Collections', 'System.Collections.Generic', 'System.Collections.Concurrent',
  'System.Linq', 'System.IO', 'System.Text', 'System.Threading', 'System.Threading.Tasks',
  'System.Net', 'System.Net.Http', 'System.Reflection', 'System.Runtime',
  'System.Diagnostics', 'System.ComponentModel', 'System.Data', 'System.Xml',
  'System.Security', 'System.Globalization', 'System.Resources', 'System.Drawing',
  'Microsoft.CSharp', 'Microsoft.VisualBasic',
]);

/**
 * Parse C# source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.cs'): CSharpImportInfo[] {
  const imports: CSharpImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Stop parsing at namespace/class declaration (using statements should be at top)
    if (trimmed.startsWith('namespace ') || trimmed.startsWith('public class ') || 
        trimmed.startsWith('internal class ') || trimmed.startsWith('class ')) {
      break;
    }

    // global using Namespace;
    const globalUsingMatch = trimmed.match(/^global\s+using\s+([A-Za-z0-9_.]+)\s*;/);
    if (globalUsingMatch) {
      imports.push({
        moduleName: globalUsingMatch[1],
        importStyle: 'global_using',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // using static Namespace.Class;
    const usingStaticMatch = trimmed.match(/^using\s+static\s+([A-Za-z0-9_.]+)\s*;/);
    if (usingStaticMatch) {
      imports.push({
        moduleName: usingStaticMatch[1],
        importStyle: 'using_static',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // using Alias = Namespace.Class; (also handles generics like Dictionary<string, object>)
    const usingAliasMatch = trimmed.match(/^using\s+([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_.<>,\s]+)\s*;/);
    if (usingAliasMatch) {
      imports.push({
        moduleName: usingAliasMatch[2],
        importStyle: 'using_alias',
        alias: usingAliasMatch[1],
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // using Namespace;
    const usingMatch = trimmed.match(/^using\s+([A-Za-z0-9_.]+)\s*;/);
    if (usingMatch) {
      imports.push({
        moduleName: usingMatch[1],
        importStyle: 'using',
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
 * Find usages of classes in source code
 */
export function findClassUsages(source: string, classNames: string[], fileName: string = 'file.cs'): CSharpUsageInfo[] {
  const usages: CSharpUsageInfo[] = [];
  const lines = source.split('\n');

  const patterns = classNames.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (patterns.length === 0) return usages;

  const classPattern = patterns.join('|');
  // Match ClassName.Method() or new ClassName() or ClassName<T>
  const regex = new RegExp(`(?:new\\s+)?(${classPattern})(?:<[^>]+>)?(?:\\.(\\w+))?`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
      continue;
    }

    let match;
    while ((match = regex.exec(line)) !== null) {
      usages.push({
        identifier: match[1],
        method: match[2],
        isStatic: !line.includes('new ') && line.includes('.'),
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
 * Get namespaces for a NuGet package
 */
export function getNamespacesForPackage(packageName: string): string[] {
  if (PACKAGE_TO_NAMESPACE[packageName]) {
    return PACKAGE_TO_NAMESPACE[packageName];
  }

  // Try to infer from package name
  // Package names in NuGet often match namespace
  return [packageName];
}

/**
 * Check if a namespace is from BCL (System.*)
 */
export function isSystemNamespace(namespace: string): boolean {
  if (SYSTEM_NAMESPACES.has(namespace)) {
    return true;
  }
  // Check if it starts with System. or Microsoft. (for BCL)
  return namespace.startsWith('System.') || 
         (namespace.startsWith('Microsoft.') && 
          !namespace.startsWith('Microsoft.Extensions.') &&
          !namespace.startsWith('Microsoft.EntityFrameworkCore') &&
          !namespace.startsWith('Microsoft.AspNetCore'));
}

/**
 * Extract package name from namespace
 */
export function extractPackageFromNamespace(namespace: string): string | null {
  // Check known mappings
  for (const [pkg, namespaces] of Object.entries(PACKAGE_TO_NAMESPACE)) {
    for (const ns of namespaces) {
      if (namespace === ns || namespace.startsWith(ns + '.')) {
        return pkg;
      }
    }
  }
  return null;
}
