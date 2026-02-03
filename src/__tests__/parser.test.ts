/**
 * ReachVet Parser Tests - CommonJS Destructuring & Import Patterns
 */

import { describe, it, expect } from 'vitest';
import { parseSource, findNamespaceUsages } from '../languages/javascript/parser.js';

describe('ESM imports', () => {
  it('parses default import', () => {
    const source = `import lodash from 'lodash';`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('lodash');
    expect(imports[0].importStyle).toBe('esm');
    expect(imports[0].isDefaultImport).toBe(true);
    expect(imports[0].localName).toBe('lodash');
  });

  it('parses named imports', () => {
    const source = `import { merge, clone } from 'lodash';`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].namedImports).toEqual(['merge', 'clone']);
  });

  it('parses namespace import', () => {
    const source = `import * as _ from 'lodash';`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespaceImport).toBe(true);
    expect(imports[0].localName).toBe('_');
  });
});

describe('CommonJS require - Basic', () => {
  it('parses simple require', () => {
    const source = `const lodash = require('lodash');`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('lodash');
    expect(imports[0].importStyle).toBe('commonjs');
    expect(imports[0].localName).toBe('lodash');
    expect(imports[0].isDefaultImport).toBe(true);
  });

  it('parses require without assignment', () => {
    const source = `require('side-effect-module');`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('side-effect-module');
    expect(imports[0].importStyle).toBe('commonjs');
  });
});

describe('CommonJS require - Destructuring', () => {
  it('parses destructured require', () => {
    const source = `const { merge, clone } = require('lodash');`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('lodash');
    expect(imports[0].importStyle).toBe('commonjs');
    expect(imports[0].namedImports).toEqual(['merge', 'clone']);
  });

  it('parses destructured require with rename', () => {
    const source = `const { merge: myMerge, clone } = require('lodash');`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].namedImports).toEqual(['merge', 'clone']);
  });

  it('parses property access require', () => {
    const source = `const merge = require('lodash').merge;`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('lodash');
    expect(imports[0].namedImports).toEqual(['merge']);
    expect(imports[0].localName).toBe('merge');
  });

  it('parses subpath require', () => {
    const source = `const merge = require('lodash/merge');`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('lodash/merge');
    expect(imports[0].localName).toBe('merge');
  });
});

describe('Dynamic imports', () => {
  it('parses dynamic import', () => {
    const source = `const mod = await import('lodash');`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('lodash');
    expect(imports[0].importStyle).toBe('dynamic');
  });

  it('parses dynamic import in function', () => {
    const source = `
      async function load() {
        const { merge } = await import('lodash');
        return merge;
      }
    `;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].importStyle).toBe('dynamic');
  });
});

describe('Re-exports', () => {
  it('parses named re-export', () => {
    const source = `export { merge, clone } from 'lodash';`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('lodash');
    expect(imports[0].namedImports).toEqual(['merge', 'clone']);
  });

  it('parses namespace re-export', () => {
    const source = `export * from 'lodash';`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('lodash');
  });
});

describe('Mixed patterns', () => {
  it('handles multiple import styles in same file', () => {
    const source = `
      import express from 'express';
      const { merge } = require('lodash');
      const axios = require('axios').default;
      import('dynamic-module');
    `;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(4);
    expect(imports.map(i => i.importStyle)).toEqual(['esm', 'commonjs', 'commonjs', 'dynamic']);
  });
});

describe('Namespace usage tracking', () => {
  it('finds property accesses on namespace import', () => {
    const source = `
      import * as _ from 'lodash';
      const result = _.merge({}, {});
      const tmpl = _.template('<%= name %>');
    `;
    const usages = findNamespaceUsages(source, ['_']);
    
    expect(usages).toContain('merge');
    expect(usages).toContain('template');
  });

  it('finds property accesses on default import', () => {
    const source = `
      import lodash from 'lodash';
      lodash.clone({});
      lodash.cloneDeep({});
    `;
    const usages = findNamespaceUsages(source, ['lodash']);
    
    expect(usages).toContain('clone');
    expect(usages).toContain('cloneDeep');
  });

  it('handles element access syntax', () => {
    const source = `
      import * as utils from 'utils';
      utils['dynamicMethod']();
      utils["anotherMethod"]();
    `;
    const usages = findNamespaceUsages(source, ['utils']);
    
    expect(usages).toContain('dynamicMethod');
    expect(usages).toContain('anotherMethod');
  });

  it('ignores unrelated identifiers', () => {
    const source = `
      import * as _ from 'lodash';
      import * as other from 'other';
      _.merge({}, {});
      other.something();
    `;
    const usages = findNamespaceUsages(source, ['_']);
    
    expect(usages).toContain('merge');
    expect(usages).not.toContain('something');
  });

  it('handles CommonJS namespace-like usage', () => {
    const source = `
      const _ = require('lodash');
      _.template('<%= x %>');
      _.merge({}, {});
    `;
    const usages = findNamespaceUsages(source, ['_']);
    
    expect(usages).toContain('template');
    expect(usages).toContain('merge');
  });
});

describe('Edge cases', () => {
  it('handles nested destructuring', () => {
    const source = `const { a: { b } } = require('complex');`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    // Should at least detect the module, even if nested destructuring is complex
    expect(imports[0].moduleName).toBe('complex');
  });

  it('handles inline require in expression', () => {
    const source = `console.log(require('logger'));`;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleName).toBe('logger');
    expect(imports[0].importStyle).toBe('commonjs');
  });

  it('handles scoped packages', () => {
    const source = `
      import { something } from '@org/package';
      const other = require('@scope/module/subpath');
    `;
    const imports = parseSource(source);
    
    expect(imports).toHaveLength(2);
    expect(imports[0].moduleName).toBe('@org/package');
    expect(imports[1].moduleName).toBe('@scope/module/subpath');
  });
});
