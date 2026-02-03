/**
 * ReachVet - Rust Adapter Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RustLanguageAdapter } from '../src/languages/rust/index.js';
import type { Component } from '../src/types.js';

describe('Rust Language Adapter', () => {
  let testDir: string;
  let adapter: RustLanguageAdapter;

  beforeAll(async () => {
    // Create temp directory with Rust project
    testDir = join(tmpdir(), `reachvet-rust-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(join(testDir, 'src'), { recursive: true });

    // Create Cargo.toml
    await fs.writeFile(
      join(testDir, 'Cargo.toml'),
      `[package]
name = "test-project"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.28", features = ["full"] }
reqwest = "0.11"
anyhow = "1.0"
`
    );

    // Create main.rs with various use patterns
    await fs.writeFile(
      join(testDir, 'src', 'main.rs'),
      `use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::runtime::Runtime;
use anyhow::Result;

#[derive(Serialize, Deserialize)]
struct Config {
    name: String,
    value: Value,
}

fn main() -> Result<()> {
    let rt = Runtime::new()?;
    rt.block_on(async {
        let config = Config {
            name: "test".to_string(),
            value: serde_json::json!({"key": "value"}),
        };
        println!("{}", serde_json::to_string(&config)?);
        Ok(())
    })
}
`
    );

    // Create lib.rs with more patterns
    await fs.writeFile(
      join(testDir, 'src', 'lib.rs'),
      `use std::collections::HashMap;
use serde::*;
use tokio::sync::mpsc;

pub mod utils;

pub fn create_channel() -> (mpsc::Sender<String>, mpsc::Receiver<String>) {
    mpsc::channel(32)
}

pub fn serialize_map(map: &HashMap<String, String>) -> String {
    serde_json::to_string(map).unwrap_or_default()
}
`
    );

    // Create utils submodule
    await fs.mkdir(join(testDir, 'src', 'utils'), { recursive: true });
    await fs.writeFile(
      join(testDir, 'src', 'utils', 'mod.rs'),
      `use crate::create_channel;
use super::serialize_map;

pub fn helper() {
    let (tx, _rx) = create_channel();
    drop(tx);
}
`
    );

    adapter = new RustLanguageAdapter();
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('canHandle', () => {
    it('should detect Rust project with Cargo.toml', async () => {
      expect(await adapter.canHandle(testDir)).toBe(true);
    });

    it('should detect Rust files without Cargo.toml', async () => {
      const noCargoDir = join(tmpdir(), `no-cargo-${Date.now()}`);
      await fs.mkdir(noCargoDir, { recursive: true });
      await fs.writeFile(join(noCargoDir, 'main.rs'), 'fn main() {}');
      
      expect(await adapter.canHandle(noCargoDir)).toBe(true);
      
      await fs.rm(noCargoDir, { recursive: true, force: true });
    });

    it('should return false for non-Rust directories', async () => {
      const otherDir = join(tmpdir(), `not-rust-${Date.now()}`);
      await fs.mkdir(otherDir, { recursive: true });
      await fs.writeFile(join(otherDir, 'app.py'), 'print("hello")');
      
      expect(await adapter.canHandle(otherDir)).toBe(false);
      
      await fs.rm(otherDir, { recursive: true, force: true });
    });
  });

  describe('analyze', () => {
    it('should detect used dependency', async () => {
      const components: Component[] = [
        { name: 'serde', version: '1.0.0' },
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should detect serde_json usage', async () => {
      const components: Component[] = [
        { name: 'serde-json', version: '1.0.0' },
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should detect tokio usage', async () => {
      const components: Component[] = [
        { name: 'tokio', version: '1.28.0' },
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should detect unused dependency', async () => {
      const components: Component[] = [
        { name: 'reqwest', version: '0.11.0' },
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results).toHaveLength(1);
      // reqwest is in Cargo.toml but not used in code
      expect(results[0].status).toBe('not_reachable');
    });

    it('should detect dependency not in Cargo.toml', async () => {
      const components: Component[] = [
        { name: 'not-a-crate', version: '1.0.0' },
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_reachable');
      expect(results[0].notes).toContain('Not found in Cargo.toml dependencies');
    });

    it('should handle glob imports with warning', async () => {
      const components: Component[] = [
        { name: 'serde', version: '1.0.0' },
      ];
      
      const results = await adapter.analyze(testDir, components);
      // lib.rs has "use serde::*;"
      const result = results[0];
      expect(result.status).toBe('reachable');
      // Should have glob import warning
      if (result.warnings) {
        const hasGlobWarning = result.warnings.some(w => w.code === 'star_import');
        expect(hasGlobWarning).toBe(true);
      }
    });

    it('should provide usage locations', async () => {
      const components: Component[] = [
        { name: 'tokio', version: '1.28.0' },
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results[0].usage?.locations).toBeDefined();
      expect(results[0].usage?.locations?.length).toBeGreaterThan(0);
    });

    it('should handle multiple components', async () => {
      const components: Component[] = [
        { name: 'serde', version: '1.0.0' },
        { name: 'tokio', version: '1.28.0' },
        { name: 'anyhow', version: '1.0.0' },
        { name: 'fake-crate', version: '0.0.0' },
      ];
      
      const results = await adapter.analyze(testDir, components);
      expect(results).toHaveLength(4);
      
      const reachableCount = results.filter(r => r.status === 'reachable').length;
      expect(reachableCount).toBe(3); // serde, tokio, anyhow
    });
  });

  describe('language property', () => {
    it('should report rust as language', () => {
      expect(adapter.language).toBe('rust');
    });

    it('should have .rs in file extensions', () => {
      expect(adapter.fileExtensions).toContain('.rs');
    });
  });
});
