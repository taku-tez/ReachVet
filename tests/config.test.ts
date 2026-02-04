import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadConfigFromFile,
  loadConfigFromPackageJson,
  loadConfig,
  mergeConfig,
  validateConfig,
  generateSampleConfig,
  findConfigPath,
  ReachVetConfig
} from '../src/config';

describe('Configuration File Support', () => {
  let tempDir: string;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reachvet-config-'));
  });
  
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  
  describe('loadConfigFromFile', () => {
    it('loads JSON config file', () => {
      const configPath = path.join(tempDir, '.reachvetrc.json');
      fs.writeFileSync(configPath, JSON.stringify({ language: 'python', osv: true }));
      
      const config = loadConfigFromFile(configPath);
      expect(config).toEqual({ language: 'python', osv: true });
    });
    
    it('loads .reachvetrc file (implicit JSON)', () => {
      const configPath = path.join(tempDir, '.reachvetrc');
      fs.writeFileSync(configPath, JSON.stringify({ language: 'go' }));
      
      const config = loadConfigFromFile(configPath);
      expect(config).toEqual({ language: 'go' });
    });
    
    it('loads JavaScript config file', () => {
      const configPath = path.join(tempDir, 'reachvet.config.cjs');
      fs.writeFileSync(configPath, `module.exports = { language: 'rust', osv: false };`);
      
      const config = loadConfigFromFile(configPath);
      expect(config).toEqual({ language: 'rust', osv: false });
    });
    
    it('returns null for non-existent file', () => {
      const config = loadConfigFromFile(path.join(tempDir, 'nonexistent.json'));
      expect(config).toBeNull();
    });
    
    it('returns null for invalid JSON', () => {
      const configPath = path.join(tempDir, '.reachvetrc');
      fs.writeFileSync(configPath, '{ invalid json }');
      
      const config = loadConfigFromFile(configPath);
      expect(config).toBeNull();
    });
    
    it('handles ES module default export', () => {
      const configPath = path.join(tempDir, 'reachvet.config.cjs');
      fs.writeFileSync(configPath, `module.exports = { default: { language: 'java' } };`);
      
      const config = loadConfigFromFile(configPath);
      expect(config).toEqual({ language: 'java' });
    });
  });
  
  describe('loadConfigFromPackageJson', () => {
    it('loads config from package.json reachvet field', () => {
      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        reachvet: {
          language: 'typescript',
          ignorePaths: ['dist/**']
        }
      }));
      
      const config = loadConfigFromPackageJson(tempDir);
      expect(config).toEqual({
        language: 'typescript',
        ignorePaths: ['dist/**']
      });
    });
    
    it('returns null when no reachvet field', () => {
      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify({
        name: 'test-project',
        version: '1.0.0'
      }));
      
      const config = loadConfigFromPackageJson(tempDir);
      expect(config).toBeNull();
    });
    
    it('returns null when package.json does not exist', () => {
      const config = loadConfigFromPackageJson(tempDir);
      expect(config).toBeNull();
    });
  });
  
  describe('loadConfig', () => {
    it('prioritizes explicit config path', () => {
      // Create multiple config files
      fs.writeFileSync(path.join(tempDir, '.reachvetrc'), JSON.stringify({ language: 'python' }));
      fs.writeFileSync(path.join(tempDir, 'custom.json'), JSON.stringify({ language: 'rust' }));
      
      const config = loadConfig(tempDir, 'custom.json');
      expect(config?.language).toBe('rust');
    });
    
    it('searches config files in order', () => {
      // .reachvetrc takes precedence over .reachvetrc.json
      fs.writeFileSync(path.join(tempDir, '.reachvetrc'), JSON.stringify({ language: 'go' }));
      fs.writeFileSync(path.join(tempDir, '.reachvetrc.json'), JSON.stringify({ language: 'java' }));
      
      const config = loadConfig(tempDir);
      expect(config?.language).toBe('go');
    });
    
    it('falls back to package.json', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'test',
        reachvet: { language: 'ruby' }
      }));
      
      const config = loadConfig(tempDir);
      expect(config?.language).toBe('ruby');
    });
    
    it('returns null when no config found', () => {
      const config = loadConfig(tempDir);
      expect(config).toBeNull();
    });
  });
  
  describe('mergeConfig', () => {
    it('returns CLI options when no file config', () => {
      const cliOptions = { language: 'python', osv: true };
      const merged = mergeConfig(null, cliOptions);
      expect(merged).toEqual(cliOptions);
    });
    
    it('CLI options override file config', () => {
      const fileConfig: ReachVetConfig = { language: 'python', osv: false };
      const cliOptions = { osv: true };
      
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.language).toBe('python');
      expect(merged.osv).toBe(true);
    });
    
    it('deep merges nested objects', () => {
      const fileConfig: ReachVetConfig = {
        cache: { enabled: true, ttl: 3600000, persist: true }
      };
      const cliOptions = {
        cache: { ttl: 7200000 }
      };
      
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.cache).toEqual({
        enabled: true,
        ttl: 7200000,
        persist: true
      });
    });
    
    it('ignores undefined CLI options', () => {
      const fileConfig: ReachVetConfig = { language: 'go', osv: true };
      const cliOptions = { language: undefined, osv: false };
      
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.language).toBe('go');
      expect(merged.osv).toBe(false);
    });
    
    it('handles array options', () => {
      const fileConfig: ReachVetConfig = {
        ignorePaths: ['node_modules/**'],
        ignorePackages: ['lodash']
      };
      const cliOptions = {
        ignorePackages: ['axios', 'moment']
      };
      
      const merged = mergeConfig(fileConfig, cliOptions);
      expect(merged.ignorePaths).toEqual(['node_modules/**']);
      expect(merged.ignorePackages).toEqual(['axios', 'moment']);
    });
  });
  
  describe('validateConfig', () => {
    it('validates correct config', () => {
      const config: ReachVetConfig = {
        language: 'javascript',
        output: 'json',
        osv: true,
        cache: { enabled: true, ttl: 3600000, maxSize: 100 }
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('rejects invalid language', () => {
      const config: ReachVetConfig = {
        language: 'invalid-lang'
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid language');
    });
    
    it('rejects invalid output format', () => {
      const config: ReachVetConfig = {
        output: 'xml' as 'json'
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid output');
    });
    
    it('rejects invalid CI failOn', () => {
      const config: ReachVetConfig = {
        ci: { failOn: 'always' as 'vulnerable' }
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid ci.failOn');
    });
    
    it('rejects negative cache TTL', () => {
      const config: ReachVetConfig = {
        cache: { ttl: -1000 }
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('cache.ttl must be a positive number');
    });
    
    it('rejects zero cache maxSize', () => {
      const config: ReachVetConfig = {
        cache: { maxSize: 0 }
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('cache.maxSize must be at least 1');
    });
    
    it('rejects negative watch debounce', () => {
      const config: ReachVetConfig = {
        watch: { debounce: -100 }
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('watch.debounce must be a positive number');
    });
    
    it('collects multiple errors', () => {
      const config: ReachVetConfig = {
        language: 'invalid',
        output: 'xml' as 'json',
        cache: { ttl: -1 }
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(3);
    });
  });
  
  describe('generateSampleConfig', () => {
    it('generates JSON config', () => {
      const sample = generateSampleConfig('json');
      const parsed = JSON.parse(sample);
      
      expect(parsed.language).toBe('javascript');
      expect(parsed.osv).toBe(true);
      expect(parsed.cache).toBeDefined();
      expect(parsed.watch).toBeDefined();
      expect(parsed.ci).toBeDefined();
    });
    
    it('generates JavaScript config', () => {
      const sample = generateSampleConfig('js');
      
      expect(sample).toContain('module.exports');
      expect(sample).toContain("@type {import('reachvet').ReachVetConfig}");
    });
    
    it('default to JSON format', () => {
      const sample = generateSampleConfig();
      expect(() => JSON.parse(sample)).not.toThrow();
    });
  });
  
  describe('findConfigPath', () => {
    it('finds .reachvetrc file', () => {
      fs.writeFileSync(path.join(tempDir, '.reachvetrc'), '{}');
      
      const configPath = findConfigPath(tempDir);
      expect(configPath).toBe(path.join(tempDir, '.reachvetrc'));
    });
    
    it('finds .reachvetrc.json file', () => {
      fs.writeFileSync(path.join(tempDir, '.reachvetrc.json'), '{}');
      
      const configPath = findConfigPath(tempDir);
      expect(configPath).toBe(path.join(tempDir, '.reachvetrc.json'));
    });
    
    it('finds package.json with reachvet field', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'test',
        reachvet: {}
      }));
      
      const configPath = findConfigPath(tempDir);
      expect(configPath).toContain('package.json');
      expect(configPath).toContain('reachvet field');
    });
    
    it('returns null when no config found', () => {
      const configPath = findConfigPath(tempDir);
      expect(configPath).toBeNull();
    });
    
    it('prioritizes config files over package.json', () => {
      fs.writeFileSync(path.join(tempDir, '.reachvetrc'), '{}');
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'test',
        reachvet: {}
      }));
      
      const configPath = findConfigPath(tempDir);
      expect(configPath).toBe(path.join(tempDir, '.reachvetrc'));
    });
  });
  
  describe('complex scenarios', () => {
    it('handles full workflow: load, validate, merge', () => {
      // Create config file
      const fileConfig: ReachVetConfig = {
        language: 'typescript',
        ignorePaths: ['node_modules/**', 'dist/**'],
        osv: false,
        cache: { enabled: true, ttl: 3600000 }
      };
      fs.writeFileSync(path.join(tempDir, '.reachvetrc'), JSON.stringify(fileConfig));
      
      // Load config
      const loaded = loadConfig(tempDir);
      expect(loaded).toEqual(fileConfig);
      
      // Validate
      const validation = validateConfig(loaded!);
      expect(validation.valid).toBe(true);
      
      // Merge with CLI options
      const cliOptions = { osv: true, language: undefined };
      const merged = mergeConfig(loaded, cliOptions);
      
      expect(merged.language).toBe('typescript');
      expect(merged.osv).toBe(true);
      expect(merged.cache?.enabled).toBe(true);
    });
    
    it('handles nested config for watch mode', () => {
      const config: ReachVetConfig = {
        watch: {
          debounce: 1000,
          ignore: ['**/*.test.ts'],
          quiet: true
        }
      };
      fs.writeFileSync(path.join(tempDir, '.reachvetrc'), JSON.stringify(config));
      
      const loaded = loadConfig(tempDir);
      const validation = validateConfig(loaded!);
      
      expect(validation.valid).toBe(true);
      expect(loaded?.watch?.debounce).toBe(1000);
      expect(loaded?.watch?.quiet).toBe(true);
    });
    
    it('handles nested config for CI', () => {
      const config: ReachVetConfig = {
        ci: {
          failOn: 'vulnerable',
          annotations: true
        }
      };
      fs.writeFileSync(path.join(tempDir, '.reachvetrc.json'), JSON.stringify(config));
      
      const loaded = loadConfig(tempDir);
      const validation = validateConfig(loaded!);
      
      expect(validation.valid).toBe(true);
      expect(loaded?.ci?.failOn).toBe('vulnerable');
    });
  });
});
