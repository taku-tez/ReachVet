/**
 * Tests for GitHub Actions Annotations Output
 */

import { describe, it, expect } from 'vitest';
import {
  generateAnnotations,
  formatAnnotation,
  annotationsToStrings,
  type Annotation,
} from '../output/annotations.js';
import type { AnalysisOutput, ComponentResult } from '../types.js';

// Helper to create mock analysis output
function createMockOutput(results: ComponentResult[]): AnalysisOutput {
  return {
    version: '1.0.0',
    timestamp: '2026-02-04T00:00:00Z',
    sourceDir: '/test/src',
    language: 'javascript',
    results,
    summary: {
      total: results.length,
      reachable: results.filter(r => r.status === 'reachable').length,
      imported: results.filter(r => r.status === 'imported').length,
      notReachable: results.filter(r => r.status === 'not_reachable').length,
      unknown: results.filter(r => r.status === 'unknown').length,
      vulnerableReachable: results.filter(
        r => r.status === 'reachable' && r.component.vulnerabilities?.length
      ).length,
      warningsCount: 0,
    },
  };
}

describe('generateAnnotations', () => {
  it('should generate error annotation for vulnerable reachable component', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [
            { id: 'CVE-2021-23337', affectedFunctions: ['template'] },
          ],
        },
        status: 'reachable',
        usage: {
          importStyle: 'named',
          usedMembers: ['template'],
          locations: [{ file: 'src/app.js', line: 10 }],
        },
      },
    ]);

    const annotations = generateAnnotations(output);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].level).toBe('error');
    expect(annotations[0].title).toBe('Vulnerable Dependency Reachable');
    expect(annotations[0].message).toContain('lodash@4.17.20');
    expect(annotations[0].message).toContain('CVE-2021-23337');
    expect(annotations[0].file).toBe('src/app.js');
    expect(annotations[0].line).toBe(10);
  });

  it('should generate warning annotation for reachable component without vulnerabilities', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'axios',
          version: '1.0.0',
        },
        status: 'reachable',
        usage: {
          importStyle: 'default',
          usedMembers: ['get', 'post'],
          locations: [{ file: 'src/api.js', line: 5 }],
        },
      },
    ]);

    const annotations = generateAnnotations(output);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].level).toBe('warning');
    expect(annotations[0].title).toBe('Dependency Reachable');
    expect(annotations[0].message).toContain('axios@1.0.0');
    expect(annotations[0].message).toContain('get, post');
  });

  it('should generate notice annotation for imported component when notices enabled', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'moment',
          version: '2.29.0',
        },
        status: 'imported',
        usage: {
          importStyle: 'namespace',
          locations: [{ file: 'src/utils.js', line: 1 }],
        },
      },
    ]);

    // Without notices
    const annotationsNoNotices = generateAnnotations(output, { notices: false });
    expect(annotationsNoNotices).toHaveLength(0);

    // With notices
    const annotationsWithNotices = generateAnnotations(output, { notices: true });
    expect(annotationsWithNotices).toHaveLength(1);
    expect(annotationsWithNotices[0].level).toBe('notice');
    expect(annotationsWithNotices[0].title).toBe('Dependency Imported');
    expect(annotationsWithNotices[0].message).toContain('moment@2.29.0');
  });

  it('should not generate annotation for not_reachable component', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'unused-pkg',
          version: '1.0.0',
        },
        status: 'not_reachable',
      },
    ]);

    const annotations = generateAnnotations(output);
    expect(annotations).toHaveLength(0);
  });

  it('should respect maxAnnotations limit', () => {
    const results: ComponentResult[] = [];
    for (let i = 0; i < 20; i++) {
      results.push({
        component: { name: `pkg-${i}`, version: '1.0.0' },
        status: 'reachable',
        usage: {
          importStyle: 'default',
          locations: [{ file: `src/file${i}.js`, line: i + 1 }],
        },
      });
    }
    const output = createMockOutput(results);

    const annotations = generateAnnotations(output, { maxAnnotations: 5 });
    expect(annotations).toHaveLength(5);
  });

  it('should filter by annotation level', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'vuln-pkg',
          version: '1.0.0',
          vulnerabilities: [{ id: 'CVE-2024-1234' }],
        },
        status: 'reachable',
      },
      {
        component: { name: 'normal-pkg', version: '1.0.0' },
        status: 'reachable',
      },
      {
        component: { name: 'imported-pkg', version: '1.0.0' },
        status: 'imported',
      },
    ]);

    // Only errors
    const errorsOnly = generateAnnotations(output, {
      errors: true,
      warnings: false,
      notices: false,
    });
    expect(errorsOnly).toHaveLength(1);
    expect(errorsOnly[0].level).toBe('error');

    // Only warnings
    const warningsOnly = generateAnnotations(output, {
      errors: false,
      warnings: true,
      notices: false,
    });
    expect(warningsOnly).toHaveLength(1);
    expect(warningsOnly[0].level).toBe('warning');

    // All levels
    const all = generateAnnotations(output, {
      errors: true,
      warnings: true,
      notices: true,
    });
    expect(all).toHaveLength(3);
  });
});

describe('formatAnnotation', () => {
  it('should format error annotation with file and line', () => {
    const annotation: Annotation = {
      level: 'error',
      title: 'Vulnerable Dependency',
      message: 'lodash@4.17.20 is vulnerable',
      file: 'src/app.js',
      line: 10,
    };

    const formatted = formatAnnotation(annotation);
    expect(formatted).toBe(
      '::error file=src/app.js,line=10,title=Vulnerable Dependency::lodash@4.17.20 is vulnerable'
    );
  });

  it('should format warning annotation without location', () => {
    const annotation: Annotation = {
      level: 'warning',
      title: 'Dependency Reachable',
      message: 'axios@1.0.0 is reachable',
    };

    const formatted = formatAnnotation(annotation);
    expect(formatted).toBe('::warning title=Dependency Reachable::axios@1.0.0 is reachable');
  });

  it('should format notice annotation', () => {
    const annotation: Annotation = {
      level: 'notice',
      title: 'Info',
      message: 'This is informational',
    };

    const formatted = formatAnnotation(annotation);
    expect(formatted).toBe('::notice title=Info::This is informational');
  });

  it('should include all location parameters when provided', () => {
    const annotation: Annotation = {
      level: 'error',
      title: 'Error',
      message: 'test message',
      file: 'src/test.js',
      line: 10,
      endLine: 15,
      col: 5,
      endCol: 20,
    };

    const formatted = formatAnnotation(annotation);
    expect(formatted).toContain('file=src/test.js');
    expect(formatted).toContain('line=10');
    expect(formatted).toContain('endLine=15');
    expect(formatted).toContain('col=5');
    expect(formatted).toContain('endCol=20');
  });
});

describe('annotationsToStrings', () => {
  it('should convert analysis output to annotation strings', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'test-pkg',
          version: '1.0.0',
          vulnerabilities: [{ id: 'CVE-2024-0001' }],
        },
        status: 'reachable',
        usage: {
          importStyle: 'default',
          locations: [{ file: 'src/index.js', line: 1 }],
        },
      },
    ]);

    const strings = annotationsToStrings(output);
    expect(strings).toHaveLength(1);
    expect(strings[0]).toMatch(/^::error/);
    expect(strings[0]).toContain('test-pkg@1.0.0');
  });

  it('should return empty array for no findings', () => {
    const output = createMockOutput([
      {
        component: { name: 'safe-pkg', version: '1.0.0' },
        status: 'not_reachable',
      },
    ]);

    const strings = annotationsToStrings(output);
    expect(strings).toHaveLength(0);
  });
});

describe('edge cases', () => {
  it('should handle component without usage info', () => {
    const output = createMockOutput([
      {
        component: { name: 'no-usage-pkg', version: '1.0.0' },
        status: 'reachable',
      },
    ]);

    const annotations = generateAnnotations(output);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].file).toBeUndefined();
    expect(annotations[0].line).toBeUndefined();
  });

  it('should handle vulnerability without affected functions', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'vuln-no-funcs',
          version: '1.0.0',
          vulnerabilities: [{ id: 'CVE-2024-9999' }],
        },
        status: 'reachable',
      },
    ]);

    const annotations = generateAnnotations(output);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].message).not.toContain('Affected functions');
  });

  it('should handle many affected functions', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'many-funcs',
          version: '1.0.0',
          vulnerabilities: [
            {
              id: 'CVE-2024-0001',
              affectedFunctions: ['fn1', 'fn2', 'fn3', 'fn4', 'fn5', 'fn6', 'fn7'],
            },
          ],
        },
        status: 'reachable',
      },
    ]);

    const annotations = generateAnnotations(output);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].message).toContain('fn1, fn2, fn3, fn4, fn5');
    expect(annotations[0].message).toContain('and 2 more');
  });

  it('should handle empty results', () => {
    const output = createMockOutput([]);
    const annotations = generateAnnotations(output);
    expect(annotations).toHaveLength(0);
  });

  it('should handle unknown status', () => {
    const output = createMockOutput([
      {
        component: { name: 'unknown-pkg', version: '1.0.0' },
        status: 'unknown',
      },
    ]);

    const annotations = generateAnnotations(output);
    expect(annotations).toHaveLength(0);
  });
});
