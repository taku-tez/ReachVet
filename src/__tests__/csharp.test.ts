/**
 * ReachVet C# Language Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSource, findClassUsages, getNamespacesForPackage, isSystemNamespace } from '../languages/csharp/parser.js';
import { parseCsprojSdk, parsePackagesConfig, getTargetFramework } from '../languages/csharp/nuget.js';
import { quickAnalyze } from '../core/analyzer.js';
import type { Component } from '../types.js';

describe('C# Parser', () => {
  describe('parseSource', () => {
    it('parses simple using statements', () => {
      const source = `
        using System;
        using System.Collections.Generic;
        using Newtonsoft.Json;
        
        namespace MyApp {
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(3);
      expect(imports[0].moduleName).toBe('System');
      expect(imports[2].moduleName).toBe('Newtonsoft.Json');
    });

    it('parses using static', () => {
      const source = `
        using static System.Math;
        using static System.Console;
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('using_static');
    });

    it('parses using alias', () => {
      const source = `
        using Json = Newtonsoft.Json.JsonConvert;
        using HttpClient = System.Net.Http.HttpClient;
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('using_alias');
      expect(imports[0].alias).toBe('Json');
    });

    it('parses global using', () => {
      const source = `
        global using System;
        global using System.Linq;
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('global_using');
    });

    it('stops at namespace declaration', () => {
      const source = `
        using System;
        
        namespace MyApp {
            using ShouldBeIgnored;
        }
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
    });

    it('ignores comments', () => {
      const source = `
        // using CommentedOut;
        /* using BlockComment; */
        using Real.Namespace;
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleName).toBe('Real.Namespace');
    });
  });

  describe('findClassUsages', () => {
    it('finds static method calls', () => {
      const source = `
        var json = JsonConvert.SerializeObject(obj);
        Console.WriteLine(json);
      `;
      const usages = findClassUsages(source, ['JsonConvert', 'Console']);
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
      expect(usages.some(u => u.identifier === 'JsonConvert' && u.method === 'SerializeObject')).toBe(true);
    });

    it('finds new instantiations', () => {
      const source = `
        var client = new HttpClient();
        var list = new List<string>();
      `;
      const usages = findClassUsages(source, ['HttpClient', 'List']);
      
      expect(usages.length).toBeGreaterThan(0);
    });
  });

  describe('getNamespacesForPackage', () => {
    it('returns known namespace mappings', () => {
      expect(getNamespacesForPackage('Newtonsoft.Json')).toContain('Newtonsoft.Json');
      expect(getNamespacesForPackage('Serilog')).toContain('Serilog');
      expect(getNamespacesForPackage('AutoMapper')).toContain('AutoMapper');
    });

    it('uses package name as namespace fallback', () => {
      const namespaces = getNamespacesForPackage('My.Custom.Package');
      expect(namespaces).toContain('My.Custom.Package');
    });
  });

  describe('isSystemNamespace', () => {
    it('identifies System namespaces', () => {
      expect(isSystemNamespace('System')).toBe(true);
      expect(isSystemNamespace('System.Collections.Generic')).toBe(true);
      expect(isSystemNamespace('System.Linq')).toBe(true);
    });

    it('identifies non-System namespaces', () => {
      expect(isSystemNamespace('Newtonsoft.Json')).toBe(false);
      expect(isSystemNamespace('Microsoft.Extensions.Logging')).toBe(false);
    });
  });
});

describe('NuGet Parser', () => {
  describe('parseCsprojSdk', () => {
    it('parses PackageReference elements', () => {
      const content = `
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup>
            <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
            <PackageReference Include="Serilog" Version="3.0.0" />
          </ItemGroup>
        </Project>
      `;
      const deps = parseCsprojSdk(content);
      
      expect(deps).toHaveLength(2);
      expect(deps[0].name).toBe('Newtonsoft.Json');
      expect(deps[0].version).toBe('13.0.3');
    });

    it('parses nested Version element', () => {
      const content = `
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup>
            <PackageReference Include="MyPackage">
              <Version>1.0.0</Version>
            </PackageReference>
          </ItemGroup>
        </Project>
      `;
      const deps = parseCsprojSdk(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].version).toBe('1.0.0');
    });

    it('detects PrivateAssets', () => {
      const content = `
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup>
            <PackageReference Include="Analyzer" Version="1.0.0" PrivateAssets="All" />
          </ItemGroup>
        </Project>
      `;
      const deps = parseCsprojSdk(content);
      
      expect(deps[0].isPrivateAssets).toBe(true);
    });
  });

  describe('parsePackagesConfig', () => {
    it('parses packages.config format', () => {
      const content = `
        <?xml version="1.0" encoding="utf-8"?>
        <packages>
          <package id="Newtonsoft.Json" version="13.0.3" targetFramework="net48" />
          <package id="log4net" version="2.0.15" targetFramework="net48" />
        </packages>
      `;
      const deps = parsePackagesConfig(content);
      
      expect(deps).toHaveLength(2);
      expect(deps[0].name).toBe('Newtonsoft.Json');
    });
  });

  describe('getTargetFramework', () => {
    it('parses single TargetFramework', () => {
      const content = `<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`;
      expect(getTargetFramework(content)).toBe('net8.0');
    });

    it('parses TargetFrameworks (multi)', () => {
      const content = `<Project><PropertyGroup><TargetFrameworks>net6.0;net7.0;net8.0</TargetFrameworks></PropertyGroup></Project>`;
      expect(getTargetFramework(content)).toBe('net6.0');
    });
  });
});

describe('C# Adapter Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-csharp-'));
    
    await writeFile(
      join(tempDir, 'MyApp.csproj'),
      `<Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup>
          <TargetFramework>net8.0</TargetFramework>
        </PropertyGroup>
        <ItemGroup>
          <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
          <PackageReference Include="Serilog" Version="3.0.0" />
        </ItemGroup>
      </Project>`
    );

    await mkdir(join(tempDir, 'src'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects used packages', async () => {
    await writeFile(
      join(tempDir, 'src', 'Program.cs'),
      `
        using System;
        using Newtonsoft.Json;
        
        namespace MyApp {
            class Program {
                static void Main() {
                    var json = JsonConvert.SerializeObject(new { Name = "Test" });
                    Console.WriteLine(json);
                }
            }
        }
      `
    );

    const components: Component[] = [
      { name: 'Newtonsoft.Json', version: '13.0.3' },
      { name: 'Serilog', version: '3.0.0' }
    ];

    const result = await quickAnalyze(tempDir, components, { language: 'csharp' });
    
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[1].status).toBe('not_reachable');
  });

  it('detects vulnerable method usage', async () => {
    await writeFile(
      join(tempDir, 'src', 'Service.cs'),
      `
        using Newtonsoft.Json;
        
        namespace MyApp {
            class Service {
                public object Parse(string json) {
                    return JsonConvert.DeserializeObject(json);
                }
            }
        }
      `
    );

    const components: Component[] = [
      { 
        name: 'Newtonsoft.Json', 
        version: '12.0.0',
        vulnerabilities: [{
          id: 'CVE-2024-XXXXX',
          severity: 'high',
          affectedFunctions: ['DeserializeObject']
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components, { language: 'csharp' });
    
    expect(result.results[0].status).toBe('reachable');
  });
});
