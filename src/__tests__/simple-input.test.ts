/**
 * Simple JSON Input Tests
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSimpleJson, parseSimpleJsonString } from '../input/simple.js';

describe('parseSimpleJson', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-simple-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should parse basic component list', async () => {
    const json = [
      { name: 'lodash', version: '4.17.21' },
      { name: 'express', version: '4.18.0' }
    ];
    await writeFile(join(tmpDir, 'deps.json'), JSON.stringify(json));

    const result = await parseSimpleJson(join(tmpDir, 'deps.json'));
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('lodash');
    expect(result[0].version).toBe('4.17.21');
  });

  it('should handle ecosystem field', async () => {
    const json = [
      { name: 'requests', version: '2.28.0', ecosystem: 'pypi' }
    ];
    await writeFile(join(tmpDir, 'deps.json'), JSON.stringify(json));

    const result = await parseSimpleJson(join(tmpDir, 'deps.json'));
    expect(result[0].ecosystem).toBe('pypi');
    expect(result[0].purl).toBe('pkg:pypi/requests@2.28.0');
  });

  it('should handle vulnerabilities', async () => {
    const json = [{
      name: 'lodash',
      version: '4.17.20',
      vulnerabilities: [{
        id: 'CVE-2021-23337',
        severity: 'high',
        affectedFunctions: ['template']
      }]
    }];
    await writeFile(join(tmpDir, 'deps.json'), JSON.stringify(json));

    const result = await parseSimpleJson(join(tmpDir, 'deps.json'));
    expect(result[0].vulnerabilities).toHaveLength(1);
    expect(result[0].vulnerabilities![0].id).toBe('CVE-2021-23337');
    expect(result[0].vulnerabilities![0].affectedFunctions).toContain('template');
  });

  it('should throw on invalid JSON', async () => {
    await writeFile(join(tmpDir, 'invalid.json'), 'not json');
    await expect(parseSimpleJson(join(tmpDir, 'invalid.json'))).rejects.toThrow();
  });

  it('should throw on missing name', async () => {
    const json = [{ version: '1.0.0' }];
    await writeFile(join(tmpDir, 'deps.json'), JSON.stringify(json));
    await expect(parseSimpleJson(join(tmpDir, 'deps.json'))).rejects.toThrow("missing 'name'");
  });

  it('should throw on missing version', async () => {
    const json = [{ name: 'foo' }];
    await writeFile(join(tmpDir, 'deps.json'), JSON.stringify(json));
    await expect(parseSimpleJson(join(tmpDir, 'deps.json'))).rejects.toThrow("missing 'version'");
  });
});

describe('parseSimpleJsonString', () => {
  it('should parse JSON string', () => {
    const json = JSON.stringify([
      { name: 'axios', version: '1.6.0' }
    ]);

    const result = parseSimpleJsonString(json);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('axios');
  });

  it('should handle unknown ecosystem', () => {
    const json = JSON.stringify([
      { name: 'custom-pkg', version: '1.0.0', ecosystem: 'unknown' }
    ]);

    const result = parseSimpleJsonString(json);
    expect(result[0].ecosystem).toBe('unknown');
    expect(result[0].purl).toBeUndefined();
  });

  it('should generate correct purls for various ecosystems', () => {
    const ecosystems = [
      { ecosystem: 'npm', expected: 'pkg:npm/foo@1.0.0' },
      { ecosystem: 'pypi', expected: 'pkg:pypi/foo@1.0.0' },
      { ecosystem: 'cargo', expected: 'pkg:cargo/foo@1.0.0' },
      { ecosystem: 'go', expected: 'pkg:go/foo@1.0.0' },
      { ecosystem: 'maven', expected: 'pkg:maven/foo@1.0.0' },
    ];

    for (const { ecosystem, expected } of ecosystems) {
      const json = JSON.stringify([{ name: 'foo', version: '1.0.0', ecosystem }]);
      const result = parseSimpleJsonString(json);
      expect(result[0].purl).toBe(expected);
    }
  });
});

import { beforeEach, afterEach } from 'vitest';
