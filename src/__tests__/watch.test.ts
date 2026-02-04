/**
 * ReachVet Watch Mode Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Watcher, startWatch, type WatchOptions } from '../watch/index.js';
import type { Component, AnalysisOutput } from '../types.js';
import { mkdir, writeFile, rm, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test fixtures
const testComponents: Component[] = [
  { name: 'lodash', version: '4.17.21' },
  { name: 'express', version: '4.18.2' },
];

describe('Watcher', () => {
  let testDir: string;
  let srcDir: string;

  beforeEach(async () => {
    // Create temp directory
    testDir = join(tmpdir(), `reachvet-watch-test-${Date.now()}`);
    srcDir = join(testDir, 'src');
    await mkdir(srcDir, { recursive: true });

    // Create package.json for language detection
    await writeFile(
      join(testDir, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' })
    );

    // Create test file
    await writeFile(
      join(srcDir, 'index.js'),
      `const _ = require('lodash');\nconsole.log(_.merge({}, {}));\n`
    );
  });

  afterEach(async () => {
    // Cleanup
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create a watcher with default options', () => {
      const watcher = new Watcher({
        sourceDir: srcDir,
        components: testComponents,
      });

      expect(watcher).toBeInstanceOf(Watcher);
    });

    it('should accept custom debounce delay', () => {
      const watcher = new Watcher({
        sourceDir: srcDir,
        components: testComponents,
        debounceMs: 1000,
      });

      expect(watcher).toBeInstanceOf(Watcher);
    });

    it('should accept quiet mode option', () => {
      const watcher = new Watcher({
        sourceDir: srcDir,
        components: testComponents,
        quiet: true,
      });

      expect(watcher).toBeInstanceOf(Watcher);
    });
  });

  describe('start/stop', () => {
    it('should start and stop watching', async () => {
      // Use testDir (which has package.json)
      const watcher = new Watcher({
        sourceDir: testDir,
        components: testComponents,
        language: 'javascript',
        debounceMs: 100,
      });

      // Silence console output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await watcher.start();
        
        // Wait a bit for initial analysis
        await new Promise(resolve => setTimeout(resolve, 200));

        const stats = watcher.getStats();
        expect(stats.analysisCount).toBeGreaterThanOrEqual(1);
        expect(stats.lastAnalysis).toBeInstanceOf(Date);

        await watcher.stop();
      } finally {
        consoleSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });

    it('should run initial analysis on start', async () => {
      let analysisResult: AnalysisOutput | null = null;
      let watcher: Watcher | null = null;
      let errorMessage: string | null = null;

      // Capture errors
      const errorSpy = vi.spyOn(console, 'error').mockImplementation((msg) => {
        errorMessage = String(msg);
      });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      try {
        // Use testDir (which has package.json) instead of srcDir
        watcher = new Watcher({
          sourceDir: testDir,
          components: testComponents,
          language: 'javascript',
          debounceMs: 100,
          onAnalysis: (output) => {
            analysisResult = output;
          },
        });

        await watcher.start();
        
        // Give time for analysis to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        // If there was an error, fail with the message
        if (errorMessage && !analysisResult) {
          throw new Error(`Analysis failed: ${errorMessage}`);
        }

        expect(analysisResult).not.toBeNull();
        expect(analysisResult?.results).toBeDefined();
        expect(analysisResult?.summary).toBeDefined();
      } finally {
        if (watcher) await watcher.stop();
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    }, 5000);
  });

  describe('file change detection', () => {
    it('should detect file changes and re-analyze', async () => {
      let analysisCount = 0;
      let watcher: Watcher | null = null;

      // Use a promise to wait for initial analysis
      const initialAnalysis = new Promise<void>((resolve) => {
        // Use testDir (which has package.json) instead of srcDir
        watcher = new Watcher({
          sourceDir: testDir,
          components: testComponents,
          language: 'javascript',
          debounceMs: 100,
          onAnalysis: () => {
            analysisCount++;
            if (analysisCount === 1) {
              resolve();
            }
          },
        });
      });

      // Silence console output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await watcher!.start();
        
        // Wait for initial analysis callback
        await Promise.race([
          initialAnalysis,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
        ]);
        expect(analysisCount).toBe(1);

        // Make a file change (in src subdirectory, which is watched)
        await new Promise(resolve => setTimeout(resolve, 100)); // Let watcher settle
        await appendFile(
          join(srcDir, 'index.js'),
          `\nconst x = _.clone({});\n`
        );

        // Wait for debounce (100ms) + re-analysis + buffer
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Should have re-analyzed
        expect(analysisCount).toBeGreaterThanOrEqual(2);

        await watcher!.stop();
      } finally {
        consoleSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    }, 5000);

    it('should ignore node_modules by default', async () => {
      // Create node_modules directory
      const nodeModulesDir = join(testDir, 'node_modules', 'test-pkg');
      await mkdir(nodeModulesDir, { recursive: true });

      let analysisCount = 0;
      let watcher: Watcher | null = null;

      // Use a promise to wait for initial analysis
      const initialAnalysis = new Promise<void>((resolve) => {
        watcher = new Watcher({
          sourceDir: testDir,
          components: testComponents,
          language: 'javascript',
          debounceMs: 100,
          onAnalysis: () => {
            analysisCount++;
            if (analysisCount === 1) {
              resolve();
            }
          },
        });
      });

      // Silence console output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await watcher!.start();
        
        // Wait for initial analysis callback
        await Promise.race([
          initialAnalysis,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
        ]);
        const initialCount = analysisCount;

        // Write to node_modules (should be ignored)
        await writeFile(
          join(nodeModulesDir, 'index.js'),
          'console.log("test");'
        );

        // Wait for potential re-analysis
        await new Promise(resolve => setTimeout(resolve, 500));

        // Should NOT have re-analyzed (node_modules is ignored)
        expect(analysisCount).toBe(initialCount);

        await watcher!.stop();
      } finally {
        consoleSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    }, 5000);
  });

  describe('getStats', () => {
    it('should return watch statistics', () => {
      const watcher = new Watcher({
        sourceDir: srcDir,
        components: testComponents,
      });

      const stats = watcher.getStats();

      expect(stats).toEqual({
        analysisCount: 0,
        lastAnalysis: null,
        lastChangeFile: null,
        errors: 0,
        cacheHits: 0,
        cacheMisses: 0,
      });
    });
  });
});

describe('startWatch helper', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `reachvet-watch-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, 'index.js'), 'console.log("test");');
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create and start watcher', async () => {
    // Silence console output
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const watcher = await startWatch({
        sourceDir: testDir,
        components: testComponents,
        language: 'javascript',
        debounceMs: 100,
      });

      expect(watcher).toBeInstanceOf(Watcher);

      // Wait a bit then stop
      await new Promise(resolve => setTimeout(resolve, 200));
      await watcher.stop();
    } finally {
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
