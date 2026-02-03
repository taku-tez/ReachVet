/**
 * ReachVet - Base Language Adapter Tests
 */

import { describe, it, expect } from 'vitest';
import { BaseLanguageAdapter } from '../languages/base.js';
import type { Component, ComponentResult, SupportedLanguage, CodeLocation, AnalysisWarning } from '../types.js';

// Concrete implementation for testing
class TestAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'javascript';
  fileExtensions = ['.js', '.ts'];

  async analyze(_sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    return components.map(c => this.notReachable(c));
  }

  async canHandle(_sourceDir: string): Promise<boolean> {
    return true;
  }

  // Expose protected methods for testing
  public testNotReachable(component: Component, notes?: string[], warnings?: AnalysisWarning[]) {
    return this.notReachable(component, notes, warnings);
  }

  public testReachable(
    component: Component,
    usage: ComponentResult['usage'],
    confidence: ComponentResult['confidence'],
    notes?: string[],
    warnings?: AnalysisWarning[]
  ) {
    return this.reachable(component, usage, confidence, notes, warnings);
  }

  public testImported(
    component: Component,
    usage: ComponentResult['usage'],
    notes?: string[],
    warnings?: AnalysisWarning[]
  ) {
    return this.imported(component, usage, notes, warnings);
  }

  public testUnknown(component: Component, notes?: string[], warnings?: AnalysisWarning[]) {
    return this.unknown(component, notes, warnings);
  }

  public testCreateUsage(locations: CodeLocation[], usedMembers?: string[]) {
    return this.createUsage(locations, usedMembers);
  }

  public testCheckVulnerableFunctions(component: Component, usedMethods: string[]) {
    return this.checkVulnerableFunctions(component, usedMethods);
  }
}

describe('BaseLanguageAdapter', () => {
  const adapter = new TestAdapter();
  const testComponent: Component = {
    name: 'test-package',
    version: '1.0.0'
  };

  describe('notReachable', () => {
    it('should create a not_reachable result', () => {
      const result = adapter.testNotReachable(testComponent);
      
      expect(result.status).toBe('not_reachable');
      expect(result.confidence).toBe('high');
      expect(result.component).toBe(testComponent);
    });

    it('should include notes when provided', () => {
      const result = adapter.testNotReachable(testComponent, ['No imports found']);
      
      expect(result.notes).toContain('No imports found');
    });

    it('should include warnings when provided', () => {
      const warning: AnalysisWarning = {
        code: 'dynamic_import',
        message: 'Dynamic import detected',
        severity: 'warning'
      };
      const result = adapter.testNotReachable(testComponent, undefined, [warning]);
      
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0].code).toBe('dynamic_import');
    });

    it('should not include empty warnings array', () => {
      const result = adapter.testNotReachable(testComponent, undefined, []);
      
      expect(result.warnings).toBeUndefined();
    });
  });

  describe('reachable', () => {
    const usage = {
      importStyle: 'esm' as const,
      locations: [{ file: 'test.js', line: 1 }]
    };

    it('should create a reachable result', () => {
      const result = adapter.testReachable(testComponent, usage, 'high');
      
      expect(result.status).toBe('reachable');
      expect(result.confidence).toBe('high');
      expect(result.usage).toBe(usage);
    });

    it('should use high confidence by default', () => {
      const result = adapter.testReachable(testComponent, usage, 'high');
      
      expect(result.confidence).toBe('high');
    });

    it('should include notes and warnings', () => {
      const warning: AnalysisWarning = {
        code: 'star_import',
        message: 'Wildcard import',
        severity: 'info'
      };
      const result = adapter.testReachable(testComponent, usage, 'medium', ['Used in 3 locations'], [warning]);
      
      expect(result.notes).toContain('Used in 3 locations');
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe('imported', () => {
    const usage = {
      importStyle: 'commonjs' as const,
      locations: [{ file: 'index.js', line: 5 }]
    };

    it('should create an imported result with medium confidence', () => {
      const result = adapter.testImported(testComponent, usage);
      
      expect(result.status).toBe('imported');
      expect(result.confidence).toBe('medium');
    });
  });

  describe('unknown', () => {
    it('should create an unknown result with low confidence', () => {
      const result = adapter.testUnknown(testComponent);
      
      expect(result.status).toBe('unknown');
      expect(result.confidence).toBe('low');
    });

    it('should include notes', () => {
      const result = adapter.testUnknown(testComponent, ['Could not determine usage']);
      
      expect(result.notes).toContain('Could not determine usage');
    });
  });

  describe('createUsage', () => {
    it('should create usage info with locations', () => {
      const locations: CodeLocation[] = [
        { file: 'a.js', line: 1 },
        { file: 'b.js', line: 10 }
      ];
      const usage = adapter.testCreateUsage(locations);
      
      expect(usage.locations).toHaveLength(2);
      expect(usage.importStyle).toBe('esm');
    });

    it('should include used members when provided', () => {
      const locations: CodeLocation[] = [{ file: 'a.js', line: 1 }];
      const usage = adapter.testCreateUsage(locations, ['method1', 'method2']);
      
      expect(usage.usedMembers).toContain('method1');
      expect(usage.usedMembers).toContain('method2');
    });

    it('should not include empty used members array', () => {
      const locations: CodeLocation[] = [{ file: 'a.js', line: 1 }];
      const usage = adapter.testCreateUsage(locations, []);
      
      expect(usage.usedMembers).toBeUndefined();
    });
  });

  describe('checkVulnerableFunctions', () => {
    it('should return matching vulnerable functions', () => {
      const component: Component = {
        name: 'lodash',
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          affectedFunctions: ['template', 'templateSettings']
        }]
      };
      
      const affected = adapter.testCheckVulnerableFunctions(component, ['template', 'merge', 'cloneDeep']);
      
      expect(affected).toContain('template');
      expect(affected).not.toContain('merge');
    });

    it('should return empty array when no vulnerabilities', () => {
      const affected = adapter.testCheckVulnerableFunctions(testComponent, ['method1']);
      
      expect(affected).toHaveLength(0);
    });

    it('should return empty array when no methods used', () => {
      const component: Component = {
        name: 'lodash',
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337',
          affectedFunctions: ['template']
        }]
      };
      
      const affected = adapter.testCheckVulnerableFunctions(component, []);
      
      expect(affected).toHaveLength(0);
    });

    it('should handle vulnerabilities without affectedFunctions', () => {
      const component: Component = {
        name: 'lodash',
        version: '4.17.20',
        vulnerabilities: [{
          id: 'CVE-2021-23337'
        }]
      };
      
      const affected = adapter.testCheckVulnerableFunctions(component, ['template']);
      
      expect(affected).toHaveLength(0);
    });
  });
});
