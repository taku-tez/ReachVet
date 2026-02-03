/**
 * Integration tests for Go Language Adapter
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GoLanguageAdapter } from '../src/languages/go/index.js';

describe('GoLanguageAdapter', () => {
  let adapter: GoLanguageAdapter;
  let tempDir: string;

  beforeAll(async () => {
    adapter = new GoLanguageAdapter();
    tempDir = join(tmpdir(), `reachvet-go-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('canHandle', () => {
    it('should detect Go project with go.mod', async () => {
      const projectDir = join(tempDir, 'go-mod-project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(join(projectDir, 'go.mod'), 'module example.com/test\n\ngo 1.21\n');
      
      expect(await adapter.canHandle(projectDir)).toBe(true);
    });

    it('should detect Go project with .go files only', async () => {
      const projectDir = join(tempDir, 'go-files-only');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(join(projectDir, 'main.go'), 'package main\n');
      
      expect(await adapter.canHandle(projectDir)).toBe(true);
    });

    it('should return false for non-Go project', async () => {
      const projectDir = join(tempDir, 'non-go');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(join(projectDir, 'package.json'), '{}');
      
      expect(await adapter.canHandle(projectDir)).toBe(false);
    });
  });

  describe('analyze', () => {
    it('should detect vulnerable package import', async () => {
      const projectDir = join(tempDir, 'vuln-project');
      await fs.mkdir(projectDir, { recursive: true });
      
      // Create go.mod
      await fs.writeFile(join(projectDir, 'go.mod'), `
module example.com/test

go 1.21

require github.com/dgrijalva/jwt-go v3.2.0+incompatible
`);
      
      // Create main.go with vulnerable package
      await fs.writeFile(join(projectDir, 'main.go'), `
package main

import (
    "fmt"
    jwt "github.com/dgrijalva/jwt-go"
)

func main() {
    token := jwt.New(jwt.SigningMethodHS256)
    fmt.Println(token)
}
`);

      const components = [{
        name: 'github.com/dgrijalva/jwt-go',
        version: 'v3.2.0+incompatible',
        vulnerabilities: [{
          id: 'CVE-2020-26160',
          severity: 'high' as const,
          description: 'JWT validation bypass',
        }],
      }];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should report dot import warnings', async () => {
      const projectDir = join(tempDir, 'dot-import-project');
      await fs.mkdir(projectDir, { recursive: true });
      
      await fs.writeFile(join(projectDir, 'go.mod'), `
module example.com/test

go 1.21

require github.com/vulnerable/pkg v1.0.0
`);
      
      await fs.writeFile(join(projectDir, 'main.go'), `
package main

import . "github.com/vulnerable/pkg"

func main() {
    DangerousFunc()
}
`);

      const components = [{
        name: 'github.com/vulnerable/pkg',
        version: 'v1.0.0',
      }];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].warnings).toBeDefined();
      expect(results[0].warnings?.some(w => w.code === 'dot_import')).toBe(true);
    });

    it('should handle aliased imports', async () => {
      const projectDir = join(tempDir, 'aliased-project');
      await fs.mkdir(projectDir, { recursive: true });
      
      await fs.writeFile(join(projectDir, 'go.mod'), `
module example.com/test

go 1.21

require github.com/sirupsen/logrus v1.9.0
`);
      
      await fs.writeFile(join(projectDir, 'main.go'), `
package main

import log "github.com/sirupsen/logrus"

func main() {
    log.Info("test")
    log.WithField("key", "value").Error("something went wrong")
}
`);

      const components = [{
        name: 'github.com/sirupsen/logrus',
        version: 'v1.9.0',
      }];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should skip test files by default', async () => {
      const projectDir = join(tempDir, 'test-files-project');
      await fs.mkdir(projectDir, { recursive: true });
      
      await fs.writeFile(join(projectDir, 'go.mod'), `
module example.com/test

go 1.21

require github.com/vulnerable/pkg v1.0.0
`);
      
      await fs.writeFile(join(projectDir, 'main.go'), `
package main

func main() {}
`);
      
      // Vulnerable code only in test file
      await fs.writeFile(join(projectDir, 'main_test.go'), `
package main

import (
    "testing"
    "github.com/vulnerable/pkg"
)

func TestSomething(t *testing.T) {
    pkg.DangerousFunc()
}
`);

      const components = [{
        name: 'github.com/vulnerable/pkg',
        version: 'v1.0.0',
      }];

      const results = await adapter.analyze(projectDir, components);
      
      // Should not find it because it's in a test file
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_reachable');
    });

    it('should mark package as not_reachable when not in go.mod', async () => {
      const projectDir = join(tempDir, 'missing-dep');
      await fs.mkdir(projectDir, { recursive: true });
      
      await fs.writeFile(join(projectDir, 'go.mod'), `
module example.com/test

go 1.21
`);
      
      await fs.writeFile(join(projectDir, 'main.go'), `
package main

func main() {}
`);

      const components = [{
        name: 'github.com/not-used/pkg',
        version: 'v1.0.0',
      }];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_reachable');
    });
  });

  describe('properties', () => {
    it('should have correct language', () => {
      expect(adapter.language).toBe('go');
    });

    it('should have correct file extensions', () => {
      expect(adapter.fileExtensions).toContain('.go');
    });
  });
});
