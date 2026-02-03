/**
 * ReachVet - Graph Output Tests
 */

import { describe, it, expect } from 'vitest';
import { generateGraph, generateGraphFromAnalysis, type GraphOptions } from '../output/graph.js';
import type { ComponentResult, AnalysisOutput } from '../types.js';

describe('Graph Output', () => {
  const mockResults: ComponentResult[] = [
    {
      component: { 
        name: 'lodash', 
        version: '4.17.21', 
        ecosystem: 'npm',
        vulnerabilities: [{ id: 'CVE-2021-23337', severity: 'high' }],
      },
      status: 'reachable',
      confidence: 'high',
      usage: {
        importStyle: 'esm',
        usedMembers: ['template'],
        locations: [{ file: 'src/index.js', line: 10 }],
      },
    },
    {
      component: { name: 'axios', version: '1.6.0', ecosystem: 'npm' },
      status: 'reachable',
      confidence: 'high',
      usage: {
        importStyle: 'esm',
        usedMembers: ['get'],
        locations: [{ file: 'src/api.js', line: 5 }],
      },
    },
    {
      component: { name: 'express', version: '4.18.2', ecosystem: 'npm' },
      status: 'imported',
      confidence: 'high',
    },
    {
      component: { name: 'chalk', version: '5.3.0', ecosystem: 'npm' },
      status: 'indirect',
      confidence: 'medium',
    },
    {
      component: { name: 'uuid', version: '9.0.0', ecosystem: 'npm' },
      status: 'not_reachable',
      confidence: 'high',
    },
  ];

  describe('Mermaid Format', () => {
    it('should generate valid Mermaid graph', () => {
      const output = generateGraph(mockResults, { format: 'mermaid' });
      
      expect(output).toContain('graph TB');
      expect(output).toContain('classDef vulnerable');
      expect(output).toContain('classDef reachable');
      expect(output).toContain('lodash_4_17_21');
      expect(output).toContain('axios_1_6_0');
    });

    it('should include legend by default', () => {
      const output = generateGraph(mockResults, { format: 'mermaid' });
      
      expect(output).toContain('subgraph Legend');
      expect(output).toContain('Vulnerable & Reachable');
    });

    it('should respect direction option', () => {
      const outputTB = generateGraph(mockResults, { format: 'mermaid', direction: 'TB' });
      const outputLR = generateGraph(mockResults, { format: 'mermaid', direction: 'LR' });
      
      expect(outputTB).toContain('graph TB');
      expect(outputLR).toContain('graph LR');
    });

    it('should filter vulnerable only', () => {
      const output = generateGraph(mockResults, { 
        format: 'mermaid', 
        vulnerableOnly: true 
      });
      
      expect(output).toContain('lodash_4_17_21');
      expect(output).toContain('axios_1_6_0');
      expect(output).toContain('express_4_18_2');
      expect(output).not.toContain('uuid_9_0_0'); // not-reachable should be excluded
    });

    it('should exclude legend when requested', () => {
      const output = generateGraph(mockResults, { 
        format: 'mermaid', 
        includeLegend: false 
      });
      
      expect(output).not.toContain('subgraph Legend');
    });

    it('should group by ecosystem', () => {
      const output = generateGraph(mockResults, { 
        format: 'mermaid', 
        groupByLanguage: true 
      });
      
      // Groups by ecosystem (npm) since language is from component.ecosystem
      expect(output).toContain('subgraph npm');
    });

    it('should apply correct classes', () => {
      const output = generateGraph(mockResults, { format: 'mermaid' });
      
      expect(output).toContain('class');
      expect(output).toContain('vulnerable');
      expect(output).toContain('reachable');
    });
  });

  describe('DOT Format', () => {
    it('should generate valid DOT graph', () => {
      const output = generateGraph(mockResults, { format: 'dot' });
      
      expect(output).toContain('digraph DependencyGraph');
      expect(output).toContain('rankdir=TB');
      expect(output).toContain('lodash_4_17_21');
      expect(output).toContain('->');
    });

    it('should include style attributes', () => {
      const output = generateGraph(mockResults, { format: 'dot' });
      
      expect(output).toContain('fillcolor=');
      expect(output).toContain('fontcolor=');
      expect(output).toContain('style=filled');
    });

    it('should include legend by default', () => {
      const output = generateGraph(mockResults, { format: 'dot' });
      
      expect(output).toContain('subgraph cluster_legend');
      expect(output).toContain('leg_vulnerable');
    });

    it('should exclude legend when requested', () => {
      const output = generateGraph(mockResults, { format: 'dot', includeLegend: false });
      
      expect(output).not.toContain('cluster_legend');
    });

    it('should respect direction option', () => {
      const outputTB = generateGraph(mockResults, { format: 'dot', direction: 'TB' });
      const outputLR = generateGraph(mockResults, { format: 'dot', direction: 'LR' });
      
      expect(outputTB).toContain('rankdir=TB');
      expect(outputLR).toContain('rankdir=LR');
    });

    it('should group by ecosystem with subgraphs', () => {
      const output = generateGraph(mockResults, { 
        format: 'dot', 
        groupByLanguage: true 
      });
      
      expect(output).toContain('subgraph cluster_');
      // Groups by ecosystem (npm) since language is from component.ecosystem
      expect(output).toContain('label="npm"');
    });

    it('should use specified node shape', () => {
      const boxOutput = generateGraph(mockResults, { format: 'dot', nodeShape: 'box' });
      const ellipseOutput = generateGraph(mockResults, { format: 'dot', nodeShape: 'ellipse' });
      
      expect(boxOutput).toContain('shape=box');
      expect(ellipseOutput).toContain('shape=ellipse');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty results', () => {
      const mermaidOutput = generateGraph([], { format: 'mermaid' });
      const dotOutput = generateGraph([], { format: 'dot' });
      
      expect(mermaidOutput).toContain('graph TB');
      expect(dotOutput).toContain('digraph DependencyGraph');
    });

    it('should sanitize special characters in node IDs', () => {
      const results: ComponentResult[] = [
        {
          component: { name: '@scope/package-name', version: '1.0.0', ecosystem: 'npm' },
          status: 'reachable',
          confidence: 'high',
        },
      ];
      
      const output = generateGraph(results, { format: 'mermaid' });
      // Node ID should be sanitized (no @ or /)
      expect(output).toContain('_scope_package_name_1_0_0');
      // But label should show original name
      expect(output).toContain('@scope/package-name@1.0.0');
    });

    it('should handle components without version', () => {
      const results: ComponentResult[] = [
        {
          component: { name: 'some-package' },
          status: 'imported',
          confidence: 'high',
        },
      ];
      
      const output = generateGraph(results, { format: 'mermaid' });
      expect(output).toContain('some_package_latest');
    });

    it('should escape quotes in labels', () => {
      const results: ComponentResult[] = [
        {
          component: { name: 'test"package', version: '1.0.0' },
          status: 'imported',
          confidence: 'high',
        },
      ];
      
      const output = generateGraph(results, { format: 'dot' });
      expect(output).toContain('\\"');
    });
  });

  describe('generateGraphFromAnalysis', () => {
    it('should work with full analysis output', () => {
      const analysis: AnalysisOutput = {
        version: '0.2.0',
        timestamp: new Date().toISOString(),
        sourceDir: '/test',
        language: 'javascript',
        results: mockResults,
        summary: {
          total: 5,
          vulnerableReachable: 1,
          reachable: 1,
          imported: 1,
          indirect: 1,
          notReachable: 1,
          unknown: 0,
          warningsCount: 0,
        },
      };
      
      const output = generateGraphFromAnalysis(analysis, { format: 'mermaid' });
      expect(output).toContain('lodash_4_17_21');
    });
  });

  describe('Multi-language support', () => {
    it('should handle mixed language results', () => {
      const multiLangResults: ComponentResult[] = [
        {
          component: { name: 'lodash', version: '4.17.21', ecosystem: 'npm' },
          status: 'reachable',
          confidence: 'high',
        },
        {
          component: { name: 'requests', version: '2.31.0', ecosystem: 'pypi' },
          status: 'reachable',
          confidence: 'high',
        },
        {
          component: { name: 'serde', version: '1.0.0', ecosystem: 'cargo' },
          status: 'imported',
          confidence: 'high',
        },
      ];
      
      const output = generateGraph(multiLangResults, { 
        format: 'mermaid', 
        groupByLanguage: true 
      });
      
      expect(output).toContain('subgraph npm');
      expect(output).toContain('subgraph pypi');
      expect(output).toContain('subgraph cargo');
    });
  });
});
