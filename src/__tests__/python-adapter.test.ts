/**
 * Python Adapter Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PythonAdapter } from '../languages/python/index.js';

describe('Python precision tests', () => {
  it('should detect conditional imports', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-py-cond-'));
    
    await writeFile(join(tmpDir, 'requirements.txt'), 'requests==2.28.0');
    await writeFile(join(tmpDir, 'main.py'), `
try:
    import requests
except ImportError:
    requests = None

if requests:
    requests.get('https://example.com')
`);
    
    const adapter = new PythonAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'requests',
      version: '2.28.0',
      type: 'pypi'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const reqResult = result.find(r => r.component.name === 'requests');
    expect(reqResult?.warnings?.some(w => 
      w.message.includes('Conditional')
    )).toBe(true);
  });

  it('should detect star imports', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-py-star-'));
    
    await writeFile(join(tmpDir, 'requirements.txt'), 'numpy==1.24.0');
    await writeFile(join(tmpDir, 'main.py'), `
from numpy import *

result = array([1, 2, 3])
`);
    
    const adapter = new PythonAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'numpy',
      version: '1.24.0',
      type: 'pypi'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const npResult = result.find(r => r.component.name === 'numpy');
    expect(npResult?.warnings?.some(w => w.code === 'star_import')).toBe(true);
  });

  it('should track module attribute access', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-py-attr-'));
    
    await writeFile(join(tmpDir, 'requirements.txt'), 'requests==2.28.0');
    await writeFile(join(tmpDir, 'main.py'), `
import requests

response = requests.get('https://example.com')
data = requests.post('https://api.example.com', json={})
`);
    
    const adapter = new PythonAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'requests',
      version: '2.28.0',
      type: 'pypi'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const reqResult = result.find(r => r.component.name === 'requests');
    expect(reqResult?.usage?.usedMembers).toContain('get');
    expect(reqResult?.usage?.usedMembers).toContain('post');
  });

  it('should handle aliased imports', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-py-alias-'));
    
    await writeFile(join(tmpDir, 'requirements.txt'), 'numpy==1.24.0\npandas==2.0.0');
    await writeFile(join(tmpDir, 'main.py'), `
import numpy as np
import pandas as pd

arr = np.array([1, 2, 3])
df = pd.DataFrame({'a': [1, 2, 3]})
`);
    
    const adapter = new PythonAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'numpy',
      version: '1.24.0',
      type: 'pypi'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const npResult = result.find(r => r.component.name === 'numpy');
    expect(npResult?.status).not.toBe('not_reachable');
    expect(npResult?.usage?.usedMembers).toContain('array');
  });
});
