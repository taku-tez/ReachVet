/**
 * ReachVet - OCaml Parser Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseOCamlSource,
  parseDuneFile,
  parseOpamFile,
  findUsages,
  moduleToPackages,
  isStdlibModule,
  OPAM_PACKAGE_TO_MODULES,
} from '../src/languages/ocaml/parser.js';

describe('OCaml Parser', () => {
  describe('parseOCamlSource', () => {
    it('should parse simple open statement', () => {
      const code = `
open Printf
let () = printf "Hello"
`;
      const opens = parseOCamlSource(code, 'test.ml');
      expect(opens.length).toBeGreaterThanOrEqual(1);
      const openStmt = opens.find(o => o.kind === 'open');
      expect(openStmt).toBeDefined();
      expect(openStmt?.moduleName).toBe('Printf');
    });

    it('should parse open! (bang) statement', () => {
      const code = `open! Base`;
      const opens = parseOCamlSource(code, 'test.ml');
      const openStmt = opens.find(o => o.kind === 'open');
      expect(openStmt).toBeDefined();
      expect(openStmt?.moduleName).toBe('Base');
      expect(openStmt?.bang).toBe(true);
    });

    it('should parse nested module open', () => {
      const code = `open Lwt.Syntax`;
      const opens = parseOCamlSource(code, 'test.ml');
      const openStmt = opens.find(o => o.kind === 'open');
      expect(openStmt).toBeDefined();
      expect(openStmt?.moduleName).toBe('Lwt.Syntax');
    });

    it('should parse include statement', () => {
      const code = `
module M = struct
  include Base.List
end
`;
      const opens = parseOCamlSource(code, 'test.ml');
      const includeStmt = opens.find(o => o.kind === 'include');
      expect(includeStmt).toBeDefined();
      expect(includeStmt?.moduleName).toBe('Base.List');
    });

    it('should parse module alias', () => {
      const code = `module L = Lwt`;
      const opens = parseOCamlSource(code, 'test.ml');
      const aliasStmt = opens.find(o => o.kind === 'alias');
      expect(aliasStmt).toBeDefined();
      expect(aliasStmt?.moduleName).toBe('Lwt');
      expect(aliasStmt?.alias).toBe('L');
    });

    it('should parse let open ... in (local open)', () => {
      const code = `let result = let open List in map f xs`;
      const opens = parseOCamlSource(code, 'test.ml');
      const localOpen = opens.find(o => o.kind === 'local_open');
      expect(localOpen).toBeDefined();
      expect(localOpen?.moduleName).toBe('List');
    });

    it('should parse Module.(expr) local open syntax', () => {
      const code = `let x = Base.List.(map ~f:succ xs)`;
      const opens = parseOCamlSource(code, 'test.ml');
      const localOpen = opens.find(o => o.kind === 'local_open' && o.moduleName === 'Base.List');
      expect(localOpen).toBeDefined();
    });

    it('should parse qualified access', () => {
      const code = `
let hash = Digestif.SHA256.digest_string data
let json = Yojson.Safe.from_string str
`;
      const opens = parseOCamlSource(code, 'test.ml');
      const qualifiedAccess = opens.filter(o => o.kind === 'qualified');
      expect(qualifiedAccess.length).toBeGreaterThanOrEqual(2);
      const digestif = qualifiedAccess.find(o => o.moduleName.startsWith('Digestif'));
      expect(digestif).toBeDefined();
    });

    it('should handle multiple opens', () => {
      const code = `
open Lwt
open Lwt.Syntax
open Cohttp_lwt_unix
open Printf
`;
      const opens = parseOCamlSource(code, 'test.ml');
      const openStmts = opens.filter(o => o.kind === 'open');
      expect(openStmts.length).toBe(4);
    });

    it('should skip comments', () => {
      const code = `
(* open Disabled *)
open Enabled
`;
      const opens = parseOCamlSource(code, 'test.ml');
      const openStmts = opens.filter(o => o.kind === 'open');
      expect(openStmts.length).toBe(1);
      expect(openStmts[0].moduleName).toBe('Enabled');
    });
  });

  describe('parseDuneFile', () => {
    it('should parse library stanza', () => {
      const dune = `
(library
 (name mylib)
 (public_name mypackage.mylib)
 (libraries lwt yojson base))
`;
      const info = parseDuneFile(dune);
      expect(info.libraries.length).toBe(1);
      expect(info.libraries[0].name).toBe('mylib');
      expect(info.libraries[0].publicName).toBe('mypackage.mylib');
      expect(info.libraries[0].libraries).toContain('lwt');
      expect(info.libraries[0].libraries).toContain('yojson');
      expect(info.libraries[0].libraries).toContain('base');
    });

    it('should parse executable stanza', () => {
      const dune = `
(executable
 (name main)
 (libraries mylib cmdliner))
`;
      const info = parseDuneFile(dune);
      expect(info.executables.length).toBe(1);
      expect(info.executables[0].name).toBe('main');
      expect(info.executables[0].libraries).toContain('mylib');
      expect(info.executables[0].libraries).toContain('cmdliner');
    });

    it('should parse executables (plural) stanza', () => {
      const dune = `
(executables
 (names app1 app2)
 (libraries core_unix))
`;
      const info = parseDuneFile(dune);
      expect(info.executables.length).toBe(2);
      expect(info.executables[0].name).toBe('app1');
      expect(info.executables[1].name).toBe('app2');
    });

    it('should parse test stanza', () => {
      const dune = `
(test
 (name test_main)
 (libraries alcotest mylib))
`;
      const info = parseDuneFile(dune);
      expect(info.dependencies.some(d => d.name === 'alcotest')).toBe(true);
    });

    it('should collect all dependencies', () => {
      const dune = `
(library
 (name lib)
 (libraries lwt cohttp))

(executable
 (name main)
 (libraries lib yojson))
`;
      const info = parseDuneFile(dune);
      const depNames = info.dependencies.map(d => d.name);
      expect(depNames).toContain('lwt');
      expect(depNames).toContain('cohttp');
      expect(depNames).toContain('yojson');
    });

    it('should handle comments in dune file', () => {
      const dune = `
; This is a comment
(library
 (name mylib)
 (libraries lwt))  ; inline comment
`;
      const info = parseDuneFile(dune);
      expect(info.libraries.length).toBe(1);
      expect(info.libraries[0].name).toBe('mylib');
    });
  });

  describe('parseOpamFile', () => {
    it('should parse name and version', () => {
      const opam = `
opam-version: "2.0"
name: "mypackage"
version: "1.0.0"
depends: []
`;
      const info = parseOpamFile(opam);
      expect(info.name).toBe('mypackage');
      expect(info.version).toBe('1.0.0');
    });

    it('should parse dependencies', () => {
      const opam = `
opam-version: "2.0"
name: "mypackage"
version: "1.0.0"
depends: [
  "lwt" {>= "5.0.0"}
  "yojson"
  "cohttp-lwt-unix" {>= "2.5.0" & < "6.0.0"}
]
`;
      const info = parseOpamFile(opam);
      expect(info.depends.length).toBe(3);
      expect(info.depends.find(d => d.name === 'lwt')).toBeDefined();
      expect(info.depends.find(d => d.name === 'yojson')).toBeDefined();
      expect(info.depends.find(d => d.name === 'cohttp-lwt-unix')).toBeDefined();
    });

    it('should separate dev dependencies', () => {
      const opam = `
opam-version: "2.0"
name: "mypackage"
version: "1.0.0"
depends: [
  "lwt"
  "alcotest" {with-test}
  "odoc" {with-doc}
]
`;
      const info = parseOpamFile(opam);
      expect(info.depends.find(d => d.name === 'lwt')).toBeDefined();
      expect(info.devDepends.find(d => d.name === 'alcotest')).toBeDefined();
      expect(info.devDepends.find(d => d.name === 'odoc')).toBeDefined();
    });

    it('should handle build dependencies', () => {
      const opam = `
opam-version: "2.0"
name: "mypackage"
version: "1.0.0"
depends: [
  "ocaml" {>= "4.08"}
  "dune" {>= "2.0"}
  "lwt"
]
`;
      const info = parseOpamFile(opam);
      expect(info.buildDepends.find(d => d.name === 'ocaml')).toBeDefined();
      expect(info.buildDepends.find(d => d.name === 'dune')).toBeDefined();
      expect(info.depends.find(d => d.name === 'lwt')).toBeDefined();
    });

    it('should extract version constraints', () => {
      const opam = `
opam-version: "2.0"
name: "test"
version: "1.0"
depends: [
  "lwt" {>= "5.0.0"}
]
`;
      const info = parseOpamFile(opam);
      const lwt = info.depends.find(d => d.name === 'lwt');
      expect(lwt?.version).toBe('>= 5.0.0');
    });
  });

  describe('findUsages', () => {
    it('should find qualified function calls', () => {
      const code = `
let json = Yojson.Safe.from_string data
let pretty = Yojson.Safe.pretty_to_string json
`;
      const opens = parseOCamlSource(code, 'test.ml');
      const usages = findUsages(code, 'test.ml', opens);
      expect(usages.size).toBeGreaterThan(0);
    });

    it('should resolve module aliases', () => {
      const code = `
module Y = Yojson.Safe
let json = Y.from_string data
`;
      const opens = parseOCamlSource(code, 'test.ml');
      const usages = findUsages(code, 'test.ml', opens);
      expect(usages.size).toBeGreaterThan(0);
    });
  });

  describe('moduleToPackages', () => {
    it('should map Lwt to lwt package', () => {
      const packages = moduleToPackages('Lwt');
      expect(packages).toContain('lwt');
    });

    it('should map Yojson.Safe to yojson package', () => {
      const packages = moduleToPackages('Yojson.Safe');
      expect(packages).toContain('yojson');
    });

    it('should map Cohttp_lwt_unix to cohttp-lwt package', () => {
      const packages = moduleToPackages('Cohttp_lwt');
      expect(packages).toContain('cohttp-lwt');
    });

    it('should map Base.List to base package', () => {
      const packages = moduleToPackages('Base.List');
      expect(packages).toContain('base');
    });
  });

  describe('isStdlibModule', () => {
    it('should recognize Printf as stdlib', () => {
      expect(isStdlibModule('Printf')).toBe(true);
    });

    it('should recognize List as stdlib', () => {
      expect(isStdlibModule('List')).toBe(true);
    });

    it('should recognize Unix as stdlib', () => {
      expect(isStdlibModule('Unix')).toBe(true);
    });

    it('should not recognize Lwt as stdlib', () => {
      expect(isStdlibModule('Lwt')).toBe(false);
    });

    it('should not recognize Yojson as stdlib', () => {
      expect(isStdlibModule('Yojson')).toBe(false);
    });
  });

  describe('OPAM_PACKAGE_TO_MODULES', () => {
    it('should have lwt mapping', () => {
      expect(OPAM_PACKAGE_TO_MODULES['lwt']).toContain('Lwt');
    });

    it('should have yojson mapping', () => {
      expect(OPAM_PACKAGE_TO_MODULES['yojson']).toContain('Yojson');
    });

    it('should have cohttp mapping', () => {
      expect(OPAM_PACKAGE_TO_MODULES['cohttp']).toContain('Cohttp');
    });

    it('should have base mapping', () => {
      expect(OPAM_PACKAGE_TO_MODULES['base']).toContain('Base');
    });
  });
});
