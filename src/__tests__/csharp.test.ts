/**
 * ReachVet - C# Language Support Tests
 */

import { describe, it, expect } from 'vitest';
import { parseSource, findClassUsages, getNamespacesForPackage, isSystemNamespace } from '../languages/csharp/parser.js';
import { parseCsprojSdk, parsePackagesConfig, parseDirectoryPackagesProps, getTargetFramework } from '../languages/csharp/nuget.js';
import { CSharpAdapter } from '../languages/csharp/index.js';

describe('C# Parser', () => {
  describe('parseSource', () => {
    it('should parse basic using statements', () => {
      const code = `
using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Microsoft.Extensions.Logging;

namespace MyApp
{
    class Program { }
}
`;
      const imports = parseSource(code, 'Program.cs');
      
      expect(imports).toHaveLength(4);
      expect(imports[0].moduleName).toBe('System');
      expect(imports[0].importStyle).toBe('using');
      expect(imports[1].moduleName).toBe('System.Collections.Generic');
      expect(imports[2].moduleName).toBe('Newtonsoft.Json');
      expect(imports[3].moduleName).toBe('Microsoft.Extensions.Logging');
    });

    it('should parse using static', () => {
      const code = `
using System;
using static System.Console;
using static Newtonsoft.Json.JsonConvert;

namespace MyApp { }
`;
      const imports = parseSource(code, 'Program.cs');
      
      expect(imports).toHaveLength(3);
      expect(imports[1].importStyle).toBe('using_static');
      expect(imports[1].moduleName).toBe('System.Console');
      expect(imports[2].moduleName).toBe('Newtonsoft.Json.JsonConvert');
    });

    it('should parse using alias', () => {
      const code = `
using System;
using Json = Newtonsoft.Json.JsonConvert;
using Dict = System.Collections.Generic.Dictionary<string, object>;

namespace MyApp { }
`;
      const imports = parseSource(code, 'Program.cs');
      
      expect(imports).toHaveLength(3);
      expect(imports[1].importStyle).toBe('using_alias');
      expect(imports[1].alias).toBe('Json');
      expect(imports[1].moduleName).toBe('Newtonsoft.Json.JsonConvert');
    });

    it('should parse global using', () => {
      const code = `
global using System;
global using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

namespace MyApp { }
`;
      const imports = parseSource(code, 'Program.cs');
      
      expect(imports).toHaveLength(3);
      expect(imports[0].importStyle).toBe('global_using');
      expect(imports[0].moduleName).toBe('System');
      expect(imports[1].importStyle).toBe('global_using');
      expect(imports[2].importStyle).toBe('using');
    });

    it('should stop at namespace declaration', () => {
      const code = `
using System;
using Newtonsoft.Json;

namespace MyApp
{
    using SomeOther.Namespace;  // This should not be parsed
    class Program { }
}
`;
      const imports = parseSource(code, 'Program.cs');
      
      expect(imports).toHaveLength(2);
    });

    it('should include location info', () => {
      const code = `using System;
using Newtonsoft.Json;`;
      
      const imports = parseSource(code, 'MyFile.cs');
      
      expect(imports[0].location.file).toBe('MyFile.cs');
      expect(imports[0].location.line).toBe(1);
      expect(imports[1].location.line).toBe(2);
    });
  });

  describe('findClassUsages', () => {
    it('should find method calls', () => {
      const code = `
public class Test
{
    public void Run()
    {
        var json = JsonConvert.SerializeObject(obj);
        var result = JsonConvert.DeserializeObject<Data>(json);
    }
}
`;
      const usages = findClassUsages(code, ['JsonConvert'], 'Test.cs');
      
      expect(usages).toHaveLength(2);
      expect(usages[0].identifier).toBe('JsonConvert');
      expect(usages[0].method).toBe('SerializeObject');
      expect(usages[1].method).toBe('DeserializeObject');
    });

    it('should find constructor usage', () => {
      const code = `
var client = new RestClient("http://api.example.com");
var request = new RestRequest("/resource", Method.Get);
`;
      const usages = findClassUsages(code, ['RestClient', 'RestRequest'], 'Test.cs');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
    });

    it('should find generic type usage', () => {
      const code = `
var mapper = new MapperConfiguration(cfg => { });
ILogger<MyClass> logger;
DbSet<User> users;
`;
      const usages = findClassUsages(code, ['MapperConfiguration', 'ILogger', 'DbSet'], 'Test.cs');
      
      expect(usages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getNamespacesForPackage', () => {
    it('should return known mappings', () => {
      expect(getNamespacesForPackage('Newtonsoft.Json')).toContain('Newtonsoft.Json');
      expect(getNamespacesForPackage('Microsoft.EntityFrameworkCore')).toContain('Microsoft.EntityFrameworkCore');
      expect(getNamespacesForPackage('Serilog.Sinks.Console')).toContain('Serilog');
    });

    it('should infer from package name for unknown packages', () => {
      expect(getNamespacesForPackage('SomeRandom.Package')).toContain('SomeRandom.Package');
    });
  });

  describe('isSystemNamespace', () => {
    it('should identify system namespaces', () => {
      expect(isSystemNamespace('System')).toBe(true);
      expect(isSystemNamespace('System.Collections.Generic')).toBe(true);
      expect(isSystemNamespace('System.Linq')).toBe(true);
      expect(isSystemNamespace('System.Threading.Tasks')).toBe(true);
    });

    it('should not flag external namespaces', () => {
      expect(isSystemNamespace('Newtonsoft.Json')).toBe(false);
      expect(isSystemNamespace('Microsoft.Extensions.Logging')).toBe(false);
      expect(isSystemNamespace('Microsoft.EntityFrameworkCore')).toBe(false);
    });
  });
});

describe('NuGet Parser', () => {
  describe('parseCsprojSdk', () => {
    it('should parse SDK-style PackageReference', () => {
      const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog" Version="3.1.1" />
    <PackageReference Include="xunit" Version="2.4.2" PrivateAssets="All" />
  </ItemGroup>
</Project>
`;
      const deps = parseCsprojSdk(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].name).toBe('Newtonsoft.Json');
      expect(deps[0].version).toBe('13.0.3');
      expect(deps[2].isPrivateAssets).toBe(true);
    });

    it('should parse nested Version element', () => {
      const content = `
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Logging">
      <Version>8.0.0</Version>
    </PackageReference>
  </ItemGroup>
</Project>
`;
      const deps = parseCsprojSdk(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].version).toBe('8.0.0');
    });
  });

  describe('parsePackagesConfig', () => {
    it('should parse legacy packages.config', () => {
      const content = `
<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Newtonsoft.Json" version="13.0.1" targetFramework="net48" />
  <package id="EntityFramework" version="6.4.4" targetFramework="net48" />
</packages>
`;
      const deps = parsePackagesConfig(content);
      
      expect(deps).toHaveLength(2);
      expect(deps[0].name).toBe('Newtonsoft.Json');
      expect(deps[0].version).toBe('13.0.1');
    });
  });

  describe('parseDirectoryPackagesProps', () => {
    it('should parse Central Package Management', () => {
      const content = `
<Project>
  <ItemGroup>
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageVersion Include="Serilog" Version="3.1.1" />
  </ItemGroup>
</Project>
`;
      const versions = parseDirectoryPackagesProps(content);
      
      expect(versions.get('Newtonsoft.Json')).toBe('13.0.3');
      expect(versions.get('Serilog')).toBe('3.1.1');
    });
  });

  describe('getTargetFramework', () => {
    it('should extract single framework', () => {
      const content = `<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`;
      expect(getTargetFramework(content)).toBe('net8.0');
    });

    it('should extract first from multi-targeting', () => {
      const content = `<Project><PropertyGroup><TargetFrameworks>net6.0;net7.0;net8.0</TargetFrameworks></PropertyGroup></Project>`;
      expect(getTargetFramework(content)).toBe('net6.0');
    });
  });
});

describe('CSharpAdapter', () => {
  const adapter = new CSharpAdapter();

  it('should have correct language property', () => {
    expect(adapter.language).toBe('csharp');
  });

  it('should have correct file extensions', () => {
    expect(adapter.fileExtensions).toContain('.cs');
  });
});
