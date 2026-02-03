/**
 * ReachVet - Rust Parser Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseRustSource,
  parseCargoToml,
  findCrateUsages,
  isStdLibrary,
  normalizeCrateName,
} from '../src/languages/rust/parser.js';

describe('Rust Parser', () => {
  describe('parseRustSource', () => {
    it('should parse simple use statements', () => {
      const source = `
use serde::Deserialize;
use tokio::runtime::Runtime;
`;
      const uses = parseRustSource(source, 'main.rs');
      expect(uses).toHaveLength(2);
      expect(uses[0].crateName).toBe('serde');
      expect(uses[0].items).toContain('Deserialize');
      expect(uses[1].crateName).toBe('tokio');
      expect(uses[1].items).toContain('Runtime');
    });

    it('should parse nested use statements', () => {
      const source = `use std::collections::{HashMap, HashSet, BTreeMap};`;
      const uses = parseRustSource(source, 'main.rs');
      expect(uses).toHaveLength(3);
      expect(uses.every(u => u.crateName === 'std')).toBe(true);
      const items = uses.map(u => u.items[0]);
      expect(items).toContain('HashMap');
      expect(items).toContain('HashSet');
      expect(items).toContain('BTreeMap');
    });

    it('should parse glob imports', () => {
      const source = `use serde::*;`;
      const uses = parseRustSource(source, 'main.rs');
      expect(uses).toHaveLength(1);
      expect(uses[0].isGlob).toBe(true);
      expect(uses[0].crateName).toBe('serde');
    });

    it('should parse aliased imports', () => {
      const source = `use std::io::Result as IoResult;`;
      const uses = parseRustSource(source, 'main.rs');
      expect(uses).toHaveLength(1);
      expect(uses[0].alias).toBe('IoResult');
    });

    it('should parse pub use statements', () => {
      const source = `pub use crate::error::Error;`;
      const uses = parseRustSource(source, 'lib.rs');
      expect(uses).toHaveLength(1);
      expect(uses[0].isCrateLocal).toBe(true);
    });

    it('should parse crate:: imports', () => {
      const source = `use crate::utils::helper;`;
      const uses = parseRustSource(source, 'main.rs');
      expect(uses).toHaveLength(1);
      expect(uses[0].isCrateLocal).toBe(true);
    });

    it('should parse super:: imports', () => {
      const source = `use super::parent_mod;`;
      const uses = parseRustSource(source, 'child.rs');
      expect(uses).toHaveLength(1);
      expect(uses[0].isSuper).toBe(true);
    });

    it('should parse self:: imports', () => {
      const source = `use self::submodule;`;
      const uses = parseRustSource(source, 'mod.rs');
      expect(uses).toHaveLength(1);
      expect(uses[0].isSelf).toBe(true);
    });

    it('should parse multiline use statements', () => {
      const source = `
use std::collections::{
    HashMap,
    HashSet,
    BTreeMap,
};
`;
      const uses = parseRustSource(source, 'main.rs');
      expect(uses).toHaveLength(3);
    });

    it('should handle comments', () => {
      const source = `
// use fake::Crate; // This is commented
use real::Crate; // This is real
`;
      const uses = parseRustSource(source, 'main.rs');
      expect(uses).toHaveLength(1);
      expect(uses[0].crateName).toBe('real');
    });

    it('should parse complex nested imports', () => {
      const source = `use std::{
    io::{self, Read, Write},
    fs::File,
};`;
      const uses = parseRustSource(source, 'main.rs');
      expect(uses.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse deeply nested paths', () => {
      const source = `use tokio::sync::mpsc::channel;`;
      const uses = parseRustSource(source, 'main.rs');
      expect(uses).toHaveLength(1);
      expect(uses[0].crateName).toBe('tokio');
      expect(uses[0].items).toContain('channel');
    });
  });

  describe('parseCargoToml', () => {
    it('should parse package info', () => {
      const content = `
[package]
name = "my-project"
version = "1.0.0"
edition = "2021"
`;
      const cargo = parseCargoToml(content);
      expect(cargo.name).toBe('my-project');
      expect(cargo.version).toBe('1.0.0');
      expect(cargo.edition).toBe('2021');
    });

    it('should parse simple dependencies', () => {
      const content = `
[dependencies]
serde = "1.0"
tokio = "1.28"
`;
      const cargo = parseCargoToml(content);
      expect(cargo.dependencies).toHaveLength(2);
      expect(cargo.dependencies.find(d => d.name === 'serde')?.version).toBe('1.0');
      expect(cargo.dependencies.find(d => d.name === 'tokio')?.version).toBe('1.28');
    });

    it('should parse inline table dependencies', () => {
      const content = `
[dependencies]
serde = { version = "1.0", features = ["derive"] }
`;
      const cargo = parseCargoToml(content);
      expect(cargo.dependencies).toHaveLength(1);
      const serde = cargo.dependencies[0];
      expect(serde.name).toBe('serde');
      expect(serde.version).toBe('1.0');
      expect(serde.features).toContain('derive');
    });

    it('should parse dev-dependencies', () => {
      const content = `
[dev-dependencies]
criterion = "0.5"
`;
      const cargo = parseCargoToml(content);
      expect(cargo.dependencies).toHaveLength(1);
      expect(cargo.dependencies[0].dev).toBe(true);
    });

    it('should parse build-dependencies', () => {
      const content = `
[build-dependencies]
cc = "1.0"
`;
      const cargo = parseCargoToml(content);
      expect(cargo.dependencies).toHaveLength(1);
      expect(cargo.dependencies[0].build).toBe(true);
    });

    it('should parse sub-table dependencies', () => {
      const content = `
[dependencies.serde]
version = "1.0"
features = ["derive", "alloc"]
optional = true
`;
      const cargo = parseCargoToml(content);
      expect(cargo.dependencies).toHaveLength(1);
      const serde = cargo.dependencies[0];
      expect(serde.name).toBe('serde');
      expect(serde.optional).toBe(true);
      expect(serde.features).toContain('derive');
      expect(serde.features).toContain('alloc');
    });

    it('should parse git dependencies', () => {
      const content = `
[dependencies]
my-crate = { git = "https://github.com/user/repo" }
`;
      const cargo = parseCargoToml(content);
      expect(cargo.dependencies[0].git).toBe('https://github.com/user/repo');
    });

    it('should parse path dependencies', () => {
      const content = `
[dependencies]
local-crate = { path = "../local" }
`;
      const cargo = parseCargoToml(content);
      expect(cargo.dependencies[0].path).toBe('../local');
    });

    it('should handle comments', () => {
      const content = `
[package]
name = "test"  # project name
version = "1.0.0"

[dependencies]
# serde = "1.0"  # commented out
tokio = "1.0"
`;
      const cargo = parseCargoToml(content);
      expect(cargo.dependencies).toHaveLength(1);
      expect(cargo.dependencies[0].name).toBe('tokio');
    });

    it('should parse dot notation dependencies', () => {
      const content = `
[dependencies]
serde.version = "1.0"
serde.features = ["derive"]
`;
      const cargo = parseCargoToml(content);
      const serde = cargo.dependencies.find(d => d.name === 'serde');
      expect(serde).toBeDefined();
      expect(serde?.version).toBe('1.0');
    });
  });

  describe('findCrateUsages', () => {
    it('should find function calls', () => {
      const source = `
fn main() {
    let client = reqwest::Client::new();
    let response = reqwest::get("https://example.com");
}
`;
      const usages = findCrateUsages(source, 'reqwest');
      expect(usages).toContain('Client');
      expect(usages).toContain('get');
    });

    it('should find type usages', () => {
      const source = `
fn process(data: serde_json::Value) -> serde_json::Result<()> {
    Ok(())
}
`;
      const usages = findCrateUsages(source, 'serde_json');
      expect(usages).toContain('Value');
      expect(usages).toContain('Result');
    });

    it('should handle aliases', () => {
      const source = `
let result = json::to_string(&data);
`;
      const usages = findCrateUsages(source, 'serde_json', 'json');
      expect(usages).toContain('to_string');
    });
  });

  describe('isStdLibrary', () => {
    it('should recognize std crates', () => {
      expect(isStdLibrary('std')).toBe(true);
      expect(isStdLibrary('core')).toBe(true);
      expect(isStdLibrary('alloc')).toBe(true);
    });

    it('should not flag external crates', () => {
      expect(isStdLibrary('serde')).toBe(false);
      expect(isStdLibrary('tokio')).toBe(false);
      expect(isStdLibrary('reqwest')).toBe(false);
    });
  });

  describe('normalizeCrateName', () => {
    it('should convert hyphens to underscores', () => {
      expect(normalizeCrateName('serde-json')).toBe('serde_json');
      expect(normalizeCrateName('async-std')).toBe('async_std');
      expect(normalizeCrateName('tokio')).toBe('tokio');
    });
  });
});
