/**
 * ReachVet - Haskell Parser Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseHaskellSource,
  parseCabalFile,
  parseStackYaml,
  findUsages,
  isStdModule,
  moduleToPackages,
} from '../src/languages/haskell/parser.js';

describe('Haskell Import Parser', () => {
  describe('parseHaskellSource', () => {
    it('should parse simple import', () => {
      const source = `
module Main where

import Data.List
import Data.Maybe
      `;
      
      const imports = parseHaskellSource(source, 'Main.hs');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].moduleName).toBe('Data.List');
      expect(imports[1].moduleName).toBe('Data.Maybe');
    });

    it('should parse qualified import', () => {
      const source = `
module Main where

import qualified Data.Map as Map
import qualified Data.Text
      `;
      
      const imports = parseHaskellSource(source, 'Main.hs');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].moduleName).toBe('Data.Map');
      expect(imports[0].qualified).toBe(true);
      expect(imports[0].alias).toBe('Map');
      expect(imports[1].moduleName).toBe('Data.Text');
      expect(imports[1].qualified).toBe(true);
      expect(imports[1].alias).toBeUndefined();
    });

    it('should parse import with explicit list', () => {
      const source = `
module Main where

import Data.Maybe (fromMaybe, maybe, isJust)
import Control.Monad (when, unless, forM)
      `;
      
      const imports = parseHaskellSource(source, 'Main.hs');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].moduleName).toBe('Data.Maybe');
      expect(imports[0].importList).toEqual(['fromMaybe', 'maybe', 'isJust']);
      expect(imports[1].moduleName).toBe('Control.Monad');
      expect(imports[1].importList).toEqual(['when', 'unless', 'forM']);
    });

    it('should parse import with hiding', () => {
      const source = `
module Main where

import Prelude hiding (map, filter)
import Data.List hiding (head, tail)
      `;
      
      const imports = parseHaskellSource(source, 'Main.hs');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].moduleName).toBe('Prelude');
      expect(imports[0].hidingList).toEqual(['map', 'filter']);
      expect(imports[1].moduleName).toBe('Data.List');
      expect(imports[1].hidingList).toEqual(['head', 'tail']);
    });

    it('should parse multiline import list', () => {
      const source = `
module Main where

import Data.Maybe
  ( fromMaybe
  , maybe
  , isJust
  , isNothing
  )
      `;
      
      const imports = parseHaskellSource(source, 'Main.hs');
      
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleName).toBe('Data.Maybe');
      expect(imports[0].importList).toEqual(['fromMaybe', 'maybe', 'isJust', 'isNothing']);
    });

    it('should parse import with type/constructor list', () => {
      const source = `
module Main where

import Data.Map (Map, empty, fromList)
import Control.Monad.Reader (Reader(..), runReader)
import Data.Text (Text)
      `;
      
      const imports = parseHaskellSource(source, 'Main.hs');
      
      expect(imports).toHaveLength(3);
      expect(imports[0].importList).toContain('Map');
      expect(imports[0].importList).toContain('empty');
      expect(imports[1].importList).toContain('Reader(..)');
    });

    it('should handle comments', () => {
      const source = `
module Main where

-- This is a comment
import Data.List -- inline comment
import Data.Maybe
{- block comment -}
import Data.Text
      `;
      
      const imports = parseHaskellSource(source, 'Main.hs');
      
      expect(imports).toHaveLength(3);
      expect(imports.map(i => i.moduleName)).toEqual(['Data.List', 'Data.Maybe', 'Data.Text']);
    });

    it('should parse package import', () => {
      const source = `
module Main where

import "text" Data.Text
import "containers" Data.Map as M
      `;
      
      const imports = parseHaskellSource(source, 'Main.hs');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].packageImport).toBe('text');
      expect(imports[0].moduleName).toBe('Data.Text');
      expect(imports[1].packageImport).toBe('containers');
      expect(imports[1].alias).toBe('M');
    });

    it('should stop parsing at first function definition', () => {
      const source = `
module Main where

import Data.List

main :: IO ()
main = print "hello"

-- This should not be parsed
import Data.Fake
      `;
      
      const imports = parseHaskellSource(source, 'Main.hs');
      
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleName).toBe('Data.List');
    });
  });

  describe('isStdModule', () => {
    it('should recognize standard library modules', () => {
      expect(isStdModule('Prelude')).toBe(true);
      expect(isStdModule('Data.List')).toBe(true);
      expect(isStdModule('Control.Monad')).toBe(true);
      expect(isStdModule('System.IO')).toBe(true);
      expect(isStdModule('GHC.Base')).toBe(true);
    });

    it('should recognize submodules of std modules', () => {
      expect(isStdModule('Data.List.NonEmpty')).toBe(true);
      expect(isStdModule('Control.Monad.IO.Class')).toBe(true);
    });

    it('should not recognize external packages', () => {
      expect(isStdModule('Data.Text')).toBe(false);
      expect(isStdModule('Data.Aeson')).toBe(false);
      expect(isStdModule('Network.HTTP.Client')).toBe(false);
    });
  });

  describe('moduleToPackages', () => {
    it('should map modules to packages', () => {
      expect(moduleToPackages('Data.Text')).toContain('text');
      expect(moduleToPackages('Data.Map')).toContain('containers');
      expect(moduleToPackages('Data.Aeson')).toContain('aeson');
      expect(moduleToPackages('Data.ByteString')).toContain('bytestring');
    });

    it('should map submodules', () => {
      expect(moduleToPackages('Data.Text.Lazy')).toContain('text');
      expect(moduleToPackages('Data.Map.Strict')).toContain('containers');
    });

    it('should return empty for unknown modules', () => {
      expect(moduleToPackages('Some.Unknown.Module')).toHaveLength(0);
    });
  });
});

describe('Cabal Parser', () => {
  describe('parseCabalFile', () => {
    it('should parse basic cabal file', () => {
      const content = `
name:           my-package
version:        0.1.0.0
synopsis:       A test package

library
  exposed-modules:     MyModule
  build-depends:       base >=4.7 && <5, text, containers
      `;
      
      const cabal = parseCabalFile(content);
      
      expect(cabal.name).toBe('my-package');
      expect(cabal.version).toBe('0.1.0.0');
      expect(cabal.dependencies).toHaveLength(3);
      expect(cabal.dependencies.map(d => d.name)).toContain('base');
      expect(cabal.dependencies.map(d => d.name)).toContain('text');
      expect(cabal.dependencies.map(d => d.name)).toContain('containers');
    });

    it('should parse version constraints', () => {
      const content = `
name:           test
version:        1.0.0

library
  build-depends:
    base >=4.7 && <5,
    text >=1.2,
    aeson ==2.0.*
      `;
      
      const cabal = parseCabalFile(content);
      
      const baseDep = cabal.dependencies.find(d => d.name === 'base');
      expect(baseDep?.version).toBe('>=4.7 && <5');
      
      const aesonDep = cabal.dependencies.find(d => d.name === 'aeson');
      expect(aesonDep?.version).toBe('==2.0.*');
    });

    it('should parse multiple sections', () => {
      const content = `
name:           test
version:        1.0.0

library
  build-depends:       base, text

executable my-exe
  build-depends:       base, optparse-applicative

test-suite my-tests
  build-depends:       base, hspec
      `;
      
      const cabal = parseCabalFile(content);
      
      // Should collect deps from all sections
      const depNames = cabal.dependencies.map(d => d.name);
      expect(depNames).toContain('base');
      expect(depNames).toContain('text');
      expect(depNames).toContain('optparse-applicative');
      expect(depNames).toContain('hspec');
    });

    it('should parse exposed-modules', () => {
      const content = `
name:           test
version:        1.0.0

library
  exposed-modules:     Module.One, Module.Two, Module.Three
  build-depends:       base
      `;
      
      const cabal = parseCabalFile(content);
      
      expect(cabal.exposedModules).toEqual(['Module.One', 'Module.Two', 'Module.Three']);
    });

    it('should handle comments', () => {
      const content = `
name:           test
version:        1.0.0
-- This is a comment

library
  build-depends:       base -- inline comment
      `;
      
      const cabal = parseCabalFile(content);
      
      expect(cabal.name).toBe('test');
      expect(cabal.dependencies).toHaveLength(1);
    });
  });
});

describe('Stack Parser', () => {
  describe('parseStackYaml', () => {
    it('should parse basic stack.yaml', () => {
      const content = `
resolver: lts-20.0

packages:
- .

extra-deps:
- some-package-1.0.0
- another-package-2.0.0
      `;
      
      const stack = parseStackYaml(content);
      
      expect(stack.resolver).toBe('lts-20.0');
      expect(stack.packages).toEqual(['.']);
      expect(stack.extraDeps).toHaveLength(2);
      expect(stack.extraDeps[0].name).toBe('some-package');
      expect(stack.extraDeps[0].version).toBe('1.0.0');
    });

    it('should parse nightly resolver', () => {
      const content = `
resolver: nightly-2023-12-01
packages:
- .
      `;
      
      const stack = parseStackYaml(content);
      
      expect(stack.resolver).toBe('nightly-2023-12-01');
    });

    it('should parse inline list', () => {
      const content = `
resolver: lts-20.0
packages: ['.', './subpackage']
extra-deps: []
      `;
      
      const stack = parseStackYaml(content);
      
      expect(stack.packages).toEqual(['.', './subpackage']);
      expect(stack.extraDeps).toHaveLength(0);
    });

    it('should handle comments', () => {
      const content = `
# Stack configuration
resolver: lts-20.0

packages:
- . # main package

# Extra dependencies
extra-deps: []
      `;
      
      const stack = parseStackYaml(content);
      
      expect(stack.resolver).toBe('lts-20.0');
      expect(stack.packages).toEqual(['.']);
    });
  });
});

describe('findUsages', () => {
  it('should find qualified usages', () => {
    const source = `
module Main where

import qualified Data.Map as Map
import qualified Data.Text as T

main = do
  let m = Map.empty
  let t = T.pack "hello"
  print (Map.lookup "key" m)
    `;
    
    const imports = parseHaskellSource(source, 'Main.hs');
    const usages = findUsages(source, 'Main.hs', imports);
    
    expect(usages.has('Data.Map.empty')).toBe(true);
    expect(usages.has('Data.Map.lookup')).toBe(true);
    expect(usages.has('Data.Text.pack')).toBe(true);
  });

  it('should find module prefix usages', () => {
    const source = `
module Main where

import Data.List

main = do
  let xs = List.sort [3, 1, 2]
  print xs
    `;
    
    const imports = parseHaskellSource(source, 'Main.hs');
    const usages = findUsages(source, 'Main.hs', imports);
    
    expect(usages.has('Data.List.sort')).toBe(true);
  });
});
