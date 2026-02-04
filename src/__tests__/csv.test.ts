/**
 * Tests for CSV output formatter
 */

import { describe, it, expect } from 'vitest';
import {
  toCSV,
  toCSVMultiple,
  toDependenciesCSV,
  toVulnerabilitiesCSV,
  parseCSV,
  DEFAULT_COLUMNS,
  ALL_COLUMNS,
} from '../output/csv.js';
import type { ComponentResult } from '../types.js';

describe('CSV Output', () => {
  const mockResults: ComponentResult[] = [
    {
      component: {
        name: 'lodash',
        version: '4.17.20',
        ecosystem: 'npm',
        vulnerabilities: [
          {
            id: 'CVE-2021-23337',
            severity: 'high',
            description: 'Prototype pollution in lodash',
            fixedVersion: '4.17.21',
          } as any,
        ],
      },
      status: 'reachable',
      confidence: 'high',
      usage: {
        importStyle: 'esm',
        locations: [{ file: 'src/index.ts', line: 5 }],
        usedMembers: ['merge', 'cloneDeep'],
      },
    },
    {
      component: {
        name: 'express',
        version: '4.17.1',
        ecosystem: 'npm',
      },
      status: 'reachable',
      confidence: 'high',
      usage: {
        importStyle: 'commonjs',
        locations: [{ file: 'src/server.ts', line: 1 }],
      },
    },
    {
      component: {
        name: 'moment',
        version: '2.29.1',
        ecosystem: 'npm',
        vulnerabilities: [
          {
            id: 'CVE-2022-31129',
            severity: 'medium',
            description: 'ReDoS in moment',
          } as any,
        ],
      },
      status: 'not_reachable',
      confidence: 'high',
    },
  ];

  describe('toCSV', () => {
    it('should generate CSV with default options', () => {
      const csv = toCSV(mockResults);
      const lines = csv.split('\n');

      // Should have header + 2 vulnerability rows (lodash + moment)
      expect(lines.length).toBe(3);

      // Check header
      expect(lines[0]).toContain('Package');
      expect(lines[0]).toContain('Version');
      expect(lines[0]).toContain('Vulnerability ID');
    });

    it('should include all dependencies when includeAll is true', () => {
      const csv = toCSV(mockResults, { includeAll: true });
      const lines = csv.split('\n');

      // Header + 3 rows (lodash vuln, express, moment vuln)
      expect(lines.length).toBe(4);
      expect(csv).toContain('express');
    });

    it('should omit header when includeHeader is false', () => {
      const csv = toCSV(mockResults, { includeHeader: false });
      const lines = csv.split('\n');

      // Should not have Package header
      expect(lines[0]).not.toContain('Package');
      expect(lines[0]).toContain('lodash');
    });

    it('should use semicolon delimiter', () => {
      const csv = toCSV(mockResults, { delimiter: ';' });
      expect(csv).toContain(';');
      expect(csv.split('\n')[0].split(';').length).toBeGreaterThan(1);
    });

    it('should use tab delimiter', () => {
      const csv = toCSV(mockResults, { delimiter: '\t' });
      expect(csv).toContain('\t');
    });

    it('should escape values with quotes', () => {
      const resultsWithComma: ComponentResult[] = [
        {
          component: {
            name: 'test-package',
            version: '1.0.0',
            ecosystem: 'npm',
            vulnerabilities: [
              {
                id: 'CVE-2024-1234',
                severity: 'high',
                description: 'Contains, comma and "quotes"',
              } as any,
            ],
          },
          status: 'reachable',
          confidence: 'high',
        },
      ];

      const csv = toCSV(resultsWithComma, { columns: ['package', 'vulnerability_summary'] });
      // Values with commas or quotes should be wrapped in quotes
      expect(csv).toContain('"Contains, comma and ""quotes"""');
    });

    it('should include CRLF line endings when specified', () => {
      const csv = toCSV(mockResults, { lineEnding: '\r\n' });
      expect(csv).toContain('\r\n');
    });

    it('should use custom columns', () => {
      const csv = toCSV(mockResults, {
        columns: ['package', 'version', 'reachable'],
      });
      const header = csv.split('\n')[0];

      expect(header).toContain('Package');
      expect(header).toContain('Version');
      expect(header).toContain('Reachable');
      expect(header).not.toContain('Vulnerability ID');
    });

    it('should include all columns when specified', () => {
      const csv = toCSV(mockResults, { columns: ALL_COLUMNS });
      const header = csv.split('\n')[0];

      expect(header).toContain('EPSS');
      expect(header).toContain('KEV');
      expect(header).toContain('Summary');
      expect(header).toContain('Used Functions');
    });

    it('should show import locations', () => {
      const csv = toCSV(mockResults);
      expect(csv).toContain('src/index.ts:5');
    });

    it('should show used functions', () => {
      const csv = toCSV(mockResults, { columns: [...DEFAULT_COLUMNS, 'used_functions'] });
      expect(csv).toContain('merge; cloneDeep');
    });

    it('should show fixed versions', () => {
      const csv = toCSV(mockResults);
      expect(csv).toContain('4.17.21');
    });
  });

  describe('toCSVMultiple', () => {
    it('should add project column for multi-project results', () => {
      const projectResults = [
        { project: 'frontend', results: [mockResults[0]] },
        { project: 'backend', results: [mockResults[1]] },
      ];

      const csv = toCSVMultiple(projectResults, { includeAll: true });
      const header = csv.split('\n')[0];

      expect(header).toContain('Project');
      expect(csv).toContain('frontend');
      expect(csv).toContain('backend');
    });
  });

  describe('toDependenciesCSV', () => {
    it('should output only dependency columns', () => {
      const csv = toDependenciesCSV(mockResults);
      const header = csv.split('\n')[0];

      expect(header).toContain('Package');
      expect(header).toContain('Import Location');
      expect(header).not.toContain('Vulnerability ID');
      expect(header).not.toContain('CVSS');
    });

    it('should include all dependencies', () => {
      const csv = toDependenciesCSV(mockResults);
      expect(csv).toContain('lodash');
      expect(csv).toContain('express');
      expect(csv).toContain('moment');
    });
  });

  describe('toVulnerabilitiesCSV', () => {
    it('should output only vulnerability columns', () => {
      const csv = toVulnerabilitiesCSV(mockResults);
      const header = csv.split('\n')[0];

      expect(header).toContain('Vulnerability ID');
      expect(header).toContain('CVSS');
      expect(header).toContain('Fixed Version');
    });

    it('should exclude non-vulnerable dependencies', () => {
      const csv = toVulnerabilitiesCSV(mockResults);
      expect(csv).toContain('lodash');
      expect(csv).toContain('moment');
      expect(csv).not.toContain('express');
    });
  });

  describe('parseCSV', () => {
    it('should parse CSV back to objects', () => {
      const csv = toCSV(mockResults);
      const parsed = parseCSV(csv);

      expect(parsed.length).toBe(2);
      expect(parsed[0]['Package']).toBe('lodash');
      expect(parsed[0]['Version']).toBe('4.17.20');
    });

    it('should handle CSV without header', () => {
      const csv = 'lodash,4.17.20,npm\nexpress,4.17.1,npm';
      const parsed = parseCSV(csv, { hasHeader: false });

      expect(parsed.length).toBe(2);
      expect(parsed[0]['col0']).toBe('lodash');
    });

    it('should handle quoted values with commas', () => {
      const csv = 'Package,Description\ntest,"has, comma"';
      const parsed = parseCSV(csv);

      expect(parsed[0]['Description']).toBe('has, comma');
    });

    it('should handle escaped quotes', () => {
      const csv = 'Package,Description\ntest,"has ""quotes"""';
      const parsed = parseCSV(csv);

      expect(parsed[0]['Description']).toBe('has "quotes"');
    });

    it('should handle semicolon delimiter', () => {
      const csv = 'Package;Version\nlodash;4.17.20';
      const parsed = parseCSV(csv, { delimiter: ';' });

      expect(parsed[0]['Package']).toBe('lodash');
    });
  });

  describe('DEFAULT_COLUMNS', () => {
    it('should have expected columns', () => {
      expect(DEFAULT_COLUMNS).toContain('package');
      expect(DEFAULT_COLUMNS).toContain('version');
      expect(DEFAULT_COLUMNS).toContain('reachable');
      expect(DEFAULT_COLUMNS).toContain('vulnerability_id');
    });
  });

  describe('ALL_COLUMNS', () => {
    it('should include additional columns', () => {
      expect(ALL_COLUMNS).toContain('epss');
      expect(ALL_COLUMNS).toContain('kev');
      expect(ALL_COLUMNS).toContain('vulnerability_summary');
      expect(ALL_COLUMNS).toContain('used_functions');
    });
  });

  describe('edge cases', () => {
    it('should handle empty results', () => {
      const csv = toCSV([]);
      expect(csv).toBe('Package,Version,Ecosystem,Reachable,Vulnerability ID,Severity,CVSS,Fixed Version,Import Location');
    });

    it('should handle results without vulnerabilities', () => {
      const results: ComponentResult[] = [
        {
          component: { name: 'safe-pkg', version: '1.0.0', ecosystem: 'npm' },
          status: 'reachable',
          confidence: 'high',
        },
      ];

      const csv = toCSV(results);
      // Should only have header
      expect(csv.split('\n').length).toBe(1);

      // With includeAll, should have data row
      const csvAll = toCSV(results, { includeAll: true });
      expect(csvAll.split('\n').length).toBe(2);
    });

    it('should handle missing optional fields', () => {
      const results: ComponentResult[] = [
        {
          component: {
            name: 'minimal',
            version: '1.0.0',
            vulnerabilities: [{ id: 'CVE-2024-0001' }],
          },
          status: 'not_reachable',
          confidence: 'low',
        },
      ];

      const csv = toCSV(results);
      expect(csv).toContain('minimal');
      expect(csv).toContain('CVE-2024-0001');
    });

    it('should derive severity from CVSS when severity is missing', () => {
      const results: ComponentResult[] = [
        {
          component: {
            name: 'test',
            version: '1.0.0',
            vulnerabilities: [{ id: 'CVE-2024-0001', cvss: 9.5 } as any],
          },
          status: 'reachable',
          confidence: 'high',
        },
      ];

      const csv = toCSV(results);
      expect(csv).toContain('CRITICAL');
    });

    it('should handle newlines in values', () => {
      const results: ComponentResult[] = [
        {
          component: {
            name: 'test',
            version: '1.0.0',
            vulnerabilities: [{
              id: 'CVE-2024-0001',
              description: 'Line 1\nLine 2',
            } as any],
          },
          status: 'reachable',
          confidence: 'high',
        },
      ];

      const csv = toCSV(results, { columns: ['package', 'vulnerability_summary'] });
      // Value with newline should be quoted
      expect(csv).toContain('"Line 1\nLine 2"');
    });
  });

  describe('warnings', () => {
    it('should include warnings by default', () => {
      const resultsWithWarnings: ComponentResult[] = [
        {
          component: { name: 'test', version: '1.0.0' },
          status: 'reachable',
          confidence: 'high',
          warnings: [
            {
              code: 'dynamic_import',
              message: 'Dynamic import detected',
              severity: 'warning',
              location: { file: 'src/main.ts', line: 10 },
            },
          ],
        },
      ];

      // Use columns that include vulnerability_summary to see the warning message
      const csv = toCSV(resultsWithWarnings, {
        includeAll: true,
        columns: [...DEFAULT_COLUMNS, 'vulnerability_summary'],
      });
      expect(csv).toContain('dynamic_import');
      expect(csv).toContain('Dynamic import detected');
    });

    it('should exclude warnings when includeWarnings is false', () => {
      const resultsWithWarnings: ComponentResult[] = [
        {
          component: { name: 'test', version: '1.0.0' },
          status: 'reachable',
          confidence: 'high',
          warnings: [
            {
              code: 'dynamic_import',
              message: 'Dynamic import detected',
              severity: 'warning',
            },
          ],
        },
      ];

      const csv = toCSV(resultsWithWarnings, { includeAll: true, includeWarnings: false });
      expect(csv).not.toContain('dynamic_import');
    });
  });
});
