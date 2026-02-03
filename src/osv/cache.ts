/**
 * File-based cache for OSV API responses
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { CacheEntry, OSVCacheOptions } from './types.js';

const DEFAULT_TTL = 3600; // 1 hour

export class OSVCache {
  private options: OSVCacheOptions;

  constructor(options: Partial<OSVCacheOptions> = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      directory: options.directory ?? path.join(process.cwd(), '.reachvet-cache'),
      ttlSeconds: options.ttlSeconds ?? DEFAULT_TTL,
    };
  }

  /**
   * Generate cache key from query parameters
   */
  private generateKey(ecosystem: string, packageName: string, version: string): string {
    const input = `${ecosystem}:${packageName}:${version}`;
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * Get cache file path
   */
  private getCachePath(key: string): string {
    return path.join(this.options.directory, `${key}.json`);
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.options.directory, { recursive: true });
    } catch {
      // Directory already exists or cannot be created
    }
  }

  /**
   * Get cached entry if valid
   */
  async get<T>(ecosystem: string, packageName: string, version: string): Promise<T | null> {
    if (!this.options.enabled) return null;

    const key = this.generateKey(ecosystem, packageName, version);
    const cachePath = this.getCachePath(key);

    try {
      const content = await fs.readFile(cachePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // Check if expired
      const now = Date.now();
      if (now - entry.timestamp > entry.ttl * 1000) {
        // Expired, delete cache file
        await fs.unlink(cachePath).catch(() => {});
        return null;
      }

      return entry.data;
    } catch {
      return null;
    }
  }

  /**
   * Set cache entry
   */
  async set<T>(ecosystem: string, packageName: string, version: string, data: T): Promise<void> {
    if (!this.options.enabled) return;

    await this.ensureDirectory();

    const key = this.generateKey(ecosystem, packageName, version);
    const cachePath = this.getCachePath(key);

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: this.options.ttlSeconds,
    };

    try {
      await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch {
      // Cache write failed, continue without caching
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<number> {
    if (!this.options.enabled) return 0;

    try {
      const files = await fs.readdir(this.options.directory);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      for (const file of jsonFiles) {
        await fs.unlink(path.join(this.options.directory, file)).catch(() => {});
      }
      
      return jsonFiles.length;
    } catch {
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async stats(): Promise<{ entries: number; sizeBytes: number; expiredCount: number }> {
    if (!this.options.enabled) {
      return { entries: 0, sizeBytes: 0, expiredCount: 0 };
    }

    try {
      const files = await fs.readdir(this.options.directory);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      let sizeBytes = 0;
      let expiredCount = 0;
      const now = Date.now();

      for (const file of jsonFiles) {
        const filePath = path.join(this.options.directory, file);
        try {
          const stat = await fs.stat(filePath);
          sizeBytes += stat.size;

          const content = await fs.readFile(filePath, 'utf-8');
          const entry = JSON.parse(content) as CacheEntry<unknown>;
          if (now - entry.timestamp > entry.ttl * 1000) {
            expiredCount++;
          }
        } catch {
          continue;
        }
      }

      return { entries: jsonFiles.length, sizeBytes, expiredCount };
    } catch {
      return { entries: 0, sizeBytes: 0, expiredCount: 0 };
    }
  }
}

export default OSVCache;
