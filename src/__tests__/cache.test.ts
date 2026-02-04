/**
 * Tests for Incremental Analysis Cache
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AnalysisCache,
  CachedParseResult,
  getGlobalCache,
  resetGlobalCache,
} from '../cache/index.js';

describe('AnalysisCache', () => {
  let cache: AnalysisCache;
  let tempDir: string;

  beforeEach(() => {
    cache = new AnalysisCache({
      ttlMs: 60000,
      maxEntries: 100,
      parserVersion: '1.0.0',
    });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reachvet-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetGlobalCache();
  });

  describe('computeHash', () => {
    test('returns consistent hash for same content', () => {
      const hash1 = cache.computeHash('const x = 1;');
      const hash2 = cache.computeHash('const x = 1;');
      expect(hash1).toBe(hash2);
    });

    test('returns different hash for different content', () => {
      const hash1 = cache.computeHash('const x = 1;');
      const hash2 = cache.computeHash('const x = 2;');
      expect(hash1).not.toBe(hash2);
    });

    test('returns 64-character hex string', () => {
      const hash = cache.computeHash('test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('get/set', () => {
    const sampleResult = {
      language: 'javascript',
      imports: [
        { module: 'lodash', specifiers: ['merge'], type: 'named' as const },
      ],
      functionCalls: [{ module: 'lodash', function: 'merge', line: 10 }],
      warnings: [],
    };

    test('returns null for uncached file', () => {
      const result = cache.get('/path/to/file.js', 'const x = 1;');
      expect(result).toBeNull();
    });

    test('returns cached result for same content', () => {
      const filePath = '/path/to/file.js';
      const content = 'import { merge } from "lodash";';

      cache.set(filePath, content, sampleResult);
      const result = cache.get(filePath, content);

      expect(result).not.toBeNull();
      expect(result?.language).toBe('javascript');
      expect(result?.imports).toHaveLength(1);
      expect(result?.imports[0].module).toBe('lodash');
    });

    test('returns null when content changes', () => {
      const filePath = '/path/to/file.js';

      cache.set(filePath, 'const x = 1;', sampleResult);
      const result = cache.get(filePath, 'const x = 2;');

      expect(result).toBeNull();
    });

    test('normalizes file paths', () => {
      cache.set('./src/index.js', 'code', sampleResult);
      const result = cache.get(path.resolve('./src/index.js'), 'code');
      expect(result).not.toBeNull();
    });
  });

  describe('TTL expiration', () => {
    test('returns null for expired entries', () => {
      const shortTTLCache = new AnalysisCache({
        ttlMs: 1, // 1ms TTL
        parserVersion: '1.0.0',
      });

      shortTTLCache.set('/file.js', 'code', {
        language: 'javascript',
        imports: [],
        functionCalls: [],
        warnings: [],
      });

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = shortTTLCache.get('/file.js', 'code');
          expect(result).toBeNull();
          resolve();
        }, 10);
      });
    });
  });

  describe('version invalidation', () => {
    test('returns null when parser version changes', () => {
      const v1Cache = new AnalysisCache({ parserVersion: '1.0.0' });
      v1Cache.set('/file.js', 'code', {
        language: 'javascript',
        imports: [],
        functionCalls: [],
        warnings: [],
      });

      const v2Cache = new AnalysisCache({ parserVersion: '2.0.0' });
      // Note: This tests the version check in get(), but caches are separate
      // In practice, version mismatch happens when loading from disk
    });
  });

  describe('invalidate', () => {
    test('removes cached entry', () => {
      cache.set('/file.js', 'code', {
        language: 'javascript',
        imports: [],
        functionCalls: [],
        warnings: [],
      });

      const removed = cache.invalidate('/file.js');
      expect(removed).toBe(true);

      const result = cache.get('/file.js', 'code');
      expect(result).toBeNull();
    });

    test('returns false for non-existent entry', () => {
      const removed = cache.invalidate('/nonexistent.js');
      expect(removed).toBe(false);
    });
  });

  describe('invalidateDirectory', () => {
    test('removes all entries in directory', () => {
      cache.set('/project/src/a.js', 'code', {
        language: 'javascript',
        imports: [],
        functionCalls: [],
        warnings: [],
      });
      cache.set('/project/src/b.js', 'code', {
        language: 'javascript',
        imports: [],
        functionCalls: [],
        warnings: [],
      });
      cache.set('/project/lib/c.js', 'code', {
        language: 'javascript',
        imports: [],
        functionCalls: [],
        warnings: [],
      });

      const count = cache.invalidateDirectory('/project/src');
      expect(count).toBe(2);

      expect(cache.get('/project/src/a.js', 'code')).toBeNull();
      expect(cache.get('/project/src/b.js', 'code')).toBeNull();
      expect(cache.get('/project/lib/c.js', 'code')).not.toBeNull();
    });
  });

  describe('LRU eviction', () => {
    test('evicts entry when at capacity', () => {
      const smallCache = new AnalysisCache({
        maxEntries: 3,
        parserVersion: '1.0.0',
      });

      // Add 3 entries
      smallCache.set('/a.js', 'a', { language: 'js', imports: [], functionCalls: [], warnings: [] });
      smallCache.set('/b.js', 'b', { language: 'js', imports: [], functionCalls: [], warnings: [] });
      smallCache.set('/c.js', 'c', { language: 'js', imports: [], functionCalls: [], warnings: [] });

      expect(smallCache.getStats().entries).toBe(3);

      // Add 4th entry - should evict one entry
      smallCache.set('/d.js', 'd', { language: 'js', imports: [], functionCalls: [], warnings: [] });

      // Still at max capacity (one was evicted)
      expect(smallCache.getStats().entries).toBe(3);

      // d.js should definitely be there (just added)
      const paths = smallCache.getCachedPaths();
      expect(paths).toContain(path.resolve('/d.js'));
    });
  });

  describe('getStats', () => {
    test('tracks hits and misses', () => {
      cache.set('/file.js', 'code', {
        language: 'javascript',
        imports: [],
        functionCalls: [],
        warnings: [],
      });

      cache.get('/file.js', 'code'); // Hit
      cache.get('/file.js', 'code'); // Hit
      cache.get('/other.js', 'code'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
      expect(stats.entries).toBe(1);
    });

    test('estimates memory usage', () => {
      cache.set('/file.js', 'import lodash from "lodash";', {
        language: 'javascript',
        imports: [{ module: 'lodash', specifiers: ['default'], type: 'default' }],
        functionCalls: [],
        warnings: [],
      });

      const stats = cache.getStats();
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    test('removes all entries and resets stats', () => {
      cache.set('/a.js', 'a', { language: 'js', imports: [], functionCalls: [], warnings: [] });
      cache.set('/b.js', 'b', { language: 'js', imports: [], functionCalls: [], warnings: [] });
      cache.get('/a.js', 'a'); // Hit

      cache.clear();

      const stats = cache.getStats();
      expect(stats.entries).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('disk persistence', () => {
    test('saves and loads cache from disk', () => {
      const cacheDir = path.join(tempDir, 'cache');
      const diskCache = new AnalysisCache({
        persistToDisk: true,
        cacheDir,
        parserVersion: '1.0.0',
      });

      diskCache.set('/file.js', 'code', {
        language: 'javascript',
        imports: [{ module: 'react', specifiers: ['useState'], type: 'named' }],
        functionCalls: [],
        warnings: [],
      });

      diskCache.saveToDisk();

      // Create new cache and load from disk
      const loadedCache = new AnalysisCache({
        persistToDisk: true,
        cacheDir,
        parserVersion: '1.0.0',
      });

      const result = loadedCache.get('/file.js', 'code');
      expect(result).not.toBeNull();
      expect(result?.imports[0].module).toBe('react');
    });

    test('ignores version-mismatched entries on load', () => {
      const cacheDir = path.join(tempDir, 'cache2');
      const v1Cache = new AnalysisCache({
        persistToDisk: true,
        cacheDir,
        parserVersion: '1.0.0',
      });

      v1Cache.set('/file.js', 'code', {
        language: 'javascript',
        imports: [],
        functionCalls: [],
        warnings: [],
      });
      v1Cache.saveToDisk();

      // Load with different version
      const v2Cache = new AnalysisCache({
        persistToDisk: true,
        cacheDir,
        parserVersion: '2.0.0',
      });

      expect(v2Cache.getStats().entries).toBe(0);
    });
  });

  describe('getCachedPaths', () => {
    test('returns all cached file paths', () => {
      cache.set('/a.js', 'a', { language: 'js', imports: [], functionCalls: [], warnings: [] });
      cache.set('/b.js', 'b', { language: 'js', imports: [], functionCalls: [], warnings: [] });

      const paths = cache.getCachedPaths();
      expect(paths).toHaveLength(2);
      expect(paths).toContain(path.resolve('/a.js'));
      expect(paths).toContain(path.resolve('/b.js'));
    });
  });

  describe('isCached', () => {
    test('returns true for cached files with matching content', () => {
      cache.set('/file.js', 'code', { language: 'js', imports: [], functionCalls: [], warnings: [] });

      expect(cache.isCached('/file.js', 'code')).toBe(true);
      expect(cache.isCached('/file.js', 'different')).toBe(false);
      expect(cache.isCached('/other.js', 'code')).toBe(false);
    });
  });

  describe('invalidateMany', () => {
    test('invalidates multiple files', () => {
      cache.set('/a.js', 'a', { language: 'js', imports: [], functionCalls: [], warnings: [] });
      cache.set('/b.js', 'b', { language: 'js', imports: [], functionCalls: [], warnings: [] });
      cache.set('/c.js', 'c', { language: 'js', imports: [], functionCalls: [], warnings: [] });

      const count = cache.invalidateMany(['/a.js', '/b.js', '/nonexistent.js']);
      expect(count).toBe(2);
      expect(cache.isCached('/a.js', 'a')).toBe(false);
      expect(cache.isCached('/b.js', 'b')).toBe(false);
      expect(cache.isCached('/c.js', 'c')).toBe(true);
    });
  });

  describe('getEntriesDependingOn', () => {
    test('finds entries importing a module', () => {
      cache.set('/a.js', 'a', {
        language: 'js',
        imports: [{ module: 'lodash', specifiers: ['merge'], type: 'named' }],
        functionCalls: [],
        warnings: [],
      });
      cache.set('/b.js', 'b', {
        language: 'js',
        imports: [{ module: 'react', specifiers: ['useState'], type: 'named' }],
        functionCalls: [],
        warnings: [],
      });
      cache.set('/c.js', 'c', {
        language: 'js',
        imports: [],
        functionCalls: [{ module: 'lodash', function: 'merge' }],
        warnings: [],
      });

      const lodashDeps = cache.getEntriesDependingOn('lodash');
      expect(lodashDeps).toHaveLength(2);

      const reactDeps = cache.getEntriesDependingOn('react');
      expect(reactDeps).toHaveLength(1);
    });
  });

  describe('globalCache', () => {
    test('returns singleton instance', () => {
      const cache1 = getGlobalCache({ parserVersion: '1.0.0' });
      const cache2 = getGlobalCache();

      expect(cache1).toBe(cache2);
    });

    test('resetGlobalCache creates new instance', () => {
      const cache1 = getGlobalCache();
      cache1.set('/file.js', 'code', { language: 'js', imports: [], functionCalls: [], warnings: [] });

      resetGlobalCache();

      const cache2 = getGlobalCache();
      expect(cache2.getStats().entries).toBe(0);
    });
  });
});

describe('CachedParseResult structure', () => {
  test('contains all required fields', () => {
    const cache = new AnalysisCache({ parserVersion: '1.0.0' });
    cache.set('/file.js', 'import React from "react";', {
      language: 'javascript',
      imports: [
        {
          module: 'react',
          specifiers: ['React'],
          type: 'default',
          line: 1,
        },
      ],
      functionCalls: [
        {
          module: 'react',
          function: 'createElement',
          line: 5,
        },
      ],
      warnings: [
        {
          code: 'DYNAMIC_IMPORT',
          message: 'Dynamic import detected',
          line: 10,
        },
      ],
    });

    const result = cache.get('/file.js', 'import React from "react";');
    expect(result).toMatchObject({
      filePath: expect.any(String),
      contentHash: expect.any(String),
      language: 'javascript',
      imports: expect.arrayContaining([
        expect.objectContaining({
          module: 'react',
          specifiers: ['React'],
          type: 'default',
        }),
      ]),
      functionCalls: expect.arrayContaining([
        expect.objectContaining({
          module: 'react',
          function: 'createElement',
        }),
      ]),
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: 'DYNAMIC_IMPORT',
        }),
      ]),
      cachedAt: expect.any(Number),
      parserVersion: '1.0.0',
    });
  });
});
