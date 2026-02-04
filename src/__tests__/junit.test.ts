import { describe, it, expect } from 'vitest';
import { toJUnitXml, toJUnitXmlMultiple, JUnitOptions } from '../output/junit.js';
import type { ReachabilityResult, DependencyInfo, AnalysisWarning } from '../types.js';

// Helper to create mock result
function createMockResult(overrides: Partial<ReachabilityResult> = {}): ReachabilityResult {
  return {
    dependencies: [],
    summary: {
      totalDependencies: 0,
      reachableDependencies: 0,
      vulnerableFunctionsCount: 0,
      reachableVulnerableFunctionsCount: 0,
      analysisTimeMs: 100
    },
    ...overrides
  };
}

// Helper to create mock dependency
function createMockDep(overrides: Partial<DependencyInfo> = {}): DependencyInfo {
  return {
    name: 'test-package',
    version: '1.0.0',
    isReachable: false,
    ecosystem: 'npm',
    ...overrides
  };
}

describe('JUnit XML Output', () => {
  describe('toJUnitXml', () => {
    it('should generate valid XML header', () => {
      const result = createMockResult();
      const xml = toJUnitXml(result);
      
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<testsuites');
      expect(xml).toContain('</testsuites>');
    });

    it('should include testsuite element with correct attributes', () => {
      const result = createMockResult({
        summary: {
          totalDependencies: 5,
          reachableDependencies: 2,
          vulnerableFunctionsCount: 3,
          reachableVulnerableFunctionsCount: 1,
          analysisTimeMs: 500
        }
      });
      
      const xml = toJUnitXml(result);
      
      expect(xml).toContain('<testsuite name="ReachVet Analysis"');
      expect(xml).toContain('timestamp=');
    });

    it('should create testcase for reachable dependency', () => {
      const dep = createMockDep({
        name: 'lodash',
        version: '4.17.20',
        isReachable: true,
        ecosystem: 'npm'
      });
      
      const result = createMockResult({ dependencies: [dep] });
      const xml = toJUnitXml(result, { includeAll: true });
      
      expect(xml).toContain('<testcase name="lodash@4.17.20"');
      expect(xml).toContain('classname="reachvet.dependencies.npm"');
    });

    it('should mark vulnerable reachable as failure', () => {
      const dep = createMockDep({
        name: 'vulnerable-pkg',
        version: '1.0.0',
        isReachable: true,
        vulnerableFunctions: [{
          functionName: 'dangerousFunc',
          isReachable: true,
          cveId: 'CVE-2024-1234',
          severity: 'high',
          location: 'src/index.js:42'
        }]
      });
      
      const result = createMockResult({ dependencies: [dep] });
      const xml = toJUnitXml(result);
      
      expect(xml).toContain('<failure type="VulnerableReachable"');
      expect(xml).toContain('message="1 vulnerable function(s) reachable"');
      expect(xml).toContain('CVE-2024-1234');
      expect(xml).toContain('dangerousFunc');
    });

    it('should mark vulnerable non-reachable as skipped', () => {
      const dep = createMockDep({
        name: 'vulnerable-pkg',
        version: '1.0.0',
        vulnerableFunctions: [{
          functionName: 'unusedFunc',
          isReachable: false,
          cveId: 'CVE-2024-5678'
        }]
      });
      
      const result = createMockResult({ dependencies: [dep] });
      const xml = toJUnitXml(result);
      
      expect(xml).toContain('<skipped message="1 vulnerable function(s) found but not reachable"');
      expect(xml).not.toContain('<failure');
    });

    it('should include warnings as test cases', () => {
      const warning: AnalysisWarning = {
        code: 'DYNAMIC_IMPORT',
        message: 'Dynamic import detected',
        severity: 'warning',
        location: { file: 'src/app.js', line: 10 }
      };
      
      const result = createMockResult({ warnings: [warning] });
      const xml = toJUnitXml(result, { includeWarnings: true });
      
      expect(xml).toContain('classname="reachvet.warnings.DYNAMIC_IMPORT"');
      expect(xml).toContain('Dynamic import detected');
    });

    it('should exclude warnings when includeWarnings is false', () => {
      const warning: AnalysisWarning = {
        code: 'DYNAMIC_IMPORT',
        message: 'Dynamic import detected',
        severity: 'warning'
      };
      
      const result = createMockResult({ warnings: [warning] });
      const xml = toJUnitXml(result, { includeWarnings: false });
      
      expect(xml).not.toContain('DYNAMIC_IMPORT');
    });

    it('should escape XML special characters', () => {
      const dep = createMockDep({
        name: '@scope/pkg',
        version: '1.0.0 <beta>',
        vulnerableFunctions: [{
          functionName: 'func<T>',
          isReachable: true,
          cveId: 'CVE-2024-1234'
        }]
      });
      
      const result = createMockResult({ dependencies: [dep] });
      const xml = toJUnitXml(result);
      
      expect(xml).toContain('&lt;beta&gt;');
      expect(xml).toContain('func&lt;T&gt;');
    });

    it('should respect custom suite name', () => {
      const result = createMockResult();
      const xml = toJUnitXml(result, { suiteName: 'My Custom Suite' });
      
      expect(xml).toContain('name="My Custom Suite"');
    });

    it('should support non-pretty output', () => {
      const dep = createMockDep({ isReachable: true });
      const result = createMockResult({ dependencies: [dep] });
      
      const xml = toJUnitXml(result, { pretty: false, includeAll: true });
      
      // No newlines between elements
      expect(xml).not.toMatch(/<\/testcase>\n\s*<\/testsuite>/);
    });

    it('should calculate correct test counts', () => {
      const deps = [
        createMockDep({ 
          name: 'pkg1', 
          vulnerableFunctions: [{ functionName: 'f1', isReachable: true }]
        }),
        createMockDep({ 
          name: 'pkg2', 
          vulnerableFunctions: [{ functionName: 'f2', isReachable: false }]
        }),
        createMockDep({ name: 'pkg3', isReachable: true })
      ];
      
      const result = createMockResult({ dependencies: deps });
      const xml = toJUnitXml(result, { includeAll: true });
      
      expect(xml).toContain('tests="3"');
      expect(xml).toContain('failures="1"');
      expect(xml).toContain('skipped="1"');
    });

    it('should handle empty dependencies', () => {
      const result = createMockResult({ dependencies: [] });
      const xml = toJUnitXml(result);
      
      expect(xml).toContain('tests="0"');
      expect(xml).toContain('failures="0"');
    });

    it('should handle multiple vulnerable functions', () => {
      const dep = createMockDep({
        name: 'multi-vuln',
        vulnerableFunctions: [
          { functionName: 'func1', isReachable: true, cveId: 'CVE-2024-001' },
          { functionName: 'func2', isReachable: true, cveId: 'CVE-2024-002' },
          { functionName: 'func3', isReachable: false }
        ]
      });
      
      const result = createMockResult({ dependencies: [dep] });
      const xml = toJUnitXml(result);
      
      expect(xml).toContain('2 vulnerable function(s) reachable');
      expect(xml).toContain('CVE-2024-001');
      expect(xml).toContain('CVE-2024-002');
    });

    it('should include severity in failure content', () => {
      const dep = createMockDep({
        vulnerableFunctions: [{
          functionName: 'criticalFunc',
          isReachable: true,
          severity: 'critical'
        }]
      });
      
      const result = createMockResult({ dependencies: [dep] });
      const xml = toJUnitXml(result);
      
      expect(xml).toContain('Severity: critical');
    });

    it('should handle warning with error severity as failure', () => {
      const warning: AnalysisWarning = {
        code: 'CRITICAL_ERROR',
        message: 'Critical analysis error',
        severity: 'error',
        location: { file: 'src/main.ts', line: 1 }
      };
      
      const result = createMockResult({ warnings: [warning] });
      const xml = toJUnitXml(result);
      
      expect(xml).toContain('<failure type="CRITICAL_ERROR"');
    });

    it('should handle dependency without ecosystem', () => {
      const dep = createMockDep({ ecosystem: undefined, isReachable: true });
      const result = createMockResult({ dependencies: [dep] });
      const xml = toJUnitXml(result, { includeAll: true });
      
      expect(xml).toContain('classname="reachvet.dependencies.unknown"');
    });
  });

  describe('toJUnitXmlMultiple', () => {
    it('should combine multiple results', () => {
      const results = [
        { name: 'project-a', result: createMockResult({ 
          dependencies: [createMockDep({ name: 'dep-a', isReachable: true })]
        })},
        { name: 'project-b', result: createMockResult({
          dependencies: [createMockDep({ name: 'dep-b', isReachable: true })]
        })}
      ];
      
      const xml = toJUnitXmlMultiple(results, { includeAll: true });
      
      expect(xml).toContain('name="project-a"');
      expect(xml).toContain('name="project-b"');
      expect(xml).toContain('dep-a');
      expect(xml).toContain('dep-b');
    });

    it('should calculate total tests across suites', () => {
      const results = [
        { name: 'p1', result: createMockResult({
          dependencies: [
            createMockDep({ name: 'd1', isReachable: true }),
            createMockDep({ name: 'd2', isReachable: true })
          ]
        })},
        { name: 'p2', result: createMockResult({
          dependencies: [createMockDep({ name: 'd3', isReachable: true })]
        })}
      ];
      
      const xml = toJUnitXmlMultiple(results, { includeAll: true });
      
      // Total in testsuites element
      expect(xml).toMatch(/<testsuites tests="3"/);
    });

    it('should handle empty results array', () => {
      const xml = toJUnitXmlMultiple([]);
      
      expect(xml).toContain('<testsuites tests="0"');
      expect(xml).toContain('</testsuites>');
    });

    it('should respect includeAll option', () => {
      const results = [
        { name: 'project', result: createMockResult({
          dependencies: [
            createMockDep({ name: 'clean-dep', isReachable: false }),
            createMockDep({ 
              name: 'vuln-dep', 
              vulnerableFunctions: [{ functionName: 'f', isReachable: true }]
            })
          ]
        })}
      ];
      
      const xmlWithAll = toJUnitXmlMultiple(results, { includeAll: true });
      const xmlDefault = toJUnitXmlMultiple(results, { includeAll: false });
      
      expect(xmlWithAll).toContain('clean-dep');
      expect(xmlDefault).not.toContain('clean-dep');
      expect(xmlDefault).toContain('vuln-dep');
    });

    it('should sum analysis time', () => {
      const results = [
        { name: 'p1', result: createMockResult({ 
          summary: { ...createMockResult().summary, analysisTimeMs: 100 }
        })},
        { name: 'p2', result: createMockResult({
          summary: { ...createMockResult().summary, analysisTimeMs: 200 }
        })}
      ];
      
      const xml = toJUnitXmlMultiple(results);
      
      // Total time should be 0.300 seconds
      expect(xml).toMatch(/time="0\.300"/);
    });
  });
});
