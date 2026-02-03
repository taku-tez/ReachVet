/**
 * ReachVet - Elixir Language Support Tests
 */

import { describe, it, expect } from 'vitest';
import { parseSource, findModuleUsages, getModulesForPackage, isStandardModule } from '../languages/elixir/parser.js';
import { parseMixExs, parseMixLock, getElixirVersion, getAppName, isUmbrellaProject } from '../languages/elixir/mix.js';
import { ElixirAdapter } from '../languages/elixir/index.js';

describe('Elixir Parser', () => {
  describe('parseSource', () => {
    it('should parse use statements', () => {
      const code = `
defmodule MyApp.Web do
  use Phoenix.Controller
  use Phoenix.LiveView
end
`;
      const imports = parseSource(code, 'web.ex');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].moduleName).toBe('Phoenix.Controller');
      expect(imports[0].importStyle).toBe('use');
      expect(imports[1].moduleName).toBe('Phoenix.LiveView');
    });

    it('should parse alias statements', () => {
      const code = `
defmodule MyApp.Web do
  alias MyApp.Accounts.User
  alias MyApp.Repo
end
`;
      const imports = parseSource(code, 'web.ex');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].moduleName).toBe('MyApp.Accounts.User');
      expect(imports[0].importStyle).toBe('alias');
    });

    it('should parse alias with as', () => {
      const code = `
defmodule MyApp.Web do
  alias MyApp.Accounts.User, as: U
end
`;
      const imports = parseSource(code, 'web.ex');
      
      expect(imports).toHaveLength(1);
      expect(imports[0].alias).toBe('U');
    });

    it('should parse multi-alias', () => {
      const code = `
defmodule MyApp.Web do
  alias MyApp.Accounts.{User, Admin, Guest}
end
`;
      const imports = parseSource(code, 'web.ex');
      
      expect(imports).toHaveLength(3);
      expect(imports[0].moduleName).toBe('MyApp.Accounts.User');
      expect(imports[1].moduleName).toBe('MyApp.Accounts.Admin');
      expect(imports[2].moduleName).toBe('MyApp.Accounts.Guest');
    });

    it('should parse import statements', () => {
      const code = `
defmodule MyApp.Web do
  import Ecto.Query
  import Ecto.Changeset, only: [cast: 2, validate_required: 2]
end
`;
      const imports = parseSource(code, 'web.ex');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].moduleName).toBe('Ecto.Query');
      expect(imports[0].importStyle).toBe('import');
      expect(imports[1].only).toContain('cast');
      expect(imports[1].only).toContain('validate_required');
    });

    it('should parse require statements', () => {
      const code = `
defmodule MyApp.Web do
  require Logger
end
`;
      const imports = parseSource(code, 'web.ex');
      
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleName).toBe('Logger');
      expect(imports[0].importStyle).toBe('require');
    });
  });

  describe('findModuleUsages', () => {
    it('should find module function calls', () => {
      const code = `
defmodule MyApp.Web do
  def index(conn, _params) do
    users = Repo.all(User)
    json = Jason.encode!(users)
    render(conn, "index.html", users: users)
  end
end
`;
      const usages = findModuleUsages(code, ['Repo', 'Jason'], 'web.ex');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
      expect(usages.find(u => u.identifier === 'Repo')).toBeDefined();
      expect(usages.find(u => u.identifier === 'Jason')).toBeDefined();
    });
  });

  describe('getModulesForPackage', () => {
    it('should return known mappings', () => {
      expect(getModulesForPackage('phoenix')).toContain('Phoenix');
      expect(getModulesForPackage('ecto')).toContain('Ecto');
      expect(getModulesForPackage('jason')).toContain('Jason');
    });

    it('should infer from package name', () => {
      const modules = getModulesForPackage('my_package');
      expect(modules).toContain('MyPackage');
    });
  });

  describe('isStandardModule', () => {
    it('should identify standard modules', () => {
      expect(isStandardModule('Kernel')).toBe(true);
      expect(isStandardModule('Enum')).toBe(true);
      expect(isStandardModule('Map')).toBe(true);
      expect(isStandardModule('GenServer')).toBe(true);
    });

    it('should not flag third-party modules', () => {
      expect(isStandardModule('Phoenix')).toBe(false);
      expect(isStandardModule('Ecto')).toBe(false);
      expect(isStandardModule('Jason')).toBe(false);
    });
  });
});

describe('Mix Parser', () => {
  describe('parseMixExs', () => {
    it('should parse hex dependencies', () => {
      const content = `
defmodule MyApp.MixProject do
  defp deps do
    [
      {:phoenix, "~> 1.7.0"},
      {:ecto_sql, "~> 3.10"},
      {:jason, "~> 1.4"},
      {:mox, "~> 1.0", only: :test}
    ]
  end
end
`;
      const deps = parseMixExs(content);
      
      expect(deps).toHaveLength(4);
      expect(deps[0].name).toBe('phoenix');
      expect(deps[0].version).toBe('~> 1.7.0');
      expect(deps[3].name).toBe('mox');
      expect(deps[3].only).toContain('test');
    });

    it('should parse git dependencies', () => {
      const content = `
defmodule MyApp.MixProject do
  defp deps do
    [
      {:my_lib, git: "https://github.com/user/my_lib.git", tag: "v1.0.0"}
    ]
  end
end
`;
      const deps = parseMixExs(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].source).toBe('git');
      expect(deps[0].version).toBe('v1.0.0');
    });

    it('should parse path dependencies', () => {
      const content = `
defmodule MyApp.MixProject do
  defp deps do
    [
      {:my_lib, path: "../my_lib"}
    ]
  end
end
`;
      const deps = parseMixExs(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].source).toBe('path');
      expect(deps[0].version).toBe('local');
    });
  });

  describe('parseMixLock', () => {
    it('should parse locked versions', () => {
      const content = `
%{
  "jason": {:hex, :jason, "1.4.0", "e855..."},
  "phoenix": {:hex, :phoenix, "1.7.7", "abc..."},
}
`;
      const deps = parseMixLock(content);
      
      expect(deps).toHaveLength(2);
      expect(deps.find(d => d.name === 'jason')?.version).toBe('1.4.0');
      expect(deps.find(d => d.name === 'phoenix')?.version).toBe('1.7.7');
    });
  });

  describe('getElixirVersion', () => {
    it('should extract Elixir version', () => {
      const content = `
defmodule MyApp.MixProject do
  def project do
    [
      app: :my_app,
      elixir: "~> 1.14",
    ]
  end
end
`;
      expect(getElixirVersion(content)).toBe('~> 1.14');
    });
  });

  describe('getAppName', () => {
    it('should extract app name', () => {
      const content = `
defmodule MyApp.MixProject do
  def project do
    [
      app: :my_app,
    ]
  end
end
`;
      expect(getAppName(content)).toBe('my_app');
    });
  });

  describe('isUmbrellaProject', () => {
    it('should detect umbrella projects', () => {
      const umbrella = `apps_path: "apps"`;
      expect(isUmbrellaProject(umbrella)).toBe(true);

      const regular = `app: :my_app`;
      expect(isUmbrellaProject(regular)).toBe(false);
    });
  });
});

describe('ElixirAdapter', () => {
  const adapter = new ElixirAdapter();

  it('should have correct language property', () => {
    expect(adapter.language).toBe('elixir');
  });

  it('should have correct file extensions', () => {
    expect(adapter.fileExtensions).toContain('.ex');
    expect(adapter.fileExtensions).toContain('.exs');
  });
});
