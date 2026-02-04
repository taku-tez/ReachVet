/**
 * Tests for pre-commit hook support
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isGitRepository,
  getStagedFiles,
  filterByLanguage,
  filterByExtensions,
  detectLanguageFromStaged,
  hasRelevantStagedFiles,
  formatPreCommitOutput,
  generatePreCommitConfig,
  EXTENSION_TO_LANGUAGE,
} from '../src/precommit/index.js';
import type { AnalysisOutput } from '../src/types.js';

describe('precommit module', () => {
  describe('EXTENSION_TO_LANGUAGE mapping', () => {
    it('should map JavaScript extensions', () => {
      expect(EXTENSION_TO_LANGUAGE['.js']).toBe('javascript');
      expect(EXTENSION_TO_LANGUAGE['.jsx']).toBe('javascript');
      expect(EXTENSION_TO_LANGUAGE['.mjs']).toBe('javascript');
      expect(EXTENSION_TO_LANGUAGE['.cjs']).toBe('javascript');
    });

    it('should map TypeScript extensions', () => {
      expect(EXTENSION_TO_LANGUAGE['.ts']).toBe('typescript');
      expect(EXTENSION_TO_LANGUAGE['.tsx']).toBe('typescript');
      expect(EXTENSION_TO_LANGUAGE['.mts']).toBe('typescript');
    });

    it('should map Python extensions', () => {
      expect(EXTENSION_TO_LANGUAGE['.py']).toBe('python');
      expect(EXTENSION_TO_LANGUAGE['.pyi']).toBe('python');
    });

    it('should map Go extensions', () => {
      expect(EXTENSION_TO_LANGUAGE['.go']).toBe('go');
    });

    it('should map Rust extensions', () => {
      expect(EXTENSION_TO_LANGUAGE['.rs']).toBe('rust');
    });

    it('should map Ruby extensions', () => {
      expect(EXTENSION_TO_LANGUAGE['.rb']).toBe('ruby');
      expect(EXTENSION_TO_LANGUAGE['.rake']).toBe('ruby');
    });

    it('should map all 18 supported languages', () => {
      const languages = new Set(Object.values(EXTENSION_TO_LANGUAGE));
      expect(languages.size).toBeGreaterThanOrEqual(18);
    });
  });

  describe('isGitRepository', () => {
    it('should return true for a git repository', () => {
      // Current directory should be a git repo
      expect(isGitRepository('.')).toBe(true);
    });

    it('should return false for non-git directory', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'reachvet-test-'));
      try {
        expect(isGitRepository(tempDir)).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true });
      }
    });
  });

  describe('filterByLanguage', () => {
    const mockFiles = [
      { path: 'src/app.ts', status: 'M' as const, language: 'typescript' as const },
      { path: 'src/utils.js', status: 'A' as const, language: 'javascript' as const },
      { path: 'src/main.py', status: 'M' as const, language: 'python' as const },
      { path: 'README.md', status: 'M' as const, language: undefined },
      { path: 'deleted.ts', status: 'D' as const, language: 'typescript' as const },
    ];

    it('should filter by specific language', () => {
      const result = filterByLanguage(mockFiles, 'typescript');
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('src/app.ts');
    });

    it('should exclude deleted files', () => {
      const result = filterByLanguage(mockFiles, 'typescript');
      expect(result.some(f => f.path === 'deleted.ts')).toBe(false);
    });

    it('should return all recognized files when no language specified', () => {
      const result = filterByLanguage(mockFiles);
      expect(result).toHaveLength(3); // ts, js, py (not deleted, not md)
    });
  });

  describe('filterByExtensions', () => {
    const mockFiles = [
      { path: 'src/app.ts', status: 'M' as const, language: 'typescript' as const },
      { path: 'src/utils.js', status: 'A' as const, language: 'javascript' as const },
      { path: 'src/main.py', status: 'M' as const, language: 'python' as const },
    ];

    it('should filter by extensions with dot prefix', () => {
      const result = filterByExtensions(mockFiles, ['.ts', '.js']);
      expect(result).toHaveLength(2);
    });

    it('should filter by extensions without dot prefix', () => {
      const result = filterByExtensions(mockFiles, ['py']);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('src/main.py');
    });
  });

  describe('detectLanguageFromStaged', () => {
    it('should detect most common language', () => {
      const mockFiles = [
        { path: 'a.ts', status: 'M' as const, language: 'typescript' as const },
        { path: 'b.ts', status: 'M' as const, language: 'typescript' as const },
        { path: 'c.js', status: 'M' as const, language: 'javascript' as const },
      ];
      expect(detectLanguageFromStaged(mockFiles)).toBe('typescript');
    });

    it('should return null for no language files', () => {
      const mockFiles = [
        { path: 'README.md', status: 'M' as const, language: undefined },
      ];
      expect(detectLanguageFromStaged(mockFiles)).toBeNull();
    });
  });

  describe('formatPreCommitOutput', () => {
    const mockOutput: AnalysisOutput = {
      sourceDir: '.',
      language: 'typescript',
      timestamp: new Date().toISOString(),
      results: [
        {
          component: { name: 'lodash', version: '4.17.20' },
          status: 'reachable',
        },
        {
          component: {
            name: 'vulnerable-pkg',
            version: '1.0.0',
            vulnerabilities: [{ id: 'CVE-2024-1234', severity: 'high' }],
          },
          status: 'reachable',
        },
      ],
      summary: {
        total: 5,
        reachable: 2,
        imported: 1,
        notReachable: 2,
        unknown: 0,
        vulnerableReachable: 1,
        warningsCount: 0,
      },
    };

    it('should format output with colors by default', () => {
      const output = formatPreCommitOutput(mockOutput);
      expect(output).toContain('ReachVet Pre-commit Check');
      expect(output).toContain('BLOCKED');
      expect(output).toContain('vulnerable-pkg');
    });

    it('should format output without colors when disabled', () => {
      const output = formatPreCommitOutput(mockOutput, { color: false });
      expect(output).not.toContain('\x1b[');
      expect(output).toContain('BLOCKED');
    });

    it('should show success message when no vulnerabilities', () => {
      const cleanOutput: AnalysisOutput = {
        ...mockOutput,
        results: [],
        summary: {
          total: 5,
          reachable: 0,
          imported: 2,
          notReachable: 3,
          unknown: 0,
          vulnerableReachable: 0,
          warningsCount: 0,
        },
      };
      const output = formatPreCommitOutput(cleanOutput);
      expect(output).toContain('No reachable dependencies');
    });

    it('should show warning when reachable but not vulnerable', () => {
      const warningOutput: AnalysisOutput = {
        ...mockOutput,
        results: [
          {
            component: { name: 'lodash', version: '4.17.21' },
            status: 'reachable',
          },
        ],
        summary: {
          total: 5,
          reachable: 1,
          imported: 2,
          notReachable: 2,
          unknown: 0,
          vulnerableReachable: 0,
          warningsCount: 0,
        },
      };
      const output = formatPreCommitOutput(warningOutput);
      expect(output).toContain('1 dependencies are reachable');
    });
  });

  describe('generatePreCommitConfig', () => {
    it('should generate valid YAML', () => {
      const config = generatePreCommitConfig();
      expect(config).toContain('- id: reachvet');
      expect(config).toContain('- id: reachvet-osv');
      expect(config).toContain('entry: npx reachvet pre-commit');
      expect(config).toContain('stages: [pre-commit]');
    });
  });
});

describe('precommit with real git repo', () => {
  let testDir: string;

  beforeAll(() => {
    // Create a temp directory with a git repo
    testDir = mkdtempSync(join(tmpdir(), 'reachvet-git-test-'));
    
    // Initialize git repo
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: testDir, stdio: 'pipe' });
    
    // Create and stage some files
    mkdirSync(join(testDir, 'src'));
    writeFileSync(join(testDir, 'src/app.ts'), 'import lodash from "lodash";\n');
    writeFileSync(join(testDir, 'src/utils.py'), 'import requests\n');
    writeFileSync(join(testDir, 'README.md'), '# Test\n');
    
    execSync('git add src/app.ts src/utils.py README.md', { cwd: testDir, stdio: 'pipe' });
  });

  afterAll(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it('should detect staged files', () => {
    const files = getStagedFiles(testDir);
    expect(files.length).toBe(3);
    
    const tsFile = files.find(f => f.path === 'src/app.ts');
    expect(tsFile).toBeDefined();
    expect(tsFile?.language).toBe('typescript');
    expect(tsFile?.status).toBe('A');

    const pyFile = files.find(f => f.path === 'src/utils.py');
    expect(pyFile).toBeDefined();
    expect(pyFile?.language).toBe('python');
  });

  it('should detect relevant staged files', () => {
    expect(hasRelevantStagedFiles(testDir)).toBe(true);
  });

  it('should detect language from staged files', () => {
    const files = getStagedFiles(testDir);
    const detected = detectLanguageFromStaged(files);
    // Either typescript or python, depending on file order
    expect(['typescript', 'python']).toContain(detected);
  });
});

describe('precommit CLI integration', () => {
  it('should show help for pre-commit command', () => {
    const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'pre-commit', '--help'], {
      cwd: join(__dirname, '..'),
      encoding: 'utf-8',
    });
    expect(result.stdout).toContain('pre-commit hook');
    expect(result.stdout).toContain('--osv');
    expect(result.stdout).toContain('--block-on-reachable');
  });

  it('should show help for pre-commit-config command', () => {
    const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'pre-commit-config', '--help'], {
      cwd: join(__dirname, '..'),
      encoding: 'utf-8',
    });
    expect(result.stdout).toContain('pre-commit-hooks.yaml');
    expect(result.stdout).toContain('--output');
  });

  it('should generate pre-commit config', () => {
    const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'pre-commit-config'], {
      cwd: join(__dirname, '..'),
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('- id: reachvet');
    expect(result.stdout).toContain('entry: npx reachvet pre-commit');
  });
});
