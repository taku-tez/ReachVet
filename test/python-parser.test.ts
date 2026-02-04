/**
 * ReachVet - Python Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { parsePythonSource, findModuleUsages, normalizePackageName, detectDynamicImports } from '../src/languages/python/parser.js';
import { matchesComponent, extractUsedMembers, getPrimaryImportStyle, detectDangerousPatterns } from '../src/languages/python/detector.js';
import type { Component } from '../src/types.js';

describe('Python Parser', () => {
  describe('parsePythonSource', () => {
    it('parses simple import statements', () => {
      const source = `
import os
import sys
import json
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(3);
      expect(imports[0].module).toBe('os');
      expect(imports[0].importStyle).toBe('import');
      expect(imports[1].module).toBe('sys');
      expect(imports[2].module).toBe('json');
    });

    it('parses import with alias', () => {
      const source = `
import numpy as np
import pandas as pd
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(2);
      expect(imports[0].module).toBe('numpy');
      expect(imports[0].alias).toBe('np');
      expect(imports[1].module).toBe('pandas');
      expect(imports[1].alias).toBe('pd');
    });

    it('parses submodule imports', () => {
      const source = `
import os.path
import urllib.parse
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(2);
      expect(imports[0].module).toBe('os');
      expect(imports[0].submodule).toBe('path');
      expect(imports[1].module).toBe('urllib');
      expect(imports[1].submodule).toBe('parse');
    });

    it('parses from ... import statements', () => {
      const source = `
from os import path, getcwd
from json import loads, dumps
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(2);
      expect(imports[0].module).toBe('os');
      expect(imports[0].members).toEqual(['path', 'getcwd']);
      expect(imports[0].importStyle).toBe('from');
      expect(imports[1].module).toBe('json');
      expect(imports[1].members).toEqual(['loads', 'dumps']);
    });

    it('parses from ... import with aliases', () => {
      const source = `
from collections import defaultdict as dd, OrderedDict as OD
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(1);
      expect(imports[0].module).toBe('collections');
      expect(imports[0].members).toEqual(['defaultdict', 'OrderedDict']);
    });

    it('parses star imports', () => {
      const source = `
from math import *
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(1);
      expect(imports[0].module).toBe('math');
      expect(imports[0].isStarImport).toBe(true);
    });

    it('parses nested submodule from imports', () => {
      const source = `
from urllib.parse import urlparse, urlencode
from xml.etree.ElementTree import parse
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(2);
      expect(imports[0].module).toBe('urllib');
      expect(imports[0].submodule).toBe('parse');
      expect(imports[0].members).toEqual(['urlparse', 'urlencode']);
    });

    it('handles comments and empty lines', () => {
      const source = `
# This is a comment
import os  # inline comment

# Another comment
import sys
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(2);
      expect(imports[0].module).toBe('os');
      expect(imports[1].module).toBe('sys');
    });

    it('parses multiple imports on same line', () => {
      const source = `
import os, sys, json
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(3);
      expect(imports[0].module).toBe('os');
      expect(imports[1].module).toBe('sys');
      expect(imports[2].module).toBe('json');
    });

    it('handles multi-line imports with parentheses', () => {
      const source = `
from collections import (
    defaultdict,
    OrderedDict,
    Counter
)
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(1);
      expect(imports[0].module).toBe('collections');
      expect(imports[0].members).toContain('defaultdict');
      expect(imports[0].members).toContain('OrderedDict');
      expect(imports[0].members).toContain('Counter');
    });

    it('handles line continuation with backslash', () => {
      const source = `
from collections import defaultdict, \\
    OrderedDict, Counter
`;
      const imports = parsePythonSource(source, 'test.py');
      expect(imports).toHaveLength(1);
      expect(imports[0].members).toContain('defaultdict');
    });
  });

  describe('findModuleUsages', () => {
    it('finds attribute accesses', () => {
      const source = `
import os
print(os.path.exists('/tmp'))
os.getcwd()
os.listdir('.')
`;
      const usages = findModuleUsages(source, 'os');
      expect(usages).toContain('path');
      expect(usages).toContain('getcwd');
      expect(usages).toContain('listdir');
    });

    it('finds usages with alias', () => {
      const source = `
import numpy as np
arr = np.array([1, 2, 3])
mean = np.mean(arr)
`;
      const usages = findModuleUsages(source, 'numpy', 'np');
      expect(usages).toContain('array');
      expect(usages).toContain('mean');
    });

    it('handles nested module paths', () => {
      const source = `
import urllib.parse
url = urllib.parse.urlparse('http://example.com')
`;
      const usages = findModuleUsages(source, 'urllib.parse');
      expect(usages).toContain('urlparse');
    });
  });

  describe('normalizePackageName', () => {
    it('converts hyphens to underscores', () => {
      expect(normalizePackageName('some-package')).toBe('some_package');
    });

    it('lowercases names', () => {
      expect(normalizePackageName('SomePackage')).toBe('somepackage');
    });
  });
});

describe('Python Detector', () => {
  describe('matchesComponent', () => {
    it('matches direct import', () => {
      const imp = { module: 'requests', importStyle: 'import' as const, location: { file: 'test.py', line: 1 } };
      const component: Component = { name: 'requests', version: '2.28.0' };
      expect(matchesComponent(imp, component)).toBe(true);
    });

    it('matches with purl', () => {
      const imp = { module: 'requests', importStyle: 'import' as const, location: { file: 'test.py', line: 1 } };
      const component: Component = { name: 'Requests', version: '2.28.0', purl: 'pkg:pypi/requests@2.28.0' };
      expect(matchesComponent(imp, component)).toBe(true);
    });

    it('handles hyphen/underscore differences', () => {
      const imp = { module: 'python_dateutil', importStyle: 'import' as const, location: { file: 'test.py', line: 1 } };
      const component: Component = { name: 'python-dateutil', version: '2.8.0' };
      expect(matchesComponent(imp, component)).toBe(true);
    });

    it('handles known aliases (Pillow -> PIL)', () => {
      const imp = { module: 'pil', importStyle: 'import' as const, location: { file: 'test.py', line: 1 } };
      const component: Component = { name: 'Pillow', version: '9.0.0' };
      expect(matchesComponent(imp, component)).toBe(true);
    });

    it('handles known aliases (PyYAML -> yaml)', () => {
      const imp = { module: 'yaml', importStyle: 'import' as const, location: { file: 'test.py', line: 1 } };
      const component: Component = { name: 'PyYAML', version: '6.0' };
      expect(matchesComponent(imp, component)).toBe(true);
    });

    it('does not match unrelated packages', () => {
      const imp = { module: 'flask', importStyle: 'import' as const, location: { file: 'test.py', line: 1 } };
      const component: Component = { name: 'django', version: '4.0.0' };
      expect(matchesComponent(imp, component)).toBe(false);
    });
  });

  describe('extractUsedMembers', () => {
    it('extracts members from from-imports', () => {
      const imports = [
        { module: 'os', members: ['path', 'getcwd'], importStyle: 'from' as const, location: { file: 'test.py', line: 1 } },
        { module: 'json', members: ['loads', 'dumps'], importStyle: 'from' as const, location: { file: 'test.py', line: 2 } }
      ];
      const members = extractUsedMembers(imports);
      expect(members).toContain('path');
      expect(members).toContain('getcwd');
      expect(members).toContain('loads');
      expect(members).toContain('dumps');
    });
  });

  describe('getPrimaryImportStyle', () => {
    it('returns from when majority are from-imports', () => {
      const imports = [
        { module: 'os', importStyle: 'from' as const, location: { file: 'test.py', line: 1 } },
        { module: 'json', importStyle: 'from' as const, location: { file: 'test.py', line: 2 } },
        { module: 'sys', importStyle: 'import' as const, location: { file: 'test.py', line: 3 } }
      ];
      expect(getPrimaryImportStyle(imports)).toBe('from');
    });
  });

  describe('detectDangerousPatterns', () => {
    it('detects star imports', () => {
      const imports = [
        { module: 'math', isStarImport: true, importStyle: 'from' as const, location: { file: 'test.py', line: 1 } }
      ];
      const warnings = detectDangerousPatterns(imports);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Star import');
    });
  });
});

// Dynamic import detection tests
describe('detectDynamicImports', () => {
  it('should detect __import__', () => {
    const source = `
module = __import__('requests')
`;
    const warnings = detectDynamicImports(source, 'test.py');
    
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('__import__');
    expect(warnings[0].module).toBe('requests');
  });

  it('should detect importlib.import_module', () => {
    const source = `
import importlib
mod = importlib.import_module('numpy')
`;
    const warnings = detectDynamicImports(source, 'test.py');
    
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('importlib');
    expect(warnings[0].module).toBe('numpy');
  });

  it('should detect exec with import', () => {
    const source = `
exec("import os")
`;
    const warnings = detectDynamicImports(source, 'test.py');
    
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('exec');
  });
});
