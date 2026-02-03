/**
 * SARIF Output Tests
 */

import { describe, it, expect } from 'vitest';
import { toSarif } from '../output/sarif.js';
import type { AnalysisOutput, ComponentResult } from '../types.js';

describe('SARIF Output', () => {
  const createOutput = (results: ComponentResult[]): AnalysisOutput => ({
    version: '0.2.0',
    timestamp: '2026-02-04T05:00:00.000Z',
    sourceDir: '/test/project',
    language: 'javascript',
    summary: {
      total: results.length,
      reachable: results.filter(r => r.status === 'reachable').length,
      imported: results.filter(r => r.status === 'imported').length,
      notReachable: results.filter(r => r.status === 'not_reachable').length,
      indirect: 0,
      unknown: results.filter(r => r.status === 'unknown').length,
      vulnerableReachable: results.filter(r => 
        r.status === 'reachable' && r.component.vulnerabilities?.length
      ).length,
      warningsCount: results.reduce((acc, r) => acc + (r.warnings?.length || 0), 0),
    },
    results,
  });

  it('should generate valid SARIF structure', () => {
    const output = createOutput([]);
    const sarif = toSarif(output);

    expect(sarif.$schema).toBe('https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json');
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('ReachVet');
    expect(sarif.runs[0].tool.driver.rules).toBeDefined();
    expect(sarif.runs[0].invocations).toHaveLength(1);
  });

  it('should include predefined rules', () => {
    const output = createOutput([]);
    const sarif = toSarif(output);
    const rules = sarif.runs[0].tool.driver.rules;

    // Check key rules exist
    const ruleIds = rules.map(r => r.id);
    expect(ruleIds).toContain('RV001'); // VulnerableReachable
    expect(ruleIds).toContain('RV002'); // DependencyReachable
    expect(ruleIds).toContain('RV003'); // DependencyImported
  });

  it('should convert reachable vulnerable component to error result', () => {
    const output = createOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [
            { id: 'CVE-2021-23337', severity: 'high', affectedFunctions: ['template'] },
          ],
        },
        status: 'reachable',
        confidence: 'high',
        usage: {
          importStyle: 'esm',
          usedMembers: ['template'],
          locations: [
            { file: 'src/app.js', line: 5, column: 1 },
          ],
        },
      },
    ]);

    const sarif = toSarif(output);
    const results = sarif.runs[0].results;

    expect(results.length).toBeGreaterThan(0);
    const vulnResult = results.find(r => r.ruleId === 'RV001');
    expect(vulnResult).toBeDefined();
    expect(vulnResult!.level).toBe('error');
    expect(vulnResult!.message.text).toContain('lodash@4.17.20');
    expect(vulnResult!.message.text).toContain('CVE-2021-23337');
    expect(vulnResult!.locations).toHaveLength(1);
    expect(vulnResult!.locations![0].physicalLocation?.region?.startLine).toBe(5);
  });

  it('should convert reachable non-vulnerable component to note', () => {
    const output = createOutput([
      {
        component: { name: 'express', version: '4.18.0' },
        status: 'reachable',
        confidence: 'high',
        usage: {
          importStyle: 'commonjs',
          usedMembers: ['Router', 'static'],
          locations: [{ file: 'src/server.js', line: 10 }],
        },
      },
    ]);

    const sarif = toSarif(output);
    const result = sarif.runs[0].results.find(r => r.ruleId === 'RV002');

    expect(result).toBeDefined();
    expect(result!.level).toBe('note');
    expect(result!.message.text).toContain('express@4.18.0');
    expect(result!.message.text).toContain('Router, static');
  });

  it('should convert imported component to note', () => {
    const output = createOutput([
      {
        component: { name: 'axios', version: '1.6.0' },
        status: 'imported',
        confidence: 'medium',
        usage: {
          importStyle: 'esm',
          locations: [{ file: 'src/api.js', line: 1 }],
        },
      },
    ]);

    const sarif = toSarif(output);
    const result = sarif.runs[0].results.find(r => r.ruleId === 'RV003');

    expect(result).toBeDefined();
    expect(result!.level).toBe('note');
    expect(result!.message.text).toContain('imported but specific usage is unclear');
  });

  it('should not include not_reachable without vulnerabilities', () => {
    const output = createOutput([
      {
        component: { name: 'unused-pkg', version: '1.0.0' },
        status: 'not_reachable',
        confidence: 'high',
      },
    ]);

    const sarif = toSarif(output);
    expect(sarif.runs[0].results).toHaveLength(0);
  });

  it('should convert dynamic import warning to warning result', () => {
    const output = createOutput([
      {
        component: { name: 'dynamic-pkg', version: '1.0.0' },
        status: 'imported',
        confidence: 'low',
        warnings: [
          {
            code: 'dynamic_import',
            message: 'Dynamic import detected - static analysis may be incomplete',
            severity: 'warning',
            location: { file: 'src/loader.js', line: 15 },
          },
        ],
        usage: {
          importStyle: 'dynamic',
          locations: [{ file: 'src/loader.js', line: 15 }],
        },
      },
    ]);

    const sarif = toSarif(output);
    const warningResult = sarif.runs[0].results.find(r => r.ruleId === 'RV101');

    expect(warningResult).toBeDefined();
    expect(warningResult!.level).toBe('warning');
    expect(warningResult!.locations).toHaveLength(1);
  });

  it('should include fingerprints for deduplication', () => {
    const output = createOutput([
      {
        component: { name: 'test-pkg', version: '2.0.0' },
        status: 'reachable',
        confidence: 'high',
        usage: {
          importStyle: 'esm',
          locations: [{ file: 'src/test.js', line: 1 }],
        },
      },
    ]);

    const sarif = toSarif(output);
    const result = sarif.runs[0].results[0];

    expect(result.fingerprints).toBeDefined();
    expect(result.fingerprints!['reachvet/component']).toBe('test-pkg@2.0.0');
  });

  it('should handle components with multiple vulnerabilities', () => {
    const output = createOutput([
      {
        component: {
          name: 'multi-vuln',
          version: '1.0.0',
          vulnerabilities: [
            { id: 'CVE-2021-1111', severity: 'critical' },
            { id: 'CVE-2021-2222', severity: 'high' },
            { id: 'GHSA-xxxx', severity: 'medium' },
          ],
        },
        status: 'reachable',
        confidence: 'high',
        usage: {
          importStyle: 'esm',
          locations: [{ file: 'src/app.js', line: 1 }],
        },
      },
    ]);

    const sarif = toSarif(output);
    const result = sarif.runs[0].results.find(r => r.ruleId === 'RV001');

    expect(result!.message.text).toContain('CVE-2021-1111');
    expect(result!.message.text).toContain('CVE-2021-2222');
    expect(result!.message.text).toContain('GHSA-xxxx');
  });

  it('should include properties with vulnerability details', () => {
    const vulns = [
      { id: 'CVE-2021-3333', severity: 'high' as const, affectedFunctions: ['foo', 'bar'] },
    ];
    const output = createOutput([
      {
        component: {
          name: 'vuln-pkg',
          version: '1.0.0',
          vulnerabilities: vulns,
        },
        status: 'reachable',
        confidence: 'high',
        usage: {
          importStyle: 'esm',
          locations: [{ file: 'src/x.js', line: 1 }],
        },
      },
    ]);

    const sarif = toSarif(output);
    const result = sarif.runs[0].results.find(r => r.ruleId === 'RV001');

    expect(result!.properties).toBeDefined();
    expect(result!.properties!.vulnerabilities).toEqual(vulns);
    expect(result!.properties!.component).toBe('vuln-pkg');
    expect(result!.properties!.status).toBe('reachable');
  });

  it('should set correct invocation info', () => {
    const output = createOutput([]);
    const sarif = toSarif(output);
    const invocation = sarif.runs[0].invocations[0];

    expect(invocation.executionSuccessful).toBe(true);
    expect(invocation.startTimeUtc).toBe(output.timestamp);
    expect(invocation.workingDirectory?.uri).toContain('/test/project');
  });
});
