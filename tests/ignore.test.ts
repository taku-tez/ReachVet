/**
 * Tests for ignore file support
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseIgnoreLine,
  parseIgnoreFile,
  loadIgnoreConfig,
  shouldIgnore,
  filterIgnored,
  getIgnoreStats,
  createEmptyConfig,
  addPatterns,
  mergeConfigs,
  generateSampleIgnoreFile,
  DEFAULT_IGNORE_FILES
} from '../src/ignore/index.js';

describe('parseIgnoreLine', () => {
  it('should parse simple pattern', () => {
    const result = parseIgnoreLine('node_modules', 1, 'test');
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe('node_modules');
    expect(result!.negated).toBe(false);
  });

  it('should parse negation pattern', () => {
    const result = parseIgnoreLine('!important.js', 1, 'test');
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe('!important.js');
    expect(result!.negated).toBe(true);
  });

  it('should skip empty lines', () => {
    expect(parseIgnoreLine('', 1, 'test')).toBeNull();
    expect(parseIgnoreLine('   ', 1, 'test')).toBeNull();
    expect(parseIgnoreLine('\t', 1, 'test')).toBeNull();
  });

  it('should skip comments', () => {
    expect(parseIgnoreLine('# comment', 1, 'test')).toBeNull();
    expect(parseIgnoreLine('  # indented comment', 1, 'test')).toBeNull();
  });

  it('should handle directory patterns', () => {
    const result = parseIgnoreLine('dist/', 1, 'test');
    expect(result).not.toBeNull();
    expect(result!.matcher('dist/file.js')).toBe(true);
    expect(result!.matcher('dist/sub/file.js')).toBe(true);
  });

  it('should handle rooted patterns', () => {
    const result = parseIgnoreLine('/root-only', 1, 'test');
    expect(result).not.toBeNull();
    expect(result!.matcher('root-only')).toBe(true);
    expect(result!.matcher('sub/root-only')).toBe(false);
  });

  it('should handle glob patterns', () => {
    const result = parseIgnoreLine('*.log', 1, 'test');
    expect(result).not.toBeNull();
    expect(result!.matcher('error.log')).toBe(true);
    expect(result!.matcher('logs/error.log')).toBe(true);
  });

  it('should handle double-star patterns', () => {
    const result = parseIgnoreLine('**/test/**', 1, 'test');
    expect(result).not.toBeNull();
    expect(result!.matcher('test/file.js')).toBe(true);
    expect(result!.matcher('src/test/file.js')).toBe(true);
  });

  it('should track source and line', () => {
    const result = parseIgnoreLine('pattern', 42, '/path/to/.gitignore');
    expect(result!.source).toBe('/path/to/.gitignore');
    expect(result!.line).toBe(42);
  });
});

describe('parseIgnoreFile', () => {
  it('should parse multiple patterns', () => {
    const content = `
# Dependencies
node_modules/
vendor/

# Build
dist/
*.min.js

# Keep this
!dist/important.js
`;
    const patterns = parseIgnoreFile(content, 'test');
    expect(patterns).toHaveLength(5);
    expect(patterns[0].pattern).toBe('node_modules/');
    expect(patterns[4].pattern).toBe('!dist/important.js');
    expect(patterns[4].negated).toBe(true);
  });

  it('should handle empty file', () => {
    const patterns = parseIgnoreFile('', 'test');
    expect(patterns).toHaveLength(0);
  });

  it('should handle file with only comments', () => {
    const content = `# Comment 1
# Comment 2
# Comment 3`;
    const patterns = parseIgnoreFile(content, 'test');
    expect(patterns).toHaveLength(0);
  });
});

describe('loadIgnoreConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-ignore-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should load .reachvetignore file', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), 'node_modules/\ndist/');
    
    const config = await loadIgnoreConfig(tempDir);
    
    expect(config.patterns).toHaveLength(2);
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]).toContain('.reachvetignore');
  });

  it('should fallback to .gitignore', async () => {
    await writeFile(join(tempDir, '.gitignore'), 'node_modules/\n*.log');
    
    const config = await loadIgnoreConfig(tempDir);
    
    expect(config.patterns).toHaveLength(2);
    expect(config.sources[0]).toContain('.gitignore');
  });

  it('should prefer .reachvetignore over .gitignore', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), 'dist/');
    await writeFile(join(tempDir, '.gitignore'), 'node_modules/\nbuild/');
    
    const config = await loadIgnoreConfig(tempDir);
    
    expect(config.patterns).toHaveLength(1);
    expect(config.patterns[0].pattern).toBe('dist/');
  });

  it('should handle custom file', async () => {
    await writeFile(join(tempDir, 'custom.ignore'), 'custom-pattern');
    
    const config = await loadIgnoreConfig(tempDir, 'custom.ignore');
    
    expect(config.patterns).toHaveLength(1);
    expect(config.patterns[0].pattern).toBe('custom-pattern');
  });

  it('should return empty config if no ignore file', async () => {
    const config = await loadIgnoreConfig(tempDir);
    
    expect(config.patterns).toHaveLength(0);
    expect(config.sources).toHaveLength(0);
  });
});

describe('shouldIgnore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-ignore-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should ignore matching files', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), 'node_modules/');
    const config = await loadIgnoreConfig(tempDir);
    
    expect(shouldIgnore(join(tempDir, 'node_modules/lodash/index.js'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'src/index.js'), config)).toBe(false);
  });

  it('should handle negation patterns', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), `
dist/
!dist/important.js
`);
    const config = await loadIgnoreConfig(tempDir);
    
    expect(shouldIgnore(join(tempDir, 'dist/bundle.js'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'dist/important.js'), config)).toBe(false);
  });

  it('should match patterns anywhere in path', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), '*.log');
    const config = await loadIgnoreConfig(tempDir);
    
    expect(shouldIgnore(join(tempDir, 'error.log'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'logs/error.log'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'deep/nested/debug.log'), config)).toBe(true);
  });

  it('should not ignore files outside root', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), '*');
    const config = await loadIgnoreConfig(tempDir);
    
    // Files outside root should not be ignored
    expect(shouldIgnore('/outside/file.js', config)).toBe(false);
  });

  it('should handle dotfiles', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), '.env');
    const config = await loadIgnoreConfig(tempDir);
    
    expect(shouldIgnore(join(tempDir, '.env'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'config/.env'), config)).toBe(true);
  });
});

describe('filterIgnored', () => {
  it('should filter out ignored files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'reachvet-ignore-'));
    await writeFile(join(tempDir, '.reachvetignore'), 'node_modules/\n*.log');
    
    const config = await loadIgnoreConfig(tempDir);
    const files = [
      join(tempDir, 'src/index.js'),
      join(tempDir, 'node_modules/lodash/index.js'),
      join(tempDir, 'error.log'),
      join(tempDir, 'lib/util.js')
    ];
    
    const filtered = filterIgnored(files, config);
    
    expect(filtered).toHaveLength(2);
    expect(filtered).toContain(join(tempDir, 'src/index.js'));
    expect(filtered).toContain(join(tempDir, 'lib/util.js'));
    
    await rm(tempDir, { recursive: true, force: true });
  });
});

describe('getIgnoreStats', () => {
  it('should return correct statistics', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'reachvet-ignore-'));
    await writeFile(join(tempDir, '.reachvetignore'), 'ignored/');
    
    const config = await loadIgnoreConfig(tempDir);
    const files = [
      join(tempDir, 'src/index.js'),
      join(tempDir, 'ignored/file1.js'),
      join(tempDir, 'ignored/file2.js'),
      join(tempDir, 'lib/util.js')
    ];
    
    const stats = getIgnoreStats(files, config);
    
    expect(stats.total).toBe(4);
    expect(stats.ignored).toBe(2);
    expect(stats.kept).toBe(2);
    expect(stats.ignoredFiles).toHaveLength(2);
    
    await rm(tempDir, { recursive: true, force: true });
  });
});

describe('createEmptyConfig', () => {
  it('should create config that ignores nothing', () => {
    const config = createEmptyConfig('/project');
    
    expect(config.patterns).toHaveLength(0);
    expect(config.sources).toHaveLength(0);
    expect(shouldIgnore('/project/any/file.js', config)).toBe(false);
  });
});

describe('addPatterns', () => {
  it('should add patterns to config', () => {
    const config = createEmptyConfig('/project');
    const updated = addPatterns(config, ['node_modules/', '*.log'], 'cli');
    
    expect(updated.patterns).toHaveLength(2);
    expect(updated.sources).toContain('cli');
  });

  it('should preserve existing patterns', () => {
    let config = createEmptyConfig('/project');
    config = addPatterns(config, ['first'], 'source1');
    config = addPatterns(config, ['second'], 'source2');
    
    expect(config.patterns).toHaveLength(2);
    expect(config.sources).toContain('source1');
    expect(config.sources).toContain('source2');
  });
});

describe('mergeConfigs', () => {
  it('should merge multiple configs', () => {
    const config1 = addPatterns(createEmptyConfig('/project'), ['pattern1'], 'file1');
    const config2 = addPatterns(createEmptyConfig('/project'), ['pattern2'], 'file2');
    
    const merged = mergeConfigs([config1, config2]);
    
    expect(merged.patterns).toHaveLength(2);
    expect(merged.sources).toHaveLength(2);
  });

  it('should handle empty array', () => {
    const merged = mergeConfigs([]);
    
    expect(merged.patterns).toHaveLength(0);
    expect(merged.sources).toHaveLength(0);
  });

  it('should deduplicate sources', () => {
    const config1 = addPatterns(createEmptyConfig('/project'), ['p1'], 'same-source');
    const config2 = addPatterns(createEmptyConfig('/project'), ['p2'], 'same-source');
    
    const merged = mergeConfigs([config1, config2]);
    
    expect(merged.sources).toHaveLength(1);
  });
});

describe('generateSampleIgnoreFile', () => {
  it('should generate valid content', () => {
    const content = generateSampleIgnoreFile();
    
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
    expect(content).toContain('# ReachVet');
    
    // Should be parseable
    const patterns = parseIgnoreFile(content, 'sample');
    expect(patterns.length).toBeGreaterThan(5);
  });
});

describe('DEFAULT_IGNORE_FILES', () => {
  it('should have .reachvetignore first', () => {
    expect(DEFAULT_IGNORE_FILES[0]).toBe('.reachvetignore');
  });

  it('should include .gitignore', () => {
    expect(DEFAULT_IGNORE_FILES).toContain('.gitignore');
  });
});

describe('complex patterns', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-ignore-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should handle brace expansion', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), '*.{log,tmp,bak}');
    const config = await loadIgnoreConfig(tempDir);
    
    expect(shouldIgnore(join(tempDir, 'error.log'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'temp.tmp'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'backup.bak'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'file.txt'), config)).toBe(false);
  });

  it('should handle question mark wildcard', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), 'file?.js');
    const config = await loadIgnoreConfig(tempDir);
    
    expect(shouldIgnore(join(tempDir, 'file1.js'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'fileA.js'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'file12.js'), config)).toBe(false);
  });

  it('should handle character classes', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), 'file[0-9].js');
    const config = await loadIgnoreConfig(tempDir);
    
    expect(shouldIgnore(join(tempDir, 'file1.js'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'file9.js'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'fileA.js'), config)).toBe(false);
  });

  it('should handle double-star in middle of pattern', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), 'src/**/test/**');
    const config = await loadIgnoreConfig(tempDir);
    
    expect(shouldIgnore(join(tempDir, 'src/test/file.js'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'src/deep/test/file.js'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'test/file.js'), config)).toBe(false);
  });

  it('should handle multiple negations', async () => {
    await writeFile(join(tempDir, '.reachvetignore'), `
# Ignore all in dist
dist/

# But keep specific files
!dist/index.js
!dist/types.d.ts

# Except generated ones
dist/*.generated.*
`);
    const config = await loadIgnoreConfig(tempDir);
    
    expect(shouldIgnore(join(tempDir, 'dist/bundle.js'), config)).toBe(true);
    expect(shouldIgnore(join(tempDir, 'dist/index.js'), config)).toBe(false);
    expect(shouldIgnore(join(tempDir, 'dist/types.d.ts'), config)).toBe(false);
    expect(shouldIgnore(join(tempDir, 'dist/api.generated.js'), config)).toBe(true);
  });
});
