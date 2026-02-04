import { describe, it, expect } from 'vitest';
import { toJUnitXml, toJUnitXmlMultiple, JUnitOptions } from '../output/junit.js';
import type { AnalysisOutput, ComponentResult, AnalysisWarning } from '../types.js';

// Helper to create mock analysis output
function createMockOutput(overrides: Partial<AnalysisOutput> = {}): AnalysisOutput {
  return {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    sourceDir: '/test',
    language: 'javascript',
    summary: {
      total: 0,
      reachable: 0,
      imported: 0,
      notReachable: 0,
      indirect: 0,
      unknown: 0,
      vulnerableReachable: 0,
      warningsCount: 0,
    },
    results: [],
    metadata: {
      analysisDurationMs: 100,
    },
    ...overrides,
  };
}

// Helper to create mock component result
function createMockResult(overrides: Partial<ComponentResult> = {}): ComponentResult {
  return {
    component: {
      name: 'test-package',
      version: '1.0.0',
      ecosystem: 'npm',
    },
    status: 'not_reachable',
    confidence: 'high',
    ...overrides,
  };
}

describe('JUnit XML Output', () => {
  describe('toJUnitXml', () => {
    it('should generate valid XML header', () => {
      const output = createMockOutput();
      const xml = toJUnitXml(output);
      
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<testsuites');
      expect(xml).toContain('</testsuites>');
    });

    it('should include testsuite element with correct attributes', () => {
      const output = createMockOutput({
        summary: {
          total: 5,
          reachable: 2,
          imported: 1,
          notReachable: 2,
          indirect: 0,
          unknown: 0,
          vulnerableReachable: 1,
          warningsCount: 0,
        },
        metadata: { analysisDurationMs: 500 },
      });
      
      const xml = toJUnitXml(output);
      
      expect(xml).toContain('<testsuite name="ReachVet Analysis"');
      expect(xml).toContain('timestamp=');
    });

    it('should create testcase for reachable dependency', () => {
      const result = createMockResult({
        component: {
          name: 'lodash',
          version: '4.17.20',
          ecosystem: 'npm',
        },
        status: 'reachable',
      });
      
      const output = createMockOutput({ results: [result] });
      const xml = toJUnitXml(output, { includeAll: true });
      
      expect(xml).toContain('<testcase name="lodash@4.17.20"');
      expect(xml).toContain('classname="reachvet.dependencies.npm"');
    });

    it('should mark vulnerable reachable as failure', () => {
      const result = createMockResult({
        component: {
          name: 'vulnerable-pkg',
          version: '1.0.0',
          ecosystem: 'npm',
          vulnerabilities: [{
            id: 'CVE-2024-1234',
            severity: 'high',
            affectedFunctions: ['dangerousFunc'],
          }],
        },
        status: 'reachable',
        usage: {
          importStyle: 'esm',
          usedMembers: ['dangerousFunc'],
          locations: [],
        },
      });
      
      const output = createMockOutput({ results: [result] });
      const xml = toJUnitXml(output);
      
      expect(xml).toContain('<failure type="VulnerableReachable"');
      expect(xml).toContain('message="1 vulnerability(ies) in reachable dependency"');
      expect(xml).toContain('CVE-2024-1234');
    });

    it('should mark vulnerable non-reachable as skipped', () => {
      const result = createMockResult({
        component: {
          name: 'vulnerable-pkg',
          version: '1.0.0',
          ecosystem: 'npm',
          vulnerabilities: [{
            id: 'CVE-2024-1234',
            severity: 'high',
          }],
        },
        status: 'not_reachable',
      });
      
      const output = createMockOutput({ results: [result] });
      const xml = toJUnitXml(output);
      
      expect(xml).toContain('<skipped message="1 vulnerability(ies) found but not reachable');
    });

    it('should respect includeAll option', () => {
      const results = [
        createMockResult({
          component: { name: 'clean-dep', version: '1.0.0', ecosystem: 'npm' },
          status: 'not_reachable',
        }),
        createMockResult({
          component: { 
            name: 'vuln-dep', 
            version: '1.0.0', 
            ecosystem: 'npm',
            vulnerabilities: [{ id: 'CVE-2024-1234', severity: 'high' }],
          },
          status: 'reachable',
        }),
      ];
      
      const output = createMockOutput({ results });
      
      const xmlWithAll = toJUnitXml(output, { includeAll: true });
      const xmlDefault = toJUnitXml(output, { includeAll: false });
      
      expect(xmlWithAll).toContain('clean-dep');
      expect(xmlDefault).not.toContain('clean-dep');
      expect(xmlDefault).toContain('vuln-dep');
    });

    it('should include warnings as test cases', () => {
      const result = createMockResult({
        component: { name: 'pkg', version: '1.0.0', ecosystem: 'npm' },
        status: 'reachable',
        warnings: [{
          code: 'dynamic_import',
          message: 'Dynamic import detected',
          severity: 'warning',
          location: { file: 'src/index.js', line: 42 },
        }],
      });
      
      const output = createMockOutput({ results: [result] });
      const xml = toJUnitXml(output, { includeWarnings: true });
      
      expect(xml).toContain('Dynamic import detected');
      expect(xml).toContain('reachvet.warnings.dynamic_import');
    });

    it('should handle empty results', () => {
      const output = createMockOutput({ results: [] });
      const xml = toJUnitXml(output);
      
      expect(xml).toContain('<testsuites tests="0"');
    });

    it('should escape XML special characters', () => {
      const result = createMockResult({
        component: {
          name: 'pkg<script>',
          version: '1.0.0 & latest',
          ecosystem: 'npm',
        },
        status: 'reachable',
      });
      
      const output = createMockOutput({ results: [result] });
      const xml = toJUnitXml(output, { includeAll: true });
      
      expect(xml).toContain('&lt;script&gt;');
      expect(xml).toContain('&amp;');
    });

    it('should use custom suite name', () => {
      const output = createMockOutput();
      const xml = toJUnitXml(output, { suiteName: 'Custom Name' });
      
      expect(xml).toContain('name="Custom Name"');
    });

    it('should format time correctly', () => {
      const output = createMockOutput({
        metadata: { analysisDurationMs: 1234 },
      });
      const xml = toJUnitXml(output);
      
      expect(xml).toMatch(/time="1\.\d+"/);
    });
  });

  describe('toJUnitXmlMultiple', () => {
    it('should create multiple testsuites', () => {
      const outputs = [
        { name: 'project-a', output: createMockOutput() },
        { name: 'project-b', output: createMockOutput() },
      ];
      
      const xml = toJUnitXmlMultiple(outputs);
      
      expect(xml).toContain('name="project-a"');
      expect(xml).toContain('name="project-b"');
    });

    it('should calculate total tests across suites', () => {
      const outputs = [
        { name: 'p1', output: createMockOutput({
          results: [
            createMockResult({ status: 'reachable' }),
            createMockResult({ status: 'reachable' }),
          ]
        })},
        { name: 'p2', output: createMockOutput({
          results: [createMockResult({ status: 'reachable' })]
        })}
      ];
      
      const xml = toJUnitXmlMultiple(outputs, { includeAll: true });
      
      // Total in testsuites element
      expect(xml).toMatch(/<testsuites tests="3"/);
    });

    it('should handle empty results array', () => {
      const xml = toJUnitXmlMultiple([]);
      
      expect(xml).toContain('<testsuites tests="0"');
      expect(xml).toContain('</testsuites>');
    });

    it('should respect includeAll option', () => {
      const outputs = [
        { name: 'project', output: createMockOutput({
          results: [
            createMockResult({ 
              component: { name: 'clean-dep', version: '1.0.0', ecosystem: 'npm' },
              status: 'not_reachable' 
            }),
            createMockResult({ 
              component: { 
                name: 'vuln-dep', 
                version: '1.0.0', 
                ecosystem: 'npm',
                vulnerabilities: [{ id: 'CVE-2024-1234', severity: 'high' }],
              },
              status: 'reachable',
            }),
          ]
        })}
      ];
      
      const xmlWithAll = toJUnitXmlMultiple(outputs, { includeAll: true });
      const xmlDefault = toJUnitXmlMultiple(outputs, { includeAll: false });
      
      expect(xmlWithAll).toContain('clean-dep');
      expect(xmlDefault).not.toContain('clean-dep');
      expect(xmlDefault).toContain('vuln-dep');
    });

    it('should sum analysis time', () => {
      const outputs = [
        { name: 'p1', output: createMockOutput({ 
          metadata: { analysisDurationMs: 100 }
        })},
        { name: 'p2', output: createMockOutput({
          metadata: { analysisDurationMs: 200 }
        })}
      ];
      
      const xml = toJUnitXmlMultiple(outputs);
      
      // Total time should be 0.300 seconds
      expect(xml).toMatch(/time="0\.300"/);
    });
  });
});
