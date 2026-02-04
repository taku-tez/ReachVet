/**
 * ReachVet - Call Graph Analysis Tests
 */

import { describe, it, expect } from 'vitest';
import { analyzeCallGraph, checkImportedMembersCalled } from '../languages/javascript/callgraph.js';

describe('analyzeCallGraph', () => {
  describe('simple function calls', () => {
    it('should detect direct function calls', () => {
      const source = `
        import { merge, clone } from 'lodash';
        const result = merge({}, {});
      `;
      const result = analyzeCallGraph(source);
      
      expect(result.calledFunctions.has('merge')).toBe(true);
      expect(result.calledFunctions.has('clone')).toBe(false);
    });

    it('should detect multiple calls to same function', () => {
      const source = `
        merge({}, {});
        merge({}, {});
        merge({}, {});
      `;
      const result = analyzeCallGraph(source);
      
      expect(result.calls.filter(c => c.callee === 'merge')).toHaveLength(3);
    });
  });

  describe('method calls', () => {
    it('should detect method calls on objects', () => {
      const source = `
        import * as _ from 'lodash';
        _.merge({}, {});
        _.template('<%= name %>');
      `;
      const result = analyzeCallGraph(source);
      
      expect(result.calledFunctions.has('_.merge')).toBe(true);
      expect(result.calledFunctions.has('_.template')).toBe(true);
    });

    it('should detect chained method calls', () => {
      const source = `
        import axios from 'axios';
        axios.get('/api').then(res => res.data);
      `;
      const result = analyzeCallGraph(source);
      
      expect(result.calledFunctions.has('axios.get')).toBe(true);
      expect(result.calledFunctions.has('then')).toBe(true);
    });
  });

  describe('constructor calls', () => {
    it('should detect new expressions', () => {
      const source = `
        import { EventEmitter } from 'events';
        const emitter = new EventEmitter();
      `;
      const result = analyzeCallGraph(source);
      
      expect(result.calledFunctions.has('EventEmitter')).toBe(true);
      const call = result.calls.find(c => c.callee === 'EventEmitter');
      expect(call?.isConstructor).toBe(true);
    });
  });

  describe('element access calls', () => {
    it('should detect bracket notation calls', () => {
      const source = `
        const obj = {};
        obj['dynamicMethod']();
      `;
      const result = analyzeCallGraph(source);
      
      expect(result.calledFunctions.has('dynamicMethod')).toBe(true);
    });
  });

  describe('references vs calls', () => {
    it('should distinguish between calls and references', () => {
      const source = `
        import { merge, clone, template } from 'lodash';
        
        // Called
        merge({}, {});
        
        // Referenced but not called (passed as callback)
        const callback = clone;
        
        // Neither called nor referenced
        // template is imported but never used
      `;
      const result = analyzeCallGraph(source);
      
      expect(result.calledFunctions.has('merge')).toBe(true);
      expect(result.calledFunctions.has('clone')).toBe(false);
      expect(result.references.has('clone')).toBe(true);
    });
  });
});

describe('dynamic code detection', () => {
  it('should detect direct eval', () => {
    const source = `eval('console.log("hello")');`;
    const result = analyzeCallGraph(source);
    
    expect(result.dynamicCodeWarnings).toHaveLength(1);
    expect(result.dynamicCodeWarnings[0].type).toBe('eval');
  });

  it('should detect Function constructor', () => {
    const source = `const fn = new Function('return 42');`;
    const result = analyzeCallGraph(source);
    
    expect(result.dynamicCodeWarnings).toHaveLength(1);
    expect(result.dynamicCodeWarnings[0].type).toBe('Function');
  });

  it('should detect setTimeout with string', () => {
    const source = `setTimeout('alert("hello")', 1000);`;
    const result = analyzeCallGraph(source);
    
    expect(result.dynamicCodeWarnings).toHaveLength(1);
    expect(result.dynamicCodeWarnings[0].type).toBe('setTimeout_string');
  });

  it('should detect indirect eval', () => {
    const source = `(0, eval)('code');`;
    const result = analyzeCallGraph(source);
    
    expect(result.dynamicCodeWarnings).toHaveLength(1);
    expect(result.dynamicCodeWarnings[0].type).toBe('indirect_eval');
  });

  it('should not warn for setTimeout with function', () => {
    const source = `setTimeout(() => console.log('hi'), 1000);`;
    const result = analyzeCallGraph(source);
    
    expect(result.dynamicCodeWarnings).toHaveLength(0);
  });
});

describe('checkImportedMembersCalled', () => {
  it('should categorize imported members', () => {
    const source = `
      import { merge, clone, template, debounce } from 'lodash';
      merge({}, {});
      const cb = clone;
      // template and debounce unused
    `;
    const callGraph = analyzeCallGraph(source);
    const result = checkImportedMembersCalled(
      ['merge', 'clone', 'template', 'debounce'],
      callGraph
    );
    
    expect(result.called).toContain('merge');
    expect(result.uncertain).toContain('clone');
    expect(result.notCalled).toContain('template');
    expect(result.notCalled).toContain('debounce');
  });

  it('should handle namespace imports', () => {
    const source = `
      import * as _ from 'lodash';
      _.merge({}, {});
    `;
    const callGraph = analyzeCallGraph(source);
    const result = checkImportedMembersCalled(
      ['merge', 'clone'],
      callGraph,
      '_'
    );
    
    expect(result.called).toContain('merge');
    expect(result.notCalled).toContain('clone');
  });
});
