/**
 * ReachVet Input Parser Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSimpleJsonString, parseSimpleJson } from '../input/simple.js';

describe('parseSimpleJsonString', () => {
  it('parses basic component list', () => {
    const input = JSON.stringify([
      { name: 'lodash', version: '4.17.21' },
      { name: 'express', version: '4.18.0' }
    ]);
    
    const components = parseSimpleJsonString(input);
    
    expect(components).toHaveLength(2);
    expect(components[0].name).toBe('lodash');
    expect(components[0].version).toBe('4.17.21');
    expect(components[0].ecosystem).toBe('npm');
    expect(components[0].purl).toBe('pkg:npm/lodash@4.17.21');
  });

  it('parses components with vulnerabilities', () => {
    const input = JSON.stringify([
      {
        name: 'lodash',
        version: '4.17.20',
        vulnerabilities: [
          {
            id: 'CVE-2021-23337',
            severity: 'high',
            affectedFunctions: ['template'],
            fixedVersion: '4.17.21',
            description: 'Prototype pollution'
          }
        ]
      }
    ]);
    
    const components = parseSimpleJsonString(input);
    
    expect(components).toHaveLength(1);
    expect(components[0].vulnerabilities).toHaveLength(1);
    expect(components[0].vulnerabilities![0].id).toBe('CVE-2021-23337');
    expect(components[0].vulnerabilities![0].severity).toBe('high');
    expect(components[0].vulnerabilities![0].affectedFunctions).toContain('template');
  });

  it('handles missing severity', () => {
    const input = JSON.stringify([
      {
        name: 'test',
        version: '1.0.0',
        vulnerabilities: [{ id: 'CVE-2024-1234' }]
      }
    ]);
    
    const components = parseSimpleJsonString(input);
    
    expect(components[0].vulnerabilities![0].severity).toBe('unknown');
  });

  it('throws on non-array input', () => {
    const input = JSON.stringify({ name: 'lodash', version: '1.0.0' });
    
    expect(() => parseSimpleJsonString(input)).toThrow('Input must be an array');
  });

  it('throws on missing name', () => {
    const input = JSON.stringify([{ version: '1.0.0' }]);
    
    expect(() => parseSimpleJsonString(input)).toThrow("missing 'name'");
  });

  it('throws on missing version', () => {
    const input = JSON.stringify([{ name: 'test' }]);
    
    expect(() => parseSimpleJsonString(input)).toThrow("missing 'version'");
  });

  it('handles custom ecosystem', () => {
    const input = JSON.stringify([
      { name: 'requests', version: '2.28.0', ecosystem: 'pypi' }
    ]);
    
    const components = parseSimpleJsonString(input);
    
    expect(components[0].ecosystem).toBe('pypi');
  });

  it('handles empty array', () => {
    const components = parseSimpleJsonString('[]');
    
    expect(components).toHaveLength(0);
  });

  it('handles scoped packages', () => {
    const input = JSON.stringify([
      { name: '@babel/core', version: '7.20.0' }
    ]);
    
    const components = parseSimpleJsonString(input);
    
    expect(components[0].name).toBe('@babel/core');
    expect(components[0].purl).toBe('pkg:npm/@babel/core@7.20.0');
  });
});

describe('parseSimpleJson (file)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-input-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads and parses JSON file', async () => {
    const filePath = join(tmpDir, 'components.json');
    await writeFile(filePath, JSON.stringify([
      { name: 'lodash', version: '4.17.21' },
      { name: 'express', version: '4.18.0' }
    ]));

    const components = await parseSimpleJson(filePath);

    expect(components).toHaveLength(2);
    expect(components[0].name).toBe('lodash');
    expect(components[1].name).toBe('express');
  });

  it('reads file with vulnerabilities', async () => {
    const filePath = join(tmpDir, 'vulns.json');
    await writeFile(filePath, JSON.stringify([
      {
        name: 'lodash',
        version: '4.17.20',
        vulnerabilities: [{ id: 'CVE-2021-23337', severity: 'high' }]
      }
    ]));

    const components = await parseSimpleJson(filePath);

    expect(components[0].vulnerabilities).toHaveLength(1);
    expect(components[0].vulnerabilities![0].id).toBe('CVE-2021-23337');
  });

  it('throws on file not found', async () => {
    await expect(parseSimpleJson('/nonexistent/path.json'))
      .rejects.toThrow();
  });

  it('throws on invalid JSON', async () => {
    const filePath = join(tmpDir, 'invalid.json');
    await writeFile(filePath, 'not valid json');

    await expect(parseSimpleJson(filePath)).rejects.toThrow();
  });
});
