/**
 * HTML and Markdown output tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { toHtml, toMarkdown } from '../src/output/index.js';
import type { AnalysisOutput, ComponentResult } from '../src/types.js';

// Mock analysis output for testing
const mockOutput: AnalysisOutput = {
  version: '0.2.0',
  timestamp: '2026-02-04T07:30:00Z',
  sourceDir: '/test/project',
  language: 'javascript',
  summary: {
    total: 5,
    reachable: 2,
    imported: 1,
    notReachable: 1,
    indirect: 0,
    unknown: 1,
    vulnerableReachable: 1,
    warningsCount: 2,
  },
  results: [
    {
      component: {
        name: 'lodash',
        version: '4.17.20',
        vulnerabilities: [
          {
            id: 'CVE-2021-23337',
            severity: 'high',
            affectedFunctions: ['template'],
          },
        ],
      },
      status: 'reachable',
      usage: {
        importStyle: 'esm',
        usedMembers: ['template', 'merge'],
        locations: [{ file: 'src/utils.js', line: 5, column: 1 }],
      },
      notes: ['Vulnerable function template() is used'],
    },
    {
      component: { name: 'express', version: '4.18.0' },
      status: 'reachable',
      usage: {
        importStyle: 'commonjs',
        usedMembers: ['Router', 'json'],
        locations: [{ file: 'src/app.js', line: 1, column: 1 }],
      },
    },
    {
      component: { name: 'debug', version: '4.3.0' },
      status: 'imported',
      usage: {
        importStyle: 'esm',
        locations: [{ file: 'src/logger.js', line: 2, column: 1 }],
      },
      warnings: [
        {
          code: 'dynamic_import',
          message: 'Dynamic import detected',
          severity: 'warning',
        },
      ],
    },
    {
      component: { name: 'chalk', version: '5.0.0' },
      status: 'not_reachable',
    },
    {
      component: { name: 'unknown-pkg', version: '1.0.0' },
      status: 'unknown',
      notes: ['Package not found in source'],
    },
  ],
};

describe('HTML Output', () => {
  it('should generate valid HTML document', () => {
    const html = toHtml(mockOutput);
    
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('should include report title', () => {
    const html = toHtml(mockOutput, { title: 'Custom Title' });
    
    expect(html).toContain('Custom Title');
  });

  it('should include summary statistics', () => {
    const html = toHtml(mockOutput);
    
    expect(html).toContain('5'); // total
    expect(html).toContain('2'); // reachable
    expect(html).toContain('Reachable');
  });

  it('should include component details', () => {
    const html = toHtml(mockOutput);
    
    expect(html).toContain('lodash');
    expect(html).toContain('4.17.20');
    expect(html).toContain('express');
  });

  it('should highlight vulnerabilities', () => {
    const html = toHtml(mockOutput);
    
    expect(html).toContain('CVE-2021-23337');
    expect(html).toContain('high');
  });

  it('should support dark mode', () => {
    const html = toHtml(mockOutput, { darkMode: true });
    
    expect(html).toContain('class="dark"');
  });

  it('should include interactive script when enabled', () => {
    const html = toHtml(mockOutput, { interactive: true });
    
    expect(html).toContain('<script>');
    expect(html).toContain('filter');
  });

  it('should exclude script when interactive is disabled', () => {
    const html = toHtml(mockOutput, { interactive: false });
    
    // Should not have filter functionality
    expect(html).not.toContain('filterResults');
  });

  it('should include chart when enabled', () => {
    const html = toHtml(mockOutput, { includeChart: true });
    
    expect(html).toContain('chart');
  });

  it('should escape HTML in component names', () => {
    const outputWithSpecialChars: AnalysisOutput = {
      ...mockOutput,
      results: [
        {
          component: { name: '<script>alert("xss")</script>', version: '1.0.0' },
          status: 'reachable',
        },
      ],
    };
    
    const html = toHtml(outputWithSpecialChars);
    
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should include timestamp and metadata', () => {
    const html = toHtml(mockOutput);
    
    expect(html).toContain('2026-02-04');
    expect(html).toContain('javascript');
    expect(html).toContain('/test/project');
  });

  it('should include warnings section when warnings exist', () => {
    const html = toHtml(mockOutput);
    
    expect(html).toContain('dynamic_import');
  });
});

describe('Markdown Output', () => {
  it('should generate valid Markdown', () => {
    const md = toMarkdown(mockOutput);
    
    expect(md).toContain('# ReachVet Analysis Report');
    expect(md).toContain('## ');
  });

  it('should include summary table', () => {
    const md = toMarkdown(mockOutput);
    
    expect(md).toContain('| Status | Count |');
    expect(md).toContain('Reachable');
  });

  it('should show vulnerable dependencies alert', () => {
    const md = toMarkdown(mockOutput);
    
    expect(md).toContain('⚠️ Vulnerable');
    expect(md).toContain('CVE-2021-23337');
  });

  it('should include component details', () => {
    const md = toMarkdown(mockOutput, { includeDetails: true });
    
    expect(md).toContain('lodash');
    expect(md).toContain('express');
  });

  it('should respect maxComponents limit', () => {
    const manyComponents: AnalysisOutput = {
      ...mockOutput,
      summary: { ...mockOutput.summary, total: 100 },
      results: Array.from({ length: 100 }, (_, i) => ({
        component: { name: `pkg-${i}`, version: '1.0.0' },
        status: 'reachable' as const,
      })),
    };
    
    const md = toMarkdown(manyComponents, { maxComponents: 10 });
    
    expect(md).toContain('first 10 of 100');
  });

  it('should support vulnerableOnly filter', () => {
    const md = toMarkdown(mockOutput, { vulnerableOnly: true, includeDetails: true });
    
    expect(md).toContain('lodash');
    // Non-vulnerable packages should be filtered
    expect(md).not.toContain('chalk');
  });

  it('should include warnings section', () => {
    const md = toMarkdown(mockOutput, { includeWarnings: true });
    
    expect(md).toContain('Analysis Warnings');
    expect(md).toContain('dynamic_import');
  });

  it('should support compact mode', () => {
    const mdFull = toMarkdown(mockOutput, { compact: false });
    const mdCompact = toMarkdown(mockOutput, { compact: true });
    
    // Compact mode should be shorter
    expect(mdCompact.length).toBeLessThan(mdFull.length);
    // Compact mode should not have full header
    expect(mdCompact).not.toContain('# ReachVet Analysis Report');
  });

  it('should use status emoji', () => {
    const md = toMarkdown(mockOutput);
    
    expect(md).toContain('🟢'); // reachable
    expect(md).toContain('🟡'); // imported
  });

  it('should include severity emoji for vulnerabilities', () => {
    const md = toMarkdown(mockOutput);
    
    expect(md).toContain('🟠'); // high severity
  });

  it('should include footer in non-compact mode', () => {
    const md = toMarkdown(mockOutput, { compact: false });
    
    expect(md).toContain('Generated by ReachVet');
    expect(md).toContain('---');
  });

  it('should include locations when enabled', () => {
    const md = toMarkdown(mockOutput, { includeLocations: true, includeDetails: true });
    
    expect(md).toContain('src/utils.js');
  });
});

describe('Output Edge Cases', () => {
  it('should handle empty results', () => {
    const emptyOutput: AnalysisOutput = {
      version: '0.2.0',
      timestamp: '2026-02-04T07:30:00Z',
      sourceDir: '/test/project',
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
    };
    
    const html = toHtml(emptyOutput);
    const md = toMarkdown(emptyOutput);
    
    expect(html).toContain('<!DOCTYPE html>');
    expect(md).toContain('# ReachVet Analysis Report');
  });

  it('should handle results without vulnerabilities', () => {
    const safeOutput: AnalysisOutput = {
      ...mockOutput,
      summary: { ...mockOutput.summary, vulnerableReachable: 0 },
      results: mockOutput.results.filter(r => !r.component.vulnerabilities?.length),
    };
    
    const html = toHtml(safeOutput);
    const md = toMarkdown(safeOutput);
    
    // Should not have vulnerability section
    expect(html).not.toContain('CVE-');
    expect(md).not.toContain('Vulnerable Dependencies Detected');
  });

  it('should handle results without warnings', () => {
    const noWarningsOutput: AnalysisOutput = {
      ...mockOutput,
      summary: { ...mockOutput.summary, warningsCount: 0 },
      results: mockOutput.results.map(r => ({ ...r, warnings: undefined })),
    };
    
    const html = toHtml(noWarningsOutput);
    const md = toMarkdown(noWarningsOutput, { includeWarnings: true });
    
    expect(html).toBeDefined();
    expect(md).toBeDefined();
  });
});
