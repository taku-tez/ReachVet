/**
 * Tests for Go import parser
 */

import { describe, it, expect } from 'vitest';
import {
  parseGoSource,
  parseGoMod,
  findPackageUsages,
  extractPackageName,
  extractModuleName,
  isStandardLibrary,
} from '../src/languages/go/parser.js';

describe('Go Parser', () => {
  describe('parseGoSource', () => {
    it('should parse single import', () => {
      const source = `
package main

import "fmt"

func main() {
    fmt.Println("hello")
}
`;
      const imports = parseGoSource(source, 'main.go');
      expect(imports).toHaveLength(1);
      expect(imports[0].path).toBe('fmt');
      expect(imports[0].packageName).toBe('fmt');
    });

    it('should parse grouped imports', () => {
      const source = `
package main

import (
    "fmt"
    "net/http"
    "encoding/json"
)
`;
      const imports = parseGoSource(source, 'main.go');
      expect(imports).toHaveLength(3);
      expect(imports[0].path).toBe('fmt');
      expect(imports[1].path).toBe('net/http');
      expect(imports[2].path).toBe('encoding/json');
    });

    it('should parse aliased imports', () => {
      const source = `
package main

import (
    log "github.com/sirupsen/logrus"
    gin "github.com/gin-gonic/gin"
)
`;
      const imports = parseGoSource(source, 'main.go');
      expect(imports).toHaveLength(2);
      expect(imports[0].alias).toBe('log');
      expect(imports[0].path).toBe('github.com/sirupsen/logrus');
      expect(imports[1].alias).toBe('gin');
    });

    it('should parse dot imports', () => {
      const source = `
package main

import . "github.com/onsi/gomega"
`;
      const imports = parseGoSource(source, 'main.go');
      expect(imports).toHaveLength(1);
      expect(imports[0].isDotImport).toBe(true);
      expect(imports[0].path).toBe('github.com/onsi/gomega');
    });

    it('should parse blank imports', () => {
      const source = `
package main

import (
    _ "github.com/lib/pq"
    "database/sql"
)
`;
      const imports = parseGoSource(source, 'main.go');
      expect(imports).toHaveLength(2);
      expect(imports[0].isBlankImport).toBe(true);
      expect(imports[0].path).toBe('github.com/lib/pq');
      expect(imports[1].isBlankImport).toBeFalsy();
    });

    it('should handle single-line aliased import', () => {
      const source = `import log "github.com/sirupsen/logrus"`;
      const imports = parseGoSource(source, 'main.go');
      expect(imports).toHaveLength(1);
      expect(imports[0].alias).toBe('log');
      expect(imports[0].path).toBe('github.com/sirupsen/logrus');
    });

    it('should skip comments', () => {
      const source = `
package main

import (
    // This is a comment
    "fmt"
    "net/http" // inline comment
)
`;
      const imports = parseGoSource(source, 'main.go');
      expect(imports).toHaveLength(2);
    });

    it('should handle inline grouped imports', () => {
      const source = `import ( "fmt"; "os" )`;
      const imports = parseGoSource(source, 'main.go');
      expect(imports).toHaveLength(2);
      expect(imports[0].path).toBe('fmt');
      expect(imports[1].path).toBe('os');
    });
  });

  describe('parseGoMod', () => {
    it('should parse module name', () => {
      const content = `
module github.com/example/project

go 1.21
`;
      const mod = parseGoMod(content);
      expect(mod.module).toBe('github.com/example/project');
      expect(mod.goVersion).toBe('1.21');
    });

    it('should parse require block', () => {
      const content = `
module github.com/example/project

go 1.21

require (
    github.com/gin-gonic/gin v1.9.0
    github.com/sirupsen/logrus v1.9.3
)
`;
      const mod = parseGoMod(content);
      expect(mod.dependencies).toHaveLength(2);
      expect(mod.dependencies[0].module).toBe('github.com/gin-gonic/gin');
      expect(mod.dependencies[0].version).toBe('v1.9.0');
    });

    it('should parse indirect dependencies', () => {
      const content = `
module example.com/app

require (
    github.com/gin-gonic/gin v1.9.0
    golang.org/x/sys v0.15.0 // indirect
)
`;
      const mod = parseGoMod(content);
      expect(mod.dependencies[0].indirect).toBeFalsy();
      expect(mod.dependencies[1].indirect).toBe(true);
    });

    it('should parse single-line require', () => {
      const content = `
module example.com/app

require github.com/pkg/errors v0.9.1
`;
      const mod = parseGoMod(content);
      expect(mod.dependencies).toHaveLength(1);
      expect(mod.dependencies[0].module).toBe('github.com/pkg/errors');
    });

    it('should parse replace directives', () => {
      const content = `
module example.com/app

require github.com/original/pkg v1.0.0

replace github.com/original/pkg => github.com/fork/pkg v1.0.1
`;
      const mod = parseGoMod(content);
      expect(mod.dependencies[0].replacement).toBeDefined();
      expect(mod.dependencies[0].replacement?.module).toBe('github.com/fork/pkg');
      expect(mod.dependencies[0].replacement?.version).toBe('v1.0.1');
    });
  });

  describe('findPackageUsages', () => {
    it('should find function calls', () => {
      const source = `
package main

import "github.com/gin-gonic/gin"

func main() {
    r := gin.Default()
    r.GET("/", handler)
}
`;
      const usages = findPackageUsages(source, 'gin');
      // Note: findPackageUsages only finds direct package.Method calls
      // Method calls on variables (r.GET) are not tracked by this function
      expect(usages).toContain('Default');
    });

    it('should find usages with alias', () => {
      const source = `
package main

import log "github.com/sirupsen/logrus"

func main() {
    log.Info("starting")
    log.WithFields(log.Fields{"key": "value"}).Warn("warning")
    log.Error("error message")
}
`;
      const usages = findPackageUsages(source, 'logrus', 'log');
      expect(usages).toContain('Info');
      expect(usages).toContain('WithFields');
      expect(usages).toContain('Fields');
      expect(usages).toContain('Error');
      // Note: Warn is called on the return value of WithFields, not directly on log
      // so it won't be captured by findPackageUsages which looks for log.X patterns
    });
  });

  describe('extractPackageName', () => {
    it('should extract package name from simple path', () => {
      expect(extractPackageName('fmt')).toBe('fmt');
      expect(extractPackageName('net/http')).toBe('http');
      expect(extractPackageName('encoding/json')).toBe('json');
    });

    it('should extract package name from GitHub path', () => {
      expect(extractPackageName('github.com/gin-gonic/gin')).toBe('gin');
      expect(extractPackageName('github.com/sirupsen/logrus')).toBe('logrus');
    });

    it('should handle versioned paths', () => {
      expect(extractPackageName('github.com/user/repo/v2')).toBe('repo');
      expect(extractPackageName('github.com/user/repo/v3')).toBe('repo');
    });
  });

  describe('extractModuleName', () => {
    it('should extract module from standard library', () => {
      expect(extractModuleName('fmt')).toBe('fmt');
      expect(extractModuleName('net/http')).toBe('net');
    });

    it('should extract module from GitHub', () => {
      expect(extractModuleName('github.com/gin-gonic/gin')).toBe('github.com/gin-gonic/gin');
      expect(extractModuleName('github.com/user/repo/subpkg')).toBe('github.com/user/repo');
    });

    it('should handle versioned modules', () => {
      expect(extractModuleName('github.com/user/repo/v2')).toBe('github.com/user/repo/v2');
      expect(extractModuleName('github.com/user/repo/v2/subpkg')).toBe('github.com/user/repo/v2');
    });

    it('should handle golang.org packages', () => {
      expect(extractModuleName('golang.org/x/crypto')).toBe('golang.org/x/crypto');
      expect(extractModuleName('golang.org/x/crypto/bcrypt')).toBe('golang.org/x/crypto');
    });

    it('should handle gopkg.in packages', () => {
      expect(extractModuleName('gopkg.in/yaml.v3')).toBe('gopkg.in/yaml.v3');
    });
  });

  describe('isStandardLibrary', () => {
    it('should identify standard library packages', () => {
      expect(isStandardLibrary('fmt')).toBe(true);
      expect(isStandardLibrary('net/http')).toBe(true);
      expect(isStandardLibrary('encoding/json')).toBe(true);
      expect(isStandardLibrary('crypto/tls')).toBe(true);
    });

    it('should identify external packages', () => {
      expect(isStandardLibrary('github.com/gin-gonic/gin')).toBe(false);
      expect(isStandardLibrary('golang.org/x/crypto')).toBe(false);
      expect(isStandardLibrary('gopkg.in/yaml.v3')).toBe(false);
    });
  });
});
