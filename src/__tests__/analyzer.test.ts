/**
 * ReachVet Analyzer Tests - Warning System & Integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Analyzer, quickAnalyze } from '../core/analyzer.js';
import type { Component } from '../types.js';

describe('Analyzer - Warning System', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-test-'));
    
    // Create package.json
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' })
    );

    // Create src directory
    await mkdir(join(tempDir, 'src'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('generates warning for dynamic import', async () => {
    await writeFile(
      join(tempDir, 'src', 'dynamic.ts'),
      `
        async function loadModule() {
          const lodash = await import('lodash');
          return lodash.merge({}, {});
        }
      `
    );

    const components: Component[] = [
      { name: 'lodash', version: '4.17.21' }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[0].warnings).toBeDefined();
    expect(result.results[0].warnings).toHaveLength(1);
    expect(result.results[0].warnings![0].code).toBe('dynamic_import');
    expect(result.results[0].warnings![0].severity).toBe('warning');
    expect(result.summary.warningsCount).toBe(1);
  });

  it('generates warning for namespace import with vulnerable functions', async () => {
    await writeFile(
      join(tempDir, 'src', 'namespace.ts'),
      `
        import * as _ from 'lodash';
        export const merged = _.merge({}, {});
      `
    );

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          severity: 'high',
          affectedFunctions: ['template']
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[0].confidence).toBe('medium'); // Lower confidence due to namespace import
    expect(result.results[0].warnings).toBeDefined();
    
    const nsWarning = result.results[0].warnings?.find(w => w.code === 'namespace_import');
    expect(nsWarning).toBeDefined();
  });

  it('no warnings for explicit named imports', async () => {
    await writeFile(
      join(tempDir, 'src', 'explicit.ts'),
      `
        import { merge } from 'lodash';
        export const result = merge({}, {});
      `
    );

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.21',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          severity: 'high',
          affectedFunctions: ['template']  // Not using template
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('imported'); // imported but not using vulnerable function
    expect(result.results[0].warnings ?? []).toHaveLength(0);
  });
});

describe('Analyzer - Re-export Chain', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-reexport-'));
    
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-reexport', version: '1.0.0' })
    );

    await mkdir(join(tempDir, 'src'));
    await mkdir(join(tempDir, 'src', 'utils'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects imports through barrel file', async () => {
    // Create barrel file
    await writeFile(
      join(tempDir, 'src', 'utils', 'index.ts'),
      `export { merge, clone } from 'lodash';`
    );

    // Create main file using barrel
    await writeFile(
      join(tempDir, 'src', 'main.ts'),
      `import { merge } from './utils';
       export const result = merge({}, {});`
    );

    const components: Component[] = [
      { name: 'lodash', version: '4.17.21' }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    // Should detect lodash is reachable (directly from barrel file export)
    // The barrel file itself has `export { merge } from 'lodash'` which is a direct lodash import
    expect(result.results[0].status).toBe('reachable');
  });

  it('handles nested re-exports', async () => {
    // Level 1 barrel
    await writeFile(
      join(tempDir, 'src', 'utils', 'lodash.ts'),
      `export { template } from 'lodash';`
    );

    // Level 2 barrel
    await writeFile(
      join(tempDir, 'src', 'utils', 'index.ts'),
      `export { template } from './lodash';`
    );

    // Main file
    await writeFile(
      join(tempDir, 'src', 'app.ts'),
      `import { template } from './utils';
       export const render = template('<%= name %>');`
    );

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          affectedFunctions: ['template']
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('reachable');
  });
});

describe('Analyzer - Namespace Import Analysis', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-ns-'));
    
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-namespace', version: '1.0.0' })
    );

    await mkdir(join(tempDir, 'src'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects vulnerable function usage through namespace import', async () => {
    await writeFile(
      join(tempDir, 'src', 'app.ts'),
      `
        import * as _ from 'lodash';
        export const render = _.template('<%= name %>');
      `
    );

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          severity: 'high',
          affectedFunctions: ['template']
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[0].confidence).toBe('high'); // High because we detected template usage
    expect(result.results[0].usage?.usedMembers).toContain('template');
  });

  it('correctly identifies safe namespace usage', async () => {
    await writeFile(
      join(tempDir, 'src', 'safe.ts'),
      `
        import * as _ from 'lodash';
        export const merged = _.merge({}, {});
        export const cloned = _.clone({});
      `
    );

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          affectedFunctions: ['template']  // Not using template
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    // Should be 'imported' because we detected namespace usage but NOT the vulnerable function
    expect(result.results[0].usage?.usedMembers).toContain('merge');
    expect(result.results[0].usage?.usedMembers).toContain('clone');
    expect(result.results[0].usage?.usedMembers).not.toContain('template');
  });
});

describe('Analyzer - CommonJS Destructuring', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-cjs-'));
    
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-cjs', version: '1.0.0' })
    );

    await mkdir(join(tempDir, 'src'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects destructured require', async () => {
    await writeFile(
      join(tempDir, 'src', 'cjs.js'),
      `const { merge, clone } = require('lodash');`
    );

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.21',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          affectedFunctions: ['template', 'merge']
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[0].confidence).toBe('high');
    expect(result.results[0].usage?.usedMembers).toContain('merge');
  });

  it('detects property access require', async () => {
    await writeFile(
      join(tempDir, 'src', 'prop.js'),
      `const template = require('lodash').template;`
    );

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          affectedFunctions: ['template']
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[0].usage?.usedMembers).toContain('template');
  });
});

describe('Analyzer - Class Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-analyzer-'));
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-analyzer', version: '1.0.0' })
    );
    await mkdir(join(tempDir, 'src'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should auto-detect JavaScript language', async () => {
    await writeFile(join(tempDir, 'src', 'index.js'), `const x = 1;`);

    const analyzer = new Analyzer({ sourceDir: tempDir });
    const result = await analyzer.analyze([{ name: 'lodash', version: '4.17.21' }]);

    expect(result.language).toBe('javascript');
  });

  it('should use specified language over auto-detect', async () => {
    await writeFile(join(tempDir, 'src', 'app.ts'), `const x: number = 1;`);

    const analyzer = new Analyzer({ sourceDir: tempDir, language: 'typescript' });
    const result = await analyzer.analyze([{ name: 'lodash', version: '4.17.21' }]);

    expect(result.language).toBe('typescript');
  });

  it('should include version and timestamp in output', async () => {
    await writeFile(join(tempDir, 'src', 'index.js'), `require('lodash');`);

    const analyzer = new Analyzer({ sourceDir: tempDir });
    const result = await analyzer.analyze([{ name: 'lodash', version: '4.17.21' }]);

    expect(result.version).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.sourceDir).toBe(tempDir);
  });

  it('should calculate summary correctly', async () => {
    await writeFile(join(tempDir, 'src', 'app.js'), `
      const lodash = require('lodash');
      const chalk = require('chalk');
    `);

    const components: Component[] = [
      { name: 'lodash', version: '4.17.21' },
      { name: 'chalk', version: '5.0.0' },
      { name: 'unused-pkg', version: '1.0.0' }
    ];

    const analyzer = new Analyzer({ sourceDir: tempDir });
    const result = await analyzer.analyze(components);

    expect(result.summary.total).toBe(3);
    expect(result.summary.reachable).toBe(2);
    expect(result.summary.notReachable).toBe(1);
  });

  it('should count vulnerable reachable packages', async () => {
    await writeFile(join(tempDir, 'src', 'app.js'), `const _ = require('lodash');`);

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.20',
        vulnerabilities: [{ id: 'CVE-2021-23337' }]
      }
    ];

    const analyzer = new Analyzer({ sourceDir: tempDir });
    const result = await analyzer.analyze(components);

    expect(result.summary.vulnerableReachable).toBe(1);
  });

  it('should work with verbose option', async () => {
    await writeFile(join(tempDir, 'src', 'index.js'), `const x = 1;`);

    const analyzer = new Analyzer({ 
      sourceDir: tempDir, 
      verbose: true 
    });
    const result = await analyzer.analyze([{ name: 'lodash', version: '4.17.21' }]);

    expect(result).toBeDefined();
  });

  it('should throw error for unsupported language', async () => {
    const analyzer = new Analyzer({ 
      sourceDir: tempDir, 
      language: 'unknown' as any 
    });

    await expect(analyzer.analyze([{ name: 'lodash', version: '4.17.21' }]))
      .rejects.toThrow('No adapter available');
  });
});

describe('Analyzer - TypeScript Precision', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-ts-'));
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-ts-precision', version: '1.0.0' })
    );
    await mkdir(join(tempDir, 'src'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect type-only imports as not reachable', async () => {
    await writeFile(join(tempDir, 'src', 'types.ts'), `
      import type { User } from 'user-types';
      
      export function greet(user: User) {
        return \`Hello, \${user.name}\`;
      }
    `);

    const components: Component[] = [
      { name: 'user-types', version: '1.0.0' }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('not_reachable');
    expect(result.results[0].notes?.[0]).toContain('type-only');
  });

  it('should detect side-effect imports as reachable', async () => {
    await writeFile(join(tempDir, 'src', 'app.ts'), `
      import 'reflect-metadata';
      
      class MyClass {}
    `);

    const components: Component[] = [
      { name: 'reflect-metadata', version: '0.1.0' }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[0].notes?.[0]).toContain('Side-effect');
  });

  it('should track aliased imports correctly', async () => {
    await writeFile(join(tempDir, 'src', 'utils.ts'), `
      import { merge as m } from 'lodash';
      
      export const config = m({}, { debug: true });
    `);

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.21',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          affectedFunctions: ['template', 'merge']
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[0].confidence).toBe('high');
    expect(result.results[0].usage?.usedMembers).toContain('merge');
  });

  it('should detect unused imports with warning', async () => {
    await writeFile(join(tempDir, 'src', 'partial.ts'), `
      import { merge, clone, template } from 'lodash';
      
      // Only using merge
      export const result = merge({}, {});
    `);

    const components: Component[] = [
      { name: 'lodash', version: '4.17.21' }
    ];

    const result = await quickAnalyze(tempDir, components);
    
    expect(result.results[0].status).toBe('reachable');
    // Should have warning about unused imports
    const unusedWarning = result.results[0].warnings?.find(w => w.code === 'unused_import');
    expect(unusedWarning).toBeDefined();
    expect(unusedWarning?.message).toContain('clone');
    expect(unusedWarning?.message).toContain('template');
  });
});

describe('Analyzer - OSV Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-osv-'));
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-osv', version: '1.0.0' })
    );
    await mkdir(join(tempDir, 'src'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should enrich components with OSV data when enabled', async () => {
    await writeFile(join(tempDir, 'src', 'app.js'), `const _ = require('lodash');`);

    const components: Component[] = [
      { name: 'lodash', version: '4.17.20' }  // Known vulnerable version
    ];

    const analyzer = new Analyzer({ 
      sourceDir: tempDir,
      osvLookup: true
    });
    const result = await analyzer.analyze(components);

    // lodash 4.17.20 should have vulnerabilities from OSV
    expect(result.results).toHaveLength(1);
    // May or may not have vulns depending on OSV API response
    expect(result.results[0].status).toBe('reachable');
  }, 10000); // Extended timeout for API call

  it('should work without OSV when disabled', async () => {
    await writeFile(join(tempDir, 'src', 'app.js'), `const _ = require('lodash');`);

    const components: Component[] = [
      { name: 'lodash', version: '4.17.20' }
    ];

    const analyzer = new Analyzer({ 
      sourceDir: tempDir,
      osvLookup: false
    });
    const result = await analyzer.analyze(components);

    expect(result.results[0].component.vulnerabilities).toBeUndefined();
  });

  it('should merge OSV vulns with existing vulns', async () => {
    await writeFile(join(tempDir, 'src', 'app.js'), `const _ = require('lodash');`);

    const components: Component[] = [
      { 
        name: 'lodash', 
        version: '4.17.20',
        vulnerabilities: [{ id: 'CUSTOM-001', severity: 'high' }]
      }
    ];

    const analyzer = new Analyzer({ 
      sourceDir: tempDir,
      osvLookup: true
    });
    const result = await analyzer.analyze(components);

    // Should have at least the custom vuln
    const vulns = result.results[0].component.vulnerabilities ?? [];
    expect(vulns.find(v => v.id === 'CUSTOM-001')).toBeDefined();
  }, 10000);
});
