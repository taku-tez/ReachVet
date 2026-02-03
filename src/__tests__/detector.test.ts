/**
 * ReachVet Detector Tests
 */

import { describe, it, expect } from 'vitest';
import { 
  matchesComponent, 
  findMatchingImports, 
  extractUsedMembers, 
  usesAffectedFunctions,
  getPrimaryImportStyle 
} from '../languages/javascript/detector.js';
import type { ImportInfo } from '../languages/javascript/parser.js';
import type { Component } from '../types.js';

const makeImport = (partial: Partial<ImportInfo>): ImportInfo => ({
  moduleName: 'test',
  importStyle: 'esm',
  isNamespaceImport: false,
  isDefaultImport: false,
  namedImports: [],
  location: { file: 'test.ts', line: 1 },
  ...partial
});

describe('matchesComponent', () => {
  it('matches direct import', () => {
    const imp = makeImport({ moduleName: 'lodash' });
    const component: Component = { name: 'lodash', version: '4.17.21' };
    
    expect(matchesComponent(imp, component)).toBe(true);
  });

  it('matches subpath import', () => {
    const imp = makeImport({ moduleName: 'lodash/merge' });
    const component: Component = { name: 'lodash', version: '4.17.21' };
    
    expect(matchesComponent(imp, component)).toBe(true);
  });

  it('matches scoped package', () => {
    const imp = makeImport({ moduleName: '@babel/core' });
    const component: Component = { name: '@babel/core', version: '7.0.0' };
    
    expect(matchesComponent(imp, component)).toBe(true);
  });

  it('matches scoped package subpath', () => {
    const imp = makeImport({ moduleName: '@babel/core/lib/parse' });
    const component: Component = { name: '@babel/core', version: '7.0.0' };
    
    expect(matchesComponent(imp, component)).toBe(true);
  });

  it('does not match different packages', () => {
    const imp = makeImport({ moduleName: 'lodash' });
    const component: Component = { name: 'underscore', version: '1.0.0' };
    
    expect(matchesComponent(imp, component)).toBe(false);
  });

  it('does not match partial name', () => {
    const imp = makeImport({ moduleName: 'lodash-es' });
    const component: Component = { name: 'lodash', version: '4.17.21' };
    
    expect(matchesComponent(imp, component)).toBe(false);
  });
});

describe('findMatchingImports', () => {
  it('groups imports by component', () => {
    const imports: ImportInfo[] = [
      makeImport({ moduleName: 'lodash' }),
      makeImport({ moduleName: 'lodash/merge' }),
      makeImport({ moduleName: 'express' }),
    ];
    
    const components: Component[] = [
      { name: 'lodash', version: '4.17.21' },
      { name: 'express', version: '4.18.0' },
    ];
    
    const matches = findMatchingImports(imports, components);
    
    expect(matches.size).toBe(2);
    expect(matches.get(components[0])?.length).toBe(2); // lodash + lodash/merge
    expect(matches.get(components[1])?.length).toBe(1); // express
  });

  it('returns empty map for no matches', () => {
    const imports: ImportInfo[] = [
      makeImport({ moduleName: 'react' }),
    ];
    
    const components: Component[] = [
      { name: 'lodash', version: '4.17.21' },
    ];
    
    const matches = findMatchingImports(imports, components);
    
    expect(matches.size).toBe(0);
  });
});

describe('extractUsedMembers', () => {
  it('extracts named imports', () => {
    const imports: ImportInfo[] = [
      makeImport({ namedImports: ['merge', 'clone'] }),
      makeImport({ namedImports: ['template'] }),
    ];
    
    const members = extractUsedMembers(imports);
    
    expect(members).toContain('merge');
    expect(members).toContain('clone');
    expect(members).toContain('template');
  });

  it('deduplicates members', () => {
    const imports: ImportInfo[] = [
      makeImport({ namedImports: ['merge'] }),
      makeImport({ namedImports: ['merge'] }),
    ];
    
    const members = extractUsedMembers(imports);
    
    expect(members).toEqual(['merge']);
  });

  it('returns empty for namespace imports', () => {
    const imports: ImportInfo[] = [
      makeImport({ isNamespaceImport: true, localName: '_' }),
    ];
    
    const members = extractUsedMembers(imports);
    
    expect(members).toEqual([]);
  });
});

describe('usesAffectedFunctions', () => {
  it('detects affected function usage', () => {
    const imports: ImportInfo[] = [
      makeImport({ namedImports: ['merge', 'template'] }),
    ];
    
    const result = usesAffectedFunctions(imports, ['template', 'compile']);
    
    expect(result.matches).toBe(true);
    expect(result.usedFunctions).toEqual(['template']);
  });

  it('returns true for namespace import even without explicit match', () => {
    const imports: ImportInfo[] = [
      makeImport({ isNamespaceImport: true, localName: '_' }),
    ];
    
    const result = usesAffectedFunctions(imports, ['template']);
    
    expect(result.matches).toBe(true);
    expect(result.usedFunctions).toEqual([]);
  });

  it('returns true for default import', () => {
    const imports: ImportInfo[] = [
      makeImport({ isDefaultImport: true, localName: 'lodash' }),
    ];
    
    const result = usesAffectedFunctions(imports, ['template']);
    
    expect(result.matches).toBe(true);
  });

  it('returns false when no affected functions used', () => {
    const imports: ImportInfo[] = [
      makeImport({ namedImports: ['merge', 'clone'] }),
    ];
    
    const result = usesAffectedFunctions(imports, ['template']);
    
    expect(result.matches).toBe(false);
    expect(result.usedFunctions).toEqual([]);
  });
});

describe('getPrimaryImportStyle', () => {
  it('prefers ESM', () => {
    const imports: ImportInfo[] = [
      makeImport({ importStyle: 'commonjs' }),
      makeImport({ importStyle: 'esm' }),
    ];
    
    expect(getPrimaryImportStyle(imports)).toBe('esm');
  });

  it('falls back to commonjs', () => {
    const imports: ImportInfo[] = [
      makeImport({ importStyle: 'commonjs' }),
      makeImport({ importStyle: 'dynamic' }),
    ];
    
    expect(getPrimaryImportStyle(imports)).toBe('commonjs');
  });

  it('falls back to dynamic', () => {
    const imports: ImportInfo[] = [
      makeImport({ importStyle: 'dynamic' }),
    ];
    
    expect(getPrimaryImportStyle(imports)).toBe('dynamic');
  });

  it('returns require as last resort', () => {
    const imports: ImportInfo[] = [];
    
    expect(getPrimaryImportStyle(imports)).toBe('require');
  });
});
