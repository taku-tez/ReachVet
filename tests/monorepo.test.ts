/**
 * Monorepo Detection & Multi-Project Analysis Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectMonorepo,
  discoverProjects,
  analyzeMonorepo,
  formatMonorepoReport,
  toMonorepoJson,
  formatMonorepoMarkdown,
  type MonorepoInfo,
  type ProjectInfo,
} from '../src/monorepo/index.js';

describe('Monorepo Detection', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reachvet-monorepo-test-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('npm workspaces', () => {
    it('should detect npm workspaces from package.json', async () => {
      const wsDir = path.join(tempDir, 'npm-ws');
      await fs.mkdir(wsDir, { recursive: true });
      
      // Create root package.json with workspaces
      await fs.writeFile(path.join(wsDir, 'package.json'), JSON.stringify({
        name: 'my-monorepo',
        workspaces: ['packages/*']
      }));
      
      // Create package directories
      await fs.mkdir(path.join(wsDir, 'packages', 'pkg-a'), { recursive: true });
      await fs.mkdir(path.join(wsDir, 'packages', 'pkg-b'), { recursive: true });
      
      await fs.writeFile(path.join(wsDir, 'packages', 'pkg-a', 'package.json'), JSON.stringify({
        name: '@mono/pkg-a',
        version: '1.0.0'
      }));
      
      await fs.writeFile(path.join(wsDir, 'packages', 'pkg-b', 'package.json'), JSON.stringify({
        name: '@mono/pkg-b',
        version: '1.0.0'
      }));

      const result = await detectMonorepo(wsDir);
      
      expect(result).not.toBeNull();
      expect(result!.type).toBe('npm-workspaces');
      expect(result!.workspaces).toHaveLength(2);
    });

    it('should detect yarn-style workspaces object', async () => {
      const wsDir = path.join(tempDir, 'yarn-ws');
      await fs.mkdir(wsDir, { recursive: true });
      
      await fs.writeFile(path.join(wsDir, 'package.json'), JSON.stringify({
        name: 'yarn-monorepo',
        workspaces: {
          packages: ['packages/*']
        }
      }));
      
      await fs.mkdir(path.join(wsDir, 'packages', 'core'), { recursive: true });
      await fs.writeFile(path.join(wsDir, 'packages', 'core', 'package.json'), JSON.stringify({
        name: '@yarn/core'
      }));

      const result = await detectMonorepo(wsDir);
      
      expect(result).not.toBeNull();
      expect(result!.type).toBe('npm-workspaces');
      expect(result!.workspaces.length).toBeGreaterThan(0);
    });
  });

  describe('pnpm workspaces', () => {
    it('should detect pnpm workspaces from pnpm-workspace.yaml', async () => {
      const wsDir = path.join(tempDir, 'pnpm-ws');
      await fs.mkdir(wsDir, { recursive: true });
      
      await fs.writeFile(path.join(wsDir, 'pnpm-workspace.yaml'), `packages:
  - 'packages/*'
  - 'apps/*'
`);
      
      await fs.mkdir(path.join(wsDir, 'packages', 'shared'), { recursive: true });
      await fs.writeFile(path.join(wsDir, 'packages', 'shared', 'package.json'), JSON.stringify({
        name: '@pnpm/shared'
      }));

      const result = await detectMonorepo(wsDir);
      
      expect(result).not.toBeNull();
      expect(result!.type).toBe('pnpm-workspaces');
      expect(result!.configFile).toContain('pnpm-workspace.yaml');
    });
  });

  describe('lerna', () => {
    it('should detect Lerna monorepo from lerna.json', async () => {
      const wsDir = path.join(tempDir, 'lerna');
      await fs.mkdir(wsDir, { recursive: true });
      
      await fs.writeFile(path.join(wsDir, 'lerna.json'), JSON.stringify({
        version: '1.0.0',
        packages: ['packages/*']
      }));
      
      await fs.mkdir(path.join(wsDir, 'packages', 'lerna-pkg'), { recursive: true });
      await fs.writeFile(path.join(wsDir, 'packages', 'lerna-pkg', 'package.json'), JSON.stringify({
        name: '@lerna/pkg'
      }));

      const result = await detectMonorepo(wsDir);
      
      expect(result).not.toBeNull();
      expect(result!.type).toBe('lerna');
      expect(result!.toolVersion).toBe('1.0.0');
    });
  });

  describe('Cargo workspace', () => {
    it('should detect Cargo workspace from Cargo.toml', async () => {
      const wsDir = path.join(tempDir, 'cargo-ws');
      await fs.mkdir(wsDir, { recursive: true });
      
      await fs.writeFile(path.join(wsDir, 'Cargo.toml'), `
[workspace]
members = [
  "crates/core",
  "crates/cli"
]
`);
      
      await fs.mkdir(path.join(wsDir, 'crates', 'core'), { recursive: true });
      await fs.writeFile(path.join(wsDir, 'crates', 'core', 'Cargo.toml'), `
[package]
name = "my-core"
version = "0.1.0"
`);

      const result = await detectMonorepo(wsDir);
      
      expect(result).not.toBeNull();
      expect(result!.type).toBe('cargo-workspace');
      expect(result!.workspaces.length).toBeGreaterThan(0);
    });
  });

  describe('Go workspace', () => {
    it('should detect Go workspace from go.work', async () => {
      const wsDir = path.join(tempDir, 'go-ws');
      await fs.mkdir(wsDir, { recursive: true });
      
      await fs.writeFile(path.join(wsDir, 'go.work'), `
go 1.21

use (
  ./cmd/app
  ./pkg/lib
)
`);
      
      await fs.mkdir(path.join(wsDir, 'cmd', 'app'), { recursive: true });
      await fs.writeFile(path.join(wsDir, 'cmd', 'app', 'go.mod'), `module example.com/cmd/app\n\ngo 1.21`);

      const result = await detectMonorepo(wsDir);
      
      expect(result).not.toBeNull();
      expect(result!.type).toBe('go-workspace');
      expect(result!.workspaces.length).toBe(2);
    });
  });

  describe('manual detection', () => {
    it('should detect multiple package.json files as manual monorepo', async () => {
      const wsDir = path.join(tempDir, 'manual');
      await fs.mkdir(wsDir, { recursive: true });
      
      // Create multiple projects without workspace config
      await fs.mkdir(path.join(wsDir, 'frontend'), { recursive: true });
      await fs.mkdir(path.join(wsDir, 'backend'), { recursive: true });
      
      await fs.writeFile(path.join(wsDir, 'frontend', 'package.json'), JSON.stringify({
        name: 'frontend',
        dependencies: { react: '^18.0.0' }
      }));
      
      await fs.writeFile(path.join(wsDir, 'backend', 'package.json'), JSON.stringify({
        name: 'backend',
        dependencies: { express: '^4.18.0' }
      }));

      const result = await detectMonorepo(wsDir);
      
      expect(result).not.toBeNull();
      expect(result!.type).toBe('manual');
      expect(result!.workspaces).toHaveLength(2);
    });

    it('should not detect single project as monorepo', async () => {
      const singleDir = path.join(tempDir, 'single');
      await fs.mkdir(singleDir, { recursive: true });
      
      await fs.writeFile(path.join(singleDir, 'package.json'), JSON.stringify({
        name: 'single-project'
      }));

      const result = await detectMonorepo(singleDir);
      
      expect(result).toBeNull();
    });
  });
});

describe('Project Discovery', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reachvet-proj-test-'));
    
    // Create test monorepo structure
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-monorepo',
      workspaces: ['packages/*']
    }));
    
    // JS package
    await fs.mkdir(path.join(tempDir, 'packages', 'web'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'packages', 'web', 'package.json'), JSON.stringify({
      name: '@test/web',
      version: '1.0.0',
      dependencies: {
        'lodash': '^4.17.21',
        'express': '^4.18.0'
      },
      devDependencies: {
        'typescript': '^5.0.0'
      }
    }));
    
    // Another JS package
    await fs.mkdir(path.join(tempDir, 'packages', 'api'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'packages', 'api', 'package.json'), JSON.stringify({
      name: '@test/api',
      version: '2.0.0',
      dependencies: {
        'fastify': '^4.0.0',
        'lodash': '^4.17.21'
      }
    }));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should discover projects from npm workspaces', async () => {
    const monorepo = await detectMonorepo(tempDir);
    expect(monorepo).not.toBeNull();
    
    const projects = await discoverProjects(monorepo!);
    
    expect(projects).toHaveLength(2);
    expect(projects.map(p => p.name)).toContain('@test/web');
    expect(projects.map(p => p.name)).toContain('@test/api');
  });

  it('should parse project info correctly', async () => {
    const monorepo = await detectMonorepo(tempDir);
    const projects = await discoverProjects(monorepo!);
    
    const webProject = projects.find(p => p.name === '@test/web');
    expect(webProject).toBeDefined();
    expect(webProject!.version).toBe('1.0.0');
    expect(webProject!.language).toBe('javascript');
    expect(webProject!.manifestFile).toBe('package.json');
    expect(webProject!.dependencies).toHaveLength(2); // lodash, express
  });

  it('should include devDependencies when option is set', async () => {
    const monorepo = await detectMonorepo(tempDir);
    const projects = await discoverProjects(monorepo!, { includeDevDependencies: true });
    
    const webProject = projects.find(p => p.name === '@test/web');
    expect(webProject!.dependencies).toHaveLength(3); // lodash, express, typescript
  });
});

describe('Monorepo Analysis', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reachvet-analysis-test-'));
    
    // Create monorepo with source files
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({
      name: 'analysis-monorepo',
      workspaces: ['packages/*']
    }));
    
    // Package with reachable dependency
    await fs.mkdir(path.join(tempDir, 'packages', 'app'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'packages', 'app', 'package.json'), JSON.stringify({
      name: '@test/app',
      version: '1.0.0',
      dependencies: {
        'lodash': '^4.17.21'
      }
    }));
    
    // Source file using lodash
    await fs.writeFile(path.join(tempDir, 'packages', 'app', 'index.js'), `
const _ = require('lodash');
const result = _.merge({}, { a: 1 });
module.exports = result;
`);
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should analyze monorepo and return results', async () => {
    const result = await analyzeMonorepo({ rootDir: tempDir });
    
    expect(result.monorepo.type).toBe('npm-workspaces');
    expect(result.projects).toHaveLength(1);
    expect(result.summary.totalProjects).toBe(1);
    expect(result.summary.totalDependencies).toBeGreaterThan(0);
  });

  it('should detect reachable dependencies', async () => {
    const result = await analyzeMonorepo({ rootDir: tempDir });
    
    const appResult = result.projects.find(p => p.project.name === '@test/app');
    expect(appResult).toBeDefined();
    expect(appResult!.analysis).not.toBeNull();
    
    const lodashResult = appResult!.analysis!.results.find(r => r.component.name === 'lodash');
    expect(lodashResult).toBeDefined();
    expect(lodashResult!.status).toBe('reachable');
  });

  it('should include duration metrics', async () => {
    const result = await analyzeMonorepo({ rootDir: tempDir });
    
    expect(result.totalDurationMs).toBeGreaterThan(0);
    expect(result.projects[0].durationMs).toBeGreaterThan(0);
  });
});

describe('Report Formatting', () => {
  const mockResult = {
    monorepo: {
      type: 'npm-workspaces' as const,
      rootDir: '/test/monorepo',
      configFile: '/test/monorepo/package.json',
      workspaces: ['/test/monorepo/packages/a', '/test/monorepo/packages/b']
    },
    projects: [
      {
        project: {
          name: '@test/a',
          version: '1.0.0',
          path: '/test/monorepo/packages/a',
          relativePath: 'packages/a',
          language: 'javascript',
          manifestFile: 'package.json',
          dependencies: [{ name: 'lodash', version: '4.17.21' }]
        },
        analysis: {
          results: [
            {
              component: {
                name: 'lodash',
                version: '4.17.21',
                type: 'library',
                vulnerabilities: [{ id: 'CVE-2021-23337', description: 'Prototype Pollution' }]
              },
              status: 'reachable' as const,
              confidence: 'high' as const,
              usage: { usedExports: ['merge'] }
            }
          ],
          summary: {
            total: 1,
            reachable: 1,
            imported: 0,
            notReachable: 0,
            indirect: 0,
            unknown: 0,
            vulnerableReachable: 1,
            warningsCount: 0
          }
        },
        durationMs: 150
      },
      {
        project: {
          name: '@test/b',
          version: '2.0.0',
          path: '/test/monorepo/packages/b',
          relativePath: 'packages/b',
          language: 'javascript',
          manifestFile: 'package.json',
          dependencies: [{ name: 'lodash', version: '4.17.21' }]
        },
        analysis: {
          results: [
            {
              component: {
                name: 'lodash',
                version: '4.17.21',
                type: 'library',
                vulnerabilities: [{ id: 'CVE-2021-23337', description: 'Prototype Pollution' }]
              },
              status: 'imported' as const,
              confidence: 'high' as const
            }
          ],
          summary: {
            total: 1,
            reachable: 0,
            imported: 1,
            notReachable: 0,
            indirect: 0,
            unknown: 0,
            vulnerableReachable: 0,
            warningsCount: 0
          }
        },
        durationMs: 100
      }
    ],
    summary: {
      totalProjects: 2,
      failedProjects: 0,
      totalDependencies: 2,
      uniqueDependencies: 1,
      vulnerableDependencies: 2,
      reachableVulnerabilities: 1,
      sharedDependencies: [
        {
          name: 'lodash',
          versions: ['4.17.21'],
          usedBy: ['@test/a', '@test/b'],
          vulnerable: true,
          reachable: true
        }
      ],
      topVulnerabilities: [
        {
          dependency: 'lodash',
          version: '4.17.21',
          cves: ['CVE-2021-23337'],
          affectedProjects: ['@test/a', '@test/b'],
          reachableInAny: true
        }
      ]
    },
    totalDurationMs: 500
  };

  describe('formatMonorepoReport', () => {
    it('should format text report correctly', () => {
      const report = formatMonorepoReport(mockResult as any);
      
      expect(report).toContain('MONOREPO ANALYSIS REPORT');
      expect(report).toContain('npm-workspaces');
      expect(report).toContain('Projects analyzed:    2');
      expect(report).toContain('Reachable vulns:      1');
      expect(report).toContain('lodash@4.17.21');
      expect(report).toContain('@test/a');
      expect(report).toContain('@test/b');
    });

    it('should show shared dependencies', () => {
      const report = formatMonorepoReport(mockResult as any);
      
      expect(report).toContain('SHARED DEPENDENCIES');
      expect(report).toContain('Used by: @test/a, @test/b');
    });

    it('should show vulnerability status', () => {
      const report = formatMonorepoReport(mockResult as any);
      
      expect(report).toContain('🔴 REACHABLE');
      expect(report).toContain('CVE-2021-23337');
    });
  });

  describe('toMonorepoJson', () => {
    it('should output valid JSON', () => {
      const json = toMonorepoJson(mockResult as any);
      const parsed = JSON.parse(json);
      
      expect(parsed.monorepo.type).toBe('npm-workspaces');
      expect(parsed.projects).toHaveLength(2);
      expect(parsed.summary.totalProjects).toBe(2);
    });
  });

  describe('formatMonorepoMarkdown', () => {
    it('should format Markdown report correctly', () => {
      const md = formatMonorepoMarkdown(mockResult as any);
      
      expect(md).toContain('# Monorepo Analysis Report');
      expect(md).toContain('## Overview');
      expect(md).toContain('| Type | npm-workspaces |');
      expect(md).toContain('## Top Vulnerabilities');
      expect(md).toContain('`lodash@4.17.21`');
      expect(md).toContain('### ✅ @test/a');
      expect(md).toContain('### ✅ @test/b');
    });

    it('should include tables', () => {
      const md = formatMonorepoMarkdown(mockResult as any);
      
      expect(md).toContain('| Property | Value |');
      expect(md).toContain('|----------|-------|');
    });
  });
});

describe('Edge Cases', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reachvet-edge-test-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should handle empty workspaces gracefully', async () => {
    const wsDir = path.join(tempDir, 'empty-ws');
    await fs.mkdir(wsDir, { recursive: true });
    
    await fs.writeFile(path.join(wsDir, 'package.json'), JSON.stringify({
      name: 'empty-monorepo',
      workspaces: ['packages/*']
    }));
    
    // No packages directory
    const monorepo = await detectMonorepo(wsDir);
    expect(monorepo).not.toBeNull();
    expect(monorepo!.workspaces).toHaveLength(0);
  });

  it('should skip node_modules in manual detection', async () => {
    const wsDir = path.join(tempDir, 'with-nm');
    await fs.mkdir(wsDir, { recursive: true });
    
    // Create fake node_modules
    await fs.mkdir(path.join(wsDir, 'node_modules', 'fake-pkg'), { recursive: true });
    await fs.writeFile(path.join(wsDir, 'node_modules', 'fake-pkg', 'package.json'), JSON.stringify({
      name: 'fake-pkg'
    }));
    
    // Create actual projects
    await fs.mkdir(path.join(wsDir, 'app1'), { recursive: true });
    await fs.mkdir(path.join(wsDir, 'app2'), { recursive: true });
    await fs.writeFile(path.join(wsDir, 'app1', 'package.json'), JSON.stringify({ name: 'app1' }));
    await fs.writeFile(path.join(wsDir, 'app2', 'package.json'), JSON.stringify({ name: 'app2' }));

    const monorepo = await detectMonorepo(wsDir);
    expect(monorepo).not.toBeNull();
    
    // Should only find app1 and app2, not node_modules
    const paths = monorepo!.workspaces.map(w => path.basename(w));
    expect(paths).not.toContain('fake-pkg');
    expect(paths).toContain('app1');
    expect(paths).toContain('app2');
  });

  it('should handle mixed language monorepo', async () => {
    const wsDir = path.join(tempDir, 'mixed');
    await fs.mkdir(wsDir, { recursive: true });
    
    // JS project
    await fs.mkdir(path.join(wsDir, 'web'), { recursive: true });
    await fs.writeFile(path.join(wsDir, 'web', 'package.json'), JSON.stringify({
      name: 'web',
      dependencies: { express: '^4.18.0' }
    }));
    
    // Go project
    await fs.mkdir(path.join(wsDir, 'api'), { recursive: true });
    await fs.writeFile(path.join(wsDir, 'api', 'go.mod'), 'module example.com/api\n\ngo 1.21');

    const monorepo = await detectMonorepo(wsDir);
    expect(monorepo).not.toBeNull();
    expect(monorepo!.type).toBe('manual');
    
    const projects = await discoverProjects(monorepo!);
    expect(projects).toHaveLength(2);
    
    const langs = projects.map(p => p.language);
    expect(langs).toContain('javascript');
    expect(langs).toContain('go');
  });

  it('should handle nested projects correctly', async () => {
    const wsDir = path.join(tempDir, 'nested');
    await fs.mkdir(wsDir, { recursive: true });
    
    // Parent project
    await fs.mkdir(path.join(wsDir, 'parent'), { recursive: true });
    await fs.writeFile(path.join(wsDir, 'parent', 'package.json'), JSON.stringify({
      name: 'parent'
    }));
    
    // Child project (should be skipped as it's nested)
    await fs.mkdir(path.join(wsDir, 'parent', 'child'), { recursive: true });
    await fs.writeFile(path.join(wsDir, 'parent', 'child', 'package.json'), JSON.stringify({
      name: 'child'
    }));
    
    // Sibling project
    await fs.mkdir(path.join(wsDir, 'sibling'), { recursive: true });
    await fs.writeFile(path.join(wsDir, 'sibling', 'package.json'), JSON.stringify({
      name: 'sibling'
    }));

    const monorepo = await detectMonorepo(wsDir);
    expect(monorepo).not.toBeNull();
    
    // Should find parent and sibling, but not nested child
    const names = monorepo!.workspaces.map(w => path.basename(w));
    expect(names).toContain('parent');
    expect(names).toContain('sibling');
    // Child is filtered out because it's under parent
    expect(names).not.toContain('child');
  });
});
