/**
 * ReachVet Analyzer Tests - Warning System & Integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { quickAnalyze } from '../core/analyzer.js';
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
