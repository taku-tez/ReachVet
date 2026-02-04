/**
 * Pre-commit hook support for ReachVet
 * 
 * Analyzes only staged files for faster pre-commit checks.
 */

import { spawnSync } from 'node:child_process';
import { extname } from 'node:path';
import type { SupportedLanguage, AnalysisOutput } from '../types.js';

export interface PreCommitOptions {
  /** Source directory (defaults to current dir) */
  sourceDir?: string;
  /** Only analyze these file extensions */
  extensions?: string[];
  /** Language to use (auto-detect if not specified) */
  language?: SupportedLanguage;
  /** Show verbose output */
  verbose?: boolean;
  /** Enable OSV vulnerability lookup */
  osvLookup?: boolean;
  /** Only check staged files (default: true) */
  stagedOnly?: boolean;
}

export interface StagedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U';
  language?: SupportedLanguage;
}

// File extension to language mapping
const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  // JavaScript/TypeScript
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.pyi': 'python',
  // Go
  '.go': 'go',
  // Java
  '.java': 'java',
  // Rust
  '.rs': 'rust',
  // Ruby
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.gemspec': 'ruby',
  // PHP
  '.php': 'php',
  '.phtml': 'php',
  // C#
  '.cs': 'csharp',
  // Swift
  '.swift': 'swift',
  // Kotlin
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  // Scala
  '.scala': 'scala',
  '.sc': 'scala',
  // Elixir
  '.ex': 'elixir',
  '.exs': 'elixir',
  // Dart
  '.dart': 'dart',
  // Perl
  '.pl': 'perl',
  '.pm': 'perl',
  // Haskell
  '.hs': 'haskell',
  '.lhs': 'haskell',
  // Clojure
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.edn': 'clojure',
  // OCaml
  '.ml': 'ocaml',
  '.mli': 'ocaml',
};

/**
 * Check if we're inside a git repository
 */
export function isGitRepository(dir: string = '.'): boolean {
  try {
    const result = spawnSync('git', ['rev-parse', '--git-dir'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Get list of staged files
 */
export function getStagedFiles(dir: string = '.'): StagedFile[] {
  try {
    const result = spawnSync('git', ['diff', '--cached', '--name-status', '--diff-filter=ACDMRU'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
      return [];
    }

    const output = result.stdout.trim();
    if (!output) {
      return [];
    }

    const files: StagedFile[] = [];
    for (const line of output.split('\n')) {
      const [status, ...pathParts] = line.split('\t');
      const path = pathParts.join('\t'); // Handle filenames with tabs (rare but possible)
      
      if (!path) continue;

      const ext = extname(path).toLowerCase();
      const language = EXTENSION_TO_LANGUAGE[ext];

      files.push({
        path,
        status: status as StagedFile['status'],
        language,
      });
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Get staged file content
 */
export function getStagedContent(file: string, dir: string = '.'): string | null {
  try {
    const result = spawnSync('git', ['show', `:${file}`], {
      cwd: dir,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB max
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
      return null;
    }

    return result.stdout;
  } catch {
    return null;
  }
}

/**
 * Filter staged files by language
 */
export function filterByLanguage(
  files: StagedFile[],
  language?: SupportedLanguage
): StagedFile[] {
  if (!language) {
    // Return all recognized source files
    return files.filter(f => f.language !== undefined && f.status !== 'D');
  }

  return files.filter(f => f.language === language && f.status !== 'D');
}

/**
 * Filter staged files by extensions
 */
export function filterByExtensions(
  files: StagedFile[],
  extensions: string[]
): StagedFile[] {
  const normalizedExts = extensions.map(e => e.startsWith('.') ? e : `.${e}`);
  return files.filter(f => {
    const ext = extname(f.path).toLowerCase();
    return normalizedExts.includes(ext) && f.status !== 'D';
  });
}

/**
 * Detect primary language from staged files
 */
export function detectLanguageFromStaged(files: StagedFile[]): SupportedLanguage | null {
  const counts: Partial<Record<SupportedLanguage, number>> = {};
  
  for (const file of files) {
    if (file.language) {
      counts[file.language] = (counts[file.language] || 0) + 1;
    }
  }

  // Find the most common language
  let maxCount = 0;
  let primaryLang: SupportedLanguage | null = null;

  for (const [lang, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      primaryLang = lang as SupportedLanguage;
    }
  }

  return primaryLang;
}

/**
 * Check for relevant staged files (source code or package manager files)
 */
export function hasRelevantStagedFiles(dir: string = '.'): boolean {
  const stagedFiles = getStagedFiles(dir);
  
  // Check for source code files
  const sourceFiles = stagedFiles.filter(f => f.language !== undefined);
  if (sourceFiles.length > 0) {
    return true;
  }

  // Check for package manager files
  const packageManagerFiles = [
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'requirements.txt', 'pyproject.toml', 'Pipfile', 'Pipfile.lock',
    'go.mod', 'go.sum',
    'Cargo.toml', 'Cargo.lock',
    'Gemfile', 'Gemfile.lock',
    'composer.json', 'composer.lock',
    'pom.xml', 'build.gradle', 'build.gradle.kts',
    'Package.swift', 'Podfile', 'Podfile.lock',
    'pubspec.yaml', 'pubspec.lock',
    'cpanfile', 'Makefile.PL',
    'stack.yaml', '*.cabal',
    'deps.edn', 'project.clj',
    'dune', 'dune-project', '*.opam',
  ];

  for (const file of stagedFiles) {
    const filename = file.path.split('/').pop() || '';
    if (packageManagerFiles.some(pattern => {
      if (pattern.startsWith('*')) {
        return filename.endsWith(pattern.slice(1));
      }
      return filename === pattern;
    })) {
      return true;
    }
  }

  return false;
}

/**
 * Format pre-commit output
 */
export function formatPreCommitOutput(
  output: AnalysisOutput,
  options: { color?: boolean; verbose?: boolean } = {}
): string {
  const { color = true, verbose = false } = options;
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(color ? '\x1b[36m══ ReachVet Pre-commit Check ══\x1b[0m' : '══ ReachVet Pre-commit Check ══');
  lines.push('');

  // Quick summary
  const { total, reachable, vulnerableReachable } = output.summary;
  
  if (vulnerableReachable > 0) {
    lines.push(color
      ? `\x1b[31m✗ BLOCKED: ${vulnerableReachable} vulnerable & reachable dependencies\x1b[0m`
      : `✗ BLOCKED: ${vulnerableReachable} vulnerable & reachable dependencies`);
  } else if (reachable > 0) {
    lines.push(color
      ? `\x1b[33m⚠ ${reachable} dependencies are reachable in staged files\x1b[0m`
      : `⚠ ${reachable} dependencies are reachable in staged files`);
  } else {
    lines.push(color
      ? `\x1b[32m✓ No reachable dependencies found in staged files\x1b[0m`
      : `✓ No reachable dependencies found in staged files`);
  }

  lines.push(`  Total checked: ${total}`);

  // Details for vulnerable/reachable
  if (verbose || vulnerableReachable > 0) {
    const critical = output.results.filter(r => 
      r.status === 'reachable' && 
      r.component.vulnerabilities && 
      r.component.vulnerabilities.length > 0
    );

    if (critical.length > 0) {
      lines.push('');
      lines.push(color ? '\x1b[31mVulnerable & Reachable:\x1b[0m' : 'Vulnerable & Reachable:');
      for (const result of critical) {
        const { name, version, vulnerabilities } = result.component;
        lines.push(`  • ${name}@${version}`);
        for (const vuln of vulnerabilities || []) {
          lines.push(`    └─ ${vuln.id}${vuln.severity ? ` (${vuln.severity})` : ''}`);
        }
      }
    }
  }

  if (verbose && reachable > 0) {
    const reachableResults = output.results.filter(r => r.status === 'reachable');
    const nonVulnerable = reachableResults.filter(r => 
      !r.component.vulnerabilities || r.component.vulnerabilities.length === 0
    );

    if (nonVulnerable.length > 0) {
      lines.push('');
      lines.push(color ? '\x1b[33mReachable (no known vulnerabilities):\x1b[0m' : 'Reachable (no known vulnerabilities):');
      for (const result of nonVulnerable) {
        const { name, version } = result.component;
        lines.push(`  • ${name}@${version}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generate .pre-commit-hooks.yaml content
 */
export function generatePreCommitConfig(): string {
  return `# ReachVet pre-commit hooks
# See https://github.com/taku-tez/reachvet for documentation

- id: reachvet
  name: ReachVet - Supply Chain Reachability
  description: Check if staged files use vulnerable dependencies
  entry: npx reachvet pre-commit
  language: system
  types: [file]
  pass_filenames: false
  stages: [pre-commit]

- id: reachvet-osv
  name: ReachVet with OSV (slower)
  description: Check reachability with live OSV.dev vulnerability data
  entry: npx reachvet pre-commit --osv
  language: system
  types: [file]
  pass_filenames: false
  stages: [pre-commit]
`;
}

// Export for CLI
export { EXTENSION_TO_LANGUAGE };
