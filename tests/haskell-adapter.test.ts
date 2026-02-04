/**
 * ReachVet - Haskell Adapter Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HaskellLanguageAdapter, createHaskellAdapter } from '../src/languages/haskell/index.js';
import type { Component } from '../src/types.js';

describe('HaskellLanguageAdapter', () => {
  let adapter: HaskellLanguageAdapter;
  let testDir: string;

  beforeAll(async () => {
    adapter = createHaskellAdapter();
    testDir = join(tmpdir(), `reachvet-haskell-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('canHandle', () => {
    it('should detect Haskell project with .cabal file', async () => {
      const projectDir = join(testDir, 'cabal-project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(join(projectDir, 'my-project.cabal'), `
name:           my-project
version:        0.1.0.0
      `);
      
      expect(await adapter.canHandle(projectDir)).toBe(true);
    });

    it('should detect Haskell project with stack.yaml', async () => {
      const projectDir = join(testDir, 'stack-project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(join(projectDir, 'stack.yaml'), `
resolver: lts-20.0
packages:
- .
      `);
      
      expect(await adapter.canHandle(projectDir)).toBe(true);
    });

    it('should detect Haskell project with .hs files', async () => {
      const projectDir = join(testDir, 'hs-only');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(join(projectDir, 'Main.hs'), `
module Main where
main = print "hello"
      `);
      
      expect(await adapter.canHandle(projectDir)).toBe(true);
    });

    it('should not detect non-Haskell project', async () => {
      const projectDir = join(testDir, 'not-haskell');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(join(projectDir, 'main.py'), 'print("hello")');
      
      expect(await adapter.canHandle(projectDir)).toBe(false);
    });
  });

  describe('analyze', () => {
    it('should detect reachable package with qualified import', async () => {
      const projectDir = join(testDir, 'text-project');
      await fs.mkdir(join(projectDir, 'src'), { recursive: true });
      
      // Create cabal file
      await fs.writeFile(join(projectDir, 'test.cabal'), `
name:           test
version:        0.1.0.0

library
  build-depends:       base >=4.7 && <5, text
      `);
      
      // Create source file
      await fs.writeFile(join(projectDir, 'src', 'Main.hs'), `
module Main where

import qualified Data.Text as T
import Data.Text (Text)

greet :: Text -> Text
greet name = T.append "Hello, " name

main :: IO ()
main = print (T.unpack (greet (T.pack "World")))
      `);
      
      const components: Component[] = [
        { name: 'text', version: '2.0.1' }
      ];
      
      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].usage?.usedMembers).toContain('append');
      expect(results[0].usage?.usedMembers).toContain('pack');
      expect(results[0].usage?.usedMembers).toContain('unpack');
    });

    it('should detect imported package without specific usage', async () => {
      const projectDir = join(testDir, 'import-only');
      await fs.mkdir(join(projectDir, 'src'), { recursive: true });
      
      await fs.writeFile(join(projectDir, 'test.cabal'), `
name:           test
version:        0.1.0.0

library
  build-depends:       base, containers
      `);
      
      await fs.writeFile(join(projectDir, 'src', 'Lib.hs'), `
module Lib where

import Data.Map (Map)

type MyMap = Map String Int
      `);
      
      const components: Component[] = [
        { name: 'containers', version: '0.6.7' }
      ];
      
      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('imported');
    });

    it('should detect not_reachable for unlisted package', async () => {
      const projectDir = join(testDir, 'not-listed');
      await fs.mkdir(join(projectDir, 'src'), { recursive: true });
      
      await fs.writeFile(join(projectDir, 'test.cabal'), `
name:           test
version:        0.1.0.0

library
  build-depends:       base
      `);
      
      await fs.writeFile(join(projectDir, 'src', 'Main.hs'), `
module Main where

main = print "hello"
      `);
      
      const components: Component[] = [
        { name: 'aeson', version: '2.1.0' }
      ];
      
      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_reachable');
    });

    it('should detect vulnerable functions', async () => {
      const projectDir = join(testDir, 'vulnerable');
      await fs.mkdir(join(projectDir, 'src'), { recursive: true });
      
      await fs.writeFile(join(projectDir, 'test.cabal'), `
name:           test
version:        0.1.0.0

library
  build-depends:       base, yaml
      `);
      
      await fs.writeFile(join(projectDir, 'src', 'Config.hs'), `
module Config where

import qualified Data.Yaml as Yaml
import Data.Yaml (decodeFileThrow)

loadConfig :: FilePath -> IO Config
loadConfig path = Yaml.decodeFileThrow path
      `);
      
      const components: Component[] = [
        { 
          name: 'yaml', 
          version: '0.11.0',
          vulnerabilities: [{
            id: 'CVE-2022-12345',
            severity: 'high',
            affectedFunctions: ['decodeFileThrow', 'decode']
          }]
        }
      ];
      
      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].confidence).toBe('high');
      expect(results[0].usage?.usedMembers).toContain('decodeFileThrow');
      expect(results[0].notes?.[0]).toContain('Vulnerable function');
    });

    it('should work with stack.yaml projects', async () => {
      const projectDir = join(testDir, 'stack-project-analyze');
      await fs.mkdir(join(projectDir, 'src'), { recursive: true });
      
      await fs.writeFile(join(projectDir, 'stack.yaml'), `
resolver: lts-20.0
packages:
- .
extra-deps:
- aeson-2.1.0.0
      `);
      
      await fs.writeFile(join(projectDir, 'test.cabal'), `
name:           test
version:        0.1.0.0

library
  build-depends:       base, aeson
      `);
      
      await fs.writeFile(join(projectDir, 'src', 'Json.hs'), `
module Json where

import qualified Data.Aeson as A
import Data.Aeson (ToJSON, FromJSON)

parseJson :: A.FromJSON a => String -> Maybe a
parseJson = A.decode . A.encodeUtf8
      `);
      
      const components: Component[] = [
        { name: 'aeson', version: '2.1.0' }
      ];
      
      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should detect multiple packages', async () => {
      const projectDir = join(testDir, 'multi-package');
      await fs.mkdir(join(projectDir, 'src'), { recursive: true });
      
      await fs.writeFile(join(projectDir, 'test.cabal'), `
name:           test
version:        0.1.0.0

library
  build-depends:
    base,
    text,
    bytestring,
    containers,
    vector
      `);
      
      await fs.writeFile(join(projectDir, 'src', 'Lib.hs'), `
module Lib where

import qualified Data.Text as T
import qualified Data.ByteString as BS
import qualified Data.Map as Map

processText :: T.Text -> T.Text
processText = T.toUpper

processBytes :: BS.ByteString -> Int
processBytes = BS.length

processMap :: Map.Map String Int -> Maybe Int
processMap m = Map.lookup "key" m
      `);
      
      const components: Component[] = [
        { name: 'text', version: '2.0.1' },
        { name: 'bytestring', version: '0.11.4' },
        { name: 'containers', version: '0.6.7' },
        { name: 'vector', version: '0.13.0' },  // Not used
      ];
      
      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(4);
      
      const textResult = results.find(r => r.component.name === 'text');
      expect(textResult?.status).toBe('reachable');
      
      const bsResult = results.find(r => r.component.name === 'bytestring');
      expect(bsResult?.status).toBe('reachable');
      
      const contResult = results.find(r => r.component.name === 'containers');
      expect(contResult?.status).toBe('reachable');
      
      const vecResult = results.find(r => r.component.name === 'vector');
      // Vector is in deps but not imported
      expect(vecResult?.status).toBe('not_reachable');
    });
  });

  describe('language property', () => {
    it('should have correct language', () => {
      expect(adapter.language).toBe('haskell');
    });

    it('should have correct file extensions', () => {
      expect(adapter.fileExtensions).toContain('.hs');
      expect(adapter.fileExtensions).toContain('.lhs');
    });
  });
});
