/**
 * JavaScript Adapter Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
