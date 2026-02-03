/**
 * ReachVet - JavaScript/TypeScript Adapter Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JavaScriptAdapter } from '../languages/javascript/index.js';
import type { Component } from '../types.js';

describe('JavaScriptAdapter', () => {
  const adapter = new JavaScriptAdapter();
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-js-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('canHandle', () => {
    it('should detect package.json', async () => {
      await writeFile(join(tmpDir, 'package.json'), '{}');
      expect(await adapter.canHandle(tmpDir)).toBe(true);
    });

    it('should return false without package.json', async () => {
      expect(await adapter.canHandle(tmpDir)).toBe(false);
    });
  });

  describe('analyze - ESM imports', () => {
    beforeEach(async () => {
      await writeFile(join(tmpDir, 'package.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
    });

    it('should detect named imports', async () => {
      await writeFile(join(tmpDir, 'src', 'app.js'), `
        import { merge, clone } from 'lodash';
        const result = merge({}, {});
      `);

      const components: Component[] = [{ name: 'lodash', version: '4.17.21' }];
      const results = await adapter.analyze(tmpDir, components);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].usage?.usedMembers).toContain('merge');
    });

    it('should detect default imports', async () => {
      await writeFile(join(tmpDir, 'src', 'app.js'), `
        import _ from 'lodash';
        _.merge({}, {});
      `);

      const components: Component[] = [{ name: 'lodash', version: '4.17.21' }];
      const results = await adapter.analyze(tmpDir, components);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should detect namespace imports', async () => {
      await writeFile(join(tmpDir, 'src', 'app.js'), `
        import * as _ from 'lodash';
        _.template('<%= name %>');
      `);

      const components: Component[] = [{ name: 'lodash', version: '4.17.21' }];
      const results = await adapter.analyze(tmpDir, components);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].usage?.usedMembers).toContain('template');
    });
  });

  describe('analyze - CommonJS', () => {
    beforeEach(async () => {
      await writeFile(join(tmpDir, 'package.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
    });

    it('should detect require', async () => {
      await writeFile(join(tmpDir, 'src', 'app.js'), `
        const lodash = require('lodash');
      `);

      const components: Component[] = [{ name: 'lodash', version: '4.17.21' }];
      const results = await adapter.analyze(tmpDir, components);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should detect destructured require', async () => {
      await writeFile(join(tmpDir, 'src', 'app.js'), `
        const { merge, clone } = require('lodash');
        merge({}, {});
      `);

      const components: Component[] = [{ name: 'lodash', version: '4.17.21' }];
      const results = await adapter.analyze(tmpDir, components);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].usage?.usedMembers).toContain('merge');
    });
  });

  describe('analyze - TypeScript', () => {
    beforeEach(async () => {
      await writeFile(join(tmpDir, 'package.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
    });

    it('should detect type-only imports as not reachable', async () => {
      await writeFile(join(tmpDir, 'src', 'app.ts'), `
        import type { User } from 'user-types';
        const user: User = { name: 'test' };
      `);

      const components: Component[] = [{ name: 'user-types', version: '1.0.0' }];
      const results = await adapter.analyze(tmpDir, components);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_reachable');
    });
  });

  describe('analyze - not found', () => {
    beforeEach(async () => {
      await writeFile(join(tmpDir, 'package.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
    });

    it('should return not_reachable for unused components', async () => {
      await writeFile(join(tmpDir, 'src', 'app.js'), `
        import { merge } from 'lodash';
      `);

      const components: Component[] = [
        { name: 'lodash', version: '4.17.21' },
        { name: 'express', version: '4.18.0' }
      ];
      const results = await adapter.analyze(tmpDir, components);

      expect(results).toHaveLength(2);
      expect(results.find(r => r.component.name === 'lodash')?.status).toBe('reachable');
      expect(results.find(r => r.component.name === 'express')?.status).toBe('not_reachable');
    });
  });

  describe('analyze - vulnerable functions', () => {
    beforeEach(async () => {
      await writeFile(join(tmpDir, 'package.json'), '{}');
      await mkdir(join(tmpDir, 'src'), { recursive: true });
    });

    it('should detect vulnerable function usage', async () => {
      await writeFile(join(tmpDir, 'src', 'app.js'), `
        import { template } from 'lodash';
        const render = template('<%= name %>');
      `);

      const components: Component[] = [{
        name: 'lodash',
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          severity: 'high',
          affectedFunctions: ['template']
        }]
      }];
      const results = await adapter.analyze(tmpDir, components);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].confidence).toBe('high');
    });

    it('should return imported for non-vulnerable function usage', async () => {
      await writeFile(join(tmpDir, 'src', 'app.js'), `
        import { merge } from 'lodash';
        merge({}, {});
      `);

      const components: Component[] = [{
        name: 'lodash',
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          affectedFunctions: ['template']  // Not using template
        }]
      }];
      const results = await adapter.analyze(tmpDir, components);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('imported');
    });
  });
});
