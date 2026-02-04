/**
 * Incremental Analysis Cache
 *
 * Caches AST parsing results to speed up repeated analysis.
 * Key benefits:
 * - Watch mode: Only re-parse changed files
 * - Multiple runs: Skip unchanged files between runs
 * - Monorepo support: Share cache across packages
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Cached parse result for a single file
 */
export interface CachedParseResult {
  /** File path (absolute) */
  filePath: string;
  /** SHA-256 hash of file content */
  contentHash: string;
  /** Language detected */
  language: string;
  /** Parsed imports */
  imports: CachedImport[];
  /** Function calls found */
  functionCalls: CachedFunctionCall[];
  /** Analysis warnings */
  warnings: CachedWarning[];
  /** Timestamp when cached */
  cachedAt: number;
  /** Parser version (invalidate on upgrade) */
  parserVersion: string;
}

export interface CachedImport {
  /** Module/package name */
  module: string;
  /** Specific imports (functions, classes, etc.) */
  specifiers: string[];
  /** Import type */
  type: 'default' | 'named' | 'namespace' | 'side-effect' | 'dynamic' | 'require';
  /** Original import statement location */
  line?: number;
}

export interface CachedFunctionCall {
  /** Module/package the function belongs to */
  module: string;
  /** Function name */
  function: string;
  /** Line number */
  line?: number;
}

export interface CachedWarning {
  code: string;
  message: string;
  line?: number;
}

export interface CacheOptions {
  /** Time-to-live in milliseconds (default: 1 hour) */
  ttlMs?: number;
  /** Maximum number of entries (default: 10000) */
  maxEntries?: number;
  /** Enable disk persistence */
  persistToDisk?: boolean;
  /** Disk cache directory */
  cacheDir?: string;
  /** Parser version for cache invalidation */
  parserVersion?: string;
}

const DEFAULT_OPTIONS: Required<CacheOptions> = {
  ttlMs: 60 * 60 * 1000, // 1 hour
  maxEntries: 10000,
  persistToDisk: false,
  cacheDir: '.reachvet-cache',
  parserVersion: '1.0.0',
};

/**
 * LRU entry with access tracking
 */
interface LRUEntry<T> {
  value: T;
  lastAccessed: number;
}

/**
 * Incremental Analysis Cache
 *
 * Features:
 * - In-memory LRU cache
 * - Optional disk persistence
 * - Content-based invalidation (hash)
 * - TTL-based expiration
 * - Version-based invalidation
 */
export class AnalysisCache {
  private cache: Map<string, LRUEntry<CachedParseResult>> = new Map();
  private options: Required<CacheOptions>;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Load from disk if enabled
    if (this.options.persistToDisk) {
      this.loadFromDisk();
    }
  }

  /**
   * Generate cache key from file path
   */
  private getCacheKey(filePath: string): string {
    return path.resolve(filePath);
  }

  /**
   * Compute SHA-256 hash of content
   */
  public computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get cached result if valid
   */
  get(filePath: string, content: string): CachedParseResult | null {
    const key = this.getCacheKey(filePath);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    const contentHash = this.computeHash(content);
    const now = Date.now();

    // Check validity
    if (
      entry.value.contentHash !== contentHash ||
      entry.value.parserVersion !== this.options.parserVersion ||
      now - entry.value.cachedAt > this.options.ttlMs
    ) {
      // Invalid - remove and return null
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Update last accessed
    entry.lastAccessed = now;
    this.hits++;
    return entry.value;
  }

  /**
   * Store parse result in cache
   */
  set(filePath: string, content: string, result: Omit<CachedParseResult, 'filePath' | 'contentHash' | 'cachedAt' | 'parserVersion'>): void {
    const key = this.getCacheKey(filePath);
    const now = Date.now();

    // Evict if at capacity
    if (this.cache.size >= this.options.maxEntries && !this.cache.has(key)) {
      this.evictLRU();
    }

    const cachedResult: CachedParseResult = {
      filePath: key,
      contentHash: this.computeHash(content),
      language: result.language,
      imports: result.imports,
      functionCalls: result.functionCalls,
      warnings: result.warnings,
      cachedAt: now,
      parserVersion: this.options.parserVersion,
    };

    this.cache.set(key, {
      value: cachedResult,
      lastAccessed: now,
    });
  }

  /**
   * Invalidate cache entry for a file
   */
  invalidate(filePath: string): boolean {
    const key = this.getCacheKey(filePath);
    return this.cache.delete(key);
  }

  /**
   * Invalidate all entries in a directory
   */
  invalidateDirectory(dirPath: string): number {
    const normalizedDir = path.resolve(dirPath);
    let count = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(normalizedDir + path.sep)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    entries: number;
    hits: number;
    misses: number;
    hitRate: number;
    memoryUsage: number;
  } {
    const total = this.hits + this.misses;
    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  /**
   * Estimate memory usage in bytes
   */
  private estimateMemoryUsage(): number {
    let bytes = 0;
    for (const entry of this.cache.values()) {
      // Rough estimate: JSON stringify length * 2 (UTF-16)
      bytes += JSON.stringify(entry.value).length * 2;
    }
    return bytes;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Save cache to disk
   */
  saveToDisk(): void {
    if (!this.options.persistToDisk) return;

    const cacheDir = this.options.cacheDir;
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, 'analysis-cache.json');
    const data: Record<string, CachedParseResult> = {};

    for (const [key, entry] of this.cache.entries()) {
      data[key] = entry.value;
    }

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  }

  /**
   * Load cache from disk
   */
  private loadFromDisk(): void {
    const cacheFile = path.join(this.options.cacheDir, 'analysis-cache.json');

    if (!fs.existsSync(cacheFile)) return;

    try {
      const content = fs.readFileSync(cacheFile, 'utf-8');
      const data = JSON.parse(content) as Record<string, CachedParseResult>;
      const now = Date.now();

      for (const [key, result] of Object.entries(data)) {
        // Skip expired or version-mismatched entries
        if (
          now - result.cachedAt > this.options.ttlMs ||
          result.parserVersion !== this.options.parserVersion
        ) {
          continue;
        }

        this.cache.set(key, {
          value: result,
          lastAccessed: result.cachedAt,
        });
      }
    } catch {
      // Ignore corrupt cache
    }
  }

  /**
   * Get all cached file paths
   */
  getCachedPaths(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Check if a file is cached (and valid based on content)
   */
  isCached(filePath: string, content: string): boolean {
    return this.get(filePath, content) !== null;
  }

  /**
   * Batch invalidate multiple files
   */
  invalidateMany(filePaths: string[]): number {
    let count = 0;
    for (const filePath of filePaths) {
      if (this.invalidate(filePath)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get entries that would be affected by a dependency change
   */
  getEntriesDependingOn(moduleName: string): CachedParseResult[] {
    const results: CachedParseResult[] = [];

    for (const entry of this.cache.values()) {
      const hasImport = entry.value.imports.some((imp) => imp.module === moduleName);
      const hasCall = entry.value.functionCalls.some((call) => call.module === moduleName);

      if (hasImport || hasCall) {
        results.push(entry.value);
      }
    }

    return results;
  }
}

/**
 * Global cache instance for reuse across runs
 */
let globalCache: AnalysisCache | null = null;

/**
 * Get or create global cache instance
 */
export function getGlobalCache(options?: CacheOptions): AnalysisCache {
  if (!globalCache) {
    globalCache = new AnalysisCache(options);
  }
  return globalCache;
}

/**
 * Reset global cache (for testing)
 */
export function resetGlobalCache(): void {
  globalCache = null;
}

export default AnalysisCache;
