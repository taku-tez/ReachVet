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
