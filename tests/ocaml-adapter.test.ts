/**
 * ReachVet - OCaml Adapter Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { OCamlLanguageAdapter, createOCamlAdapter } from '../src/languages/ocaml/index.js';
import type { Component } from '../src/types.js';

describe('OCaml Language Adapter', () => {
  let tempDir: string;
  let adapter: OCamlLanguageAdapter;

  beforeAll(async () => {
    tempDir = join(tmpdir(), `reachvet-ocaml-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    adapter = createOCamlAdapter();
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('canHandle', () => {
    it('should detect OCaml project by dune-project', async () => {
      const testDir = join(tempDir, 'dune-project-test');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(join(testDir, 'dune-project'), '(lang dune 3.0)');
      
      expect(await adapter.canHandle(testDir)).toBe(true);
    });

    it('should detect OCaml project by opam file', async () => {
      const testDir = join(tempDir, 'opam-test');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(join(testDir, 'mypackage.opam'), `
opam-version: "2.0"
name: "mypackage"
version: "1.0.0"
`);
      
      expect(await adapter.canHandle(testDir)).toBe(true);
    });

    it('should detect OCaml project by dune file', async () => {
      const testDir = join(tempDir, 'dune-test');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(join(testDir, 'dune'), '(library (name mylib))');
      
      expect(await adapter.canHandle(testDir)).toBe(true);
    });

    it('should detect OCaml project by .ml files', async () => {
      const testDir = join(tempDir, 'ml-test');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(join(testDir, 'main.ml'), 'let () = print_endline "Hello"');
      
      expect(await adapter.canHandle(testDir)).toBe(true);
    });

    it('should not detect non-OCaml project', async () => {
      const testDir = join(tempDir, 'non-ocaml');
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(join(testDir, 'main.py'), 'print("Hello")');
      
      expect(await adapter.canHandle(testDir)).toBe(false);
    });
  });

  describe('analyze', () => {
    it('should detect reachable dependency', async () => {
      const testDir = join(tempDir, 'analyze-reachable');
      await fs.mkdir(testDir, { recursive: true });
      
      // Create opam file
      await fs.writeFile(join(testDir, 'test.opam'), `
opam-version: "2.0"
name: "test"
version: "1.0.0"
depends: [
  "yojson"
  "lwt"
]
`);
      
      // Create dune file
      await fs.writeFile(join(testDir, 'dune'), `
(library
 (name test)
 (libraries yojson lwt))
`);
      
      // Create OCaml source using yojson
      await fs.writeFile(join(testDir, 'main.ml'), `
open Yojson.Safe

let parse_json str =
  let json = from_string str in
  to_string json
`);
      
      const components: Component[] = [
        { name: 'yojson', version: '2.1.0' }
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should detect imported but not used dependency', async () => {
      const testDir = join(tempDir, 'analyze-imported');
      await fs.mkdir(testDir, { recursive: true });
      
      await fs.writeFile(join(testDir, 'test.opam'), `
opam-version: "2.0"
name: "test"
version: "1.0.0"
depends: [
  "lwt"
]
`);
      
      await fs.writeFile(join(testDir, 'dune'), `
(library
 (name test)
 (libraries lwt))
`);
      
      // Open Lwt but don't use specific functions
      await fs.writeFile(join(testDir, 'main.ml'), `
open Lwt

(* Just opened, not really used *)
`);
      
      const components: Component[] = [
        { name: 'lwt', version: '5.6.0' }
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results.length).toBe(1);
      // Should be at least 'imported' since it's opened
      expect(['reachable', 'imported']).toContain(results[0].status);
    });

    it('should detect not reachable dependency', async () => {
      const testDir = join(tempDir, 'analyze-not-reachable');
      await fs.mkdir(testDir, { recursive: true });
      
      await fs.writeFile(join(testDir, 'test.opam'), `
opam-version: "2.0"
name: "test"
version: "1.0.0"
depends: [
  "cohttp"
]
`);
      
      await fs.writeFile(join(testDir, 'dune'), `
(library
 (name test)
 (libraries cohttp))
`);
      
      // Don't use cohttp at all
      await fs.writeFile(join(testDir, 'main.ml'), `
let () = print_endline "Hello"
`);
      
      const components: Component[] = [
        { name: 'cohttp', version: '5.0.0' }
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('not_reachable');
    });

    it('should detect unlisted dependency as not reachable', async () => {
      const testDir = join(tempDir, 'analyze-unlisted');
      await fs.mkdir(testDir, { recursive: true });
      
      await fs.writeFile(join(testDir, 'test.opam'), `
opam-version: "2.0"
name: "test"
version: "1.0.0"
depends: [
  "lwt"
]
`);
      
      await fs.writeFile(join(testDir, 'main.ml'), `
open Lwt
`);
      
      // Check for a package that's not listed
      const components: Component[] = [
        { name: 'dream', version: '1.0.0' }
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('not_reachable');
    });

    it('should detect qualified access', async () => {
      const testDir = join(tempDir, 'analyze-qualified');
      await fs.mkdir(testDir, { recursive: true });
      
      await fs.writeFile(join(testDir, 'test.opam'), `
opam-version: "2.0"
name: "test"
version: "1.0.0"
depends: [
  "digestif"
]
`);
      
      await fs.writeFile(join(testDir, 'dune'), `
(library
 (name test)
 (libraries digestif))
`);
      
      // Use qualified access without open
      await fs.writeFile(join(testDir, 'main.ml'), `
let hash data =
  Digestif.SHA256.digest_string data
  |> Digestif.SHA256.to_hex
`);
      
      const components: Component[] = [
        { name: 'digestif', version: '1.1.0' }
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should handle module alias', async () => {
      const testDir = join(tempDir, 'analyze-alias');
      await fs.mkdir(testDir, { recursive: true });
      
      await fs.writeFile(join(testDir, 'test.opam'), `
opam-version: "2.0"
name: "test"
version: "1.0.0"
depends: [
  "base"
]
`);
      
      await fs.writeFile(join(testDir, 'dune'), `
(library
 (name test)
 (libraries base))
`);
      
      // Use module alias
      await fs.writeFile(join(testDir, 'main.ml'), `
module B = Base

let doubled = B.List.map ~f:(fun x -> x * 2) [1; 2; 3]
`);
      
      const components: Component[] = [
        { name: 'base', version: '0.15.0' }
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should detect vulnerable function usage', async () => {
      const testDir = join(tempDir, 'analyze-vuln');
      await fs.mkdir(testDir, { recursive: true });
      
      await fs.writeFile(join(testDir, 'test.opam'), `
opam-version: "2.0"
name: "test"
version: "1.0.0"
depends: [
  "ssl"
]
`);
      
      await fs.writeFile(join(testDir, 'dune'), `
(library
 (name test)
 (libraries ssl))
`);
      
      await fs.writeFile(join(testDir, 'main.ml'), `
open Ssl

let ctx = create_context TLSv1 Client_context
`);
      
      const components: Component[] = [
        { 
          name: 'ssl', 
          version: '0.5.0',
          vulnerabilities: [{
            id: 'CVE-2024-TEST',
            severity: 'high',
            affectedFunctions: ['create_context']
          }]
        }
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].confidence).toBe('high');
    });
  });

  describe('adapter properties', () => {
    it('should have correct language property', () => {
      expect(adapter.language).toBe('ocaml');
    });

    it('should have correct file extensions', () => {
      expect(adapter.fileExtensions).toContain('.ml');
      expect(adapter.fileExtensions).toContain('.mli');
    });
  });
});
