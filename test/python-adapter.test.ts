/**
 * ReachVet - Python Adapter Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pythonAdapter } from '../src/languages/python/index.js';
import type { Component } from '../src/types.js';

describe('PythonAdapter Integration', () => {
  let testDir: string;

  beforeAll(async () => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `reachvet-python-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    
    // Create a requirements.txt
    await writeFile(join(testDir, 'requirements.txt'), `
requests==2.28.0
pyyaml==6.0
pillow==9.0.0
flask==2.0.0
`.trim());

    // Create sample Python files
    await writeFile(join(testDir, 'app.py'), `
import os
import json
from flask import Flask, request, jsonify
import requests
import yaml

app = Flask(__name__)

@app.route('/fetch')
def fetch():
    url = request.args.get('url')
    resp = requests.get(url)
    return jsonify(resp.json())

@app.route('/config')
def config():
    with open('config.yaml') as f:
        return yaml.safe_load(f)
`);

    await writeFile(join(testDir, 'utils.py'), `
from PIL import Image
from PIL.ImageFilter import BLUR, SHARPEN

def process_image(path):
    img = Image.open(path)
    img = img.filter(BLUR)
    return img
`);

    await writeFile(join(testDir, 'unused_imports.py'), `
# This file imports but doesn't use
import django
from sqlalchemy import create_engine
`);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should detect Python project', async () => {
    const canHandle = await pythonAdapter.canHandle(testDir);
    expect(canHandle).toBe(true);
  });

  it('should find requests as reachable', async () => {
    const components: Component[] = [
      { name: 'requests', version: '2.28.0', purl: 'pkg:pypi/requests@2.28.0' }
    ];
    
    const results = await pythonAdapter.analyze(testDir, components);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('reachable');
    expect(results[0].usage?.usedMembers).toContain('get');
  });

  it('should find flask as reachable with specific members', async () => {
    const components: Component[] = [
      { name: 'flask', version: '2.0.0' }
    ];
    
    const results = await pythonAdapter.analyze(testDir, components);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('reachable');
    expect(results[0].usage?.usedMembers).toContain('Flask');
    expect(results[0].usage?.usedMembers).toContain('request');
    expect(results[0].usage?.usedMembers).toContain('jsonify');
  });

  it('should handle PyYAML -> yaml alias', async () => {
    const components: Component[] = [
      { name: 'PyYAML', version: '6.0', purl: 'pkg:pypi/pyyaml@6.0' }
    ];
    
    const results = await pythonAdapter.analyze(testDir, components);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('reachable');
    // yaml.safe_load is used
    expect(results[0].usage?.usedMembers).toContain('safe_load');
  });

  it('should handle Pillow -> PIL alias', async () => {
    const components: Component[] = [
      { name: 'Pillow', version: '9.0.0' }
    ];
    
    const results = await pythonAdapter.analyze(testDir, components);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('reachable');
    expect(results[0].usage?.usedMembers).toContain('Image');
  });

  it('should report not reachable for unused packages', async () => {
    const components: Component[] = [
      { name: 'numpy', version: '1.21.0' }
    ];
    
    const results = await pythonAdapter.analyze(testDir, components);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('not_reachable');
  });

  it('should identify vulnerable function usage', async () => {
    const components: Component[] = [
      { 
        name: 'PyYAML', 
        version: '5.3.1',
        vulnerabilities: [{
          id: 'CVE-2020-14343',
          severity: 'critical',
          affectedFunctions: ['load', 'unsafe_load'],
          description: 'Arbitrary code execution via yaml.load'
        }]
      }
    ];
    
    const results = await pythonAdapter.analyze(testDir, components);
    expect(results).toHaveLength(1);
    // safe_load is used, not the vulnerable load/unsafe_load
    // So it should be imported but not explicitly using vulnerable functions
    expect(results[0].status).toBe('imported');
  });

  it('should detect django import (unused import file)', async () => {
    const components: Component[] = [
      { name: 'django', version: '4.0.0' }
    ];
    
    const results = await pythonAdapter.analyze(testDir, components);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('reachable');
    expect(results[0].confidence).toBe('high'); // Import detected = high confidence
  });
});
