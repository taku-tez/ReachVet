/**
 * JavaScript Adapter Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JavaScriptAdapter } from '../languages/javascript/index.js';

describe('dynamic code warnings integration', () => {
  it('should include eval warning in analysis result', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-eval-'));
    
    await writeFile(join(tmpDir, 'index.js'), `
      const lodash = require('lodash');
      eval('lodash.merge({}, {})');
    `);
    
    const adapter = new JavaScriptAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'lodash',
      version: '4.17.21',
      type: 'npm'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const lodashResult = result.find(r => r.component.name === 'lodash');
    expect(lodashResult?.warnings?.some(w => w.code === 'dynamic_code')).toBe(true);
  });

  it('should warn about new Function usage', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-func-'));
    
    await writeFile(join(tmpDir, 'index.js'), `
      import { template } from 'lodash';
      const fn = new Function('return template');
    `);
    
    const adapter = new JavaScriptAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'lodash',
      version: '4.17.21',
      type: 'npm'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const lodashResult = result.find(r => r.component.name === 'lodash');
    expect(lodashResult?.warnings?.some(w => 
      w.code === 'dynamic_code' && w.message.includes('Function')
    )).toBe(true);
  });

  it('should detect called vs referenced functions', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-callgraph-'));
    
    await writeFile(join(tmpDir, 'index.js'), `
      import { merge, clone, template } from 'lodash';
      
      // merge is called
      merge({}, {});
      
      // clone is passed as callback (referenced)
      const fn = clone;
      
      // template is unused
    `);
    
    const adapter = new JavaScriptAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'lodash',
      version: '4.17.21',
      type: 'npm',
      vulnerabilities: [{
        id: 'CVE-2021-23337',
        affectedFunctions: ['template']
      }]
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const lodashResult = result.find(r => r.component.name === 'lodash');
    // template is imported but not called, so status should reflect that
    expect(lodashResult).toBeDefined();
    // Should have unused import warning
    expect(lodashResult?.warnings?.some(w => 
      w.code === 'unused_import' && w.message.includes('template')
    )).toBe(true);
  });
});

describe('false positive reduction', () => {
  it('should mark type-only imports as not_reachable', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-typeonly-'));
    
    await writeFile(join(tmpDir, 'index.ts'), `
      import type { Request, Response } from 'express';
      
      function handler(req: Request, res: Response) {
        // Only using types, not runtime code
      }
    `);
    
    const adapter = new JavaScriptAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'express',
      version: '4.18.2',
      type: 'npm'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const expressResult = result.find(r => r.component.name === 'express');
    // Type-only imports should be not_reachable
    expect(expressResult?.status).toBe('not_reachable');
  });

  it('should detect imported but never called functions', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-unused-'));
    
    await writeFile(join(tmpDir, 'index.js'), `
      import { merge, template, clone } from 'lodash';
      
      // Only merge is actually called
      const result = merge({}, {});
    `);
    
    const adapter = new JavaScriptAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'lodash',
      version: '4.17.21',
      type: 'npm'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const lodashResult = result.find(r => r.component.name === 'lodash');
    // Should warn about unused imports
    expect(lodashResult?.warnings?.some(w => 
      w.code === 'unused_import' && 
      (w.message.includes('template') || w.message.includes('clone'))
    )).toBe(true);
  });

  it('should not false positive on conditional imports', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-conditional-'));
    
    await writeFile(join(tmpDir, 'index.js'), `
      let fs;
      try {
        fs = require('fs');
      } catch (e) {
        fs = null;
      }
      
      if (fs) {
        fs.readFileSync('./data.json');
      }
    `);
    
    const adapter = new JavaScriptAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'fs',
      version: '0.0.1-security',
      type: 'npm'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const fsResult = result.find(r => r.component.name === 'fs');
    // Should have conditional import warning
    expect(fsResult?.warnings?.some(w => 
      w.code === 'indirect_usage' && w.message.includes('Conditional')
    )).toBe(true);
  });
});

describe('complex import patterns', () => {
  it('should handle re-exports from barrel files', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-barrel-'));
    
    // Create barrel file structure
    await mkdir(join(tmpDir, 'lib'), { recursive: true });
    await writeFile(join(tmpDir, 'lib/index.js'), `
      export { default as axios } from 'axios';
      export { get, post } from 'axios';
    `);
    await writeFile(join(tmpDir, 'main.js'), `
      import { get } from './lib';
      get('/api');
    `);
    
    const adapter = new JavaScriptAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'axios',
      version: '1.6.0',
      type: 'npm'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const axiosResult = result.find(r => r.component.name === 'axios');
    expect(axiosResult?.status).not.toBe('not_reachable');
  });

  it('should handle aliased imports', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-alias-'));
    
    await writeFile(join(tmpDir, 'index.js'), `
      import { merge as _merge } from 'lodash';
      const result = _merge({}, {});
    `);
    
    const adapter = new JavaScriptAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'lodash',
      version: '4.17.21',
      type: 'npm',
      vulnerabilities: [{
        id: 'CVE-2021-23337',
        affectedFunctions: ['merge']
      }]
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const lodashResult = result.find(r => r.component.name === 'lodash');
    // merge is used (via alias), so should be reachable
    expect(lodashResult?.status).toBe('reachable');
    expect(lodashResult?.confidence).toBe('high');
  });

  it('should handle namespace imports with used member', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-ns-'));
    
    await writeFile(join(tmpDir, 'index.js'), `
      import * as _ from 'lodash';
      _.merge({}, {});
      _.template('<%= name %>');
    `);
    
    const adapter = new JavaScriptAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'lodash',
      version: '4.17.21',
      type: 'npm'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const lodashResult = result.find(r => r.component.name === 'lodash');
    expect(lodashResult?.usage?.usedMembers).toContain('merge');
    expect(lodashResult?.usage?.usedMembers).toContain('template');
  });
});
