/**
 * Monorepo Detection & Multi-Project Analysis
 * 
 * Supports:
 * - npm/yarn/pnpm workspaces
 * - Lerna
 * - Rush
 * - Nx
 * - Turborepo
 * - Manual multi-project detection (multiple package.json, go.mod, Cargo.toml, etc.)
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import type { Component, AnalysisOutput } from '../types.js';
import { Analyzer } from '../core/analyzer.js';

// =============================================================================
// Types
// =============================================================================

export type MonorepoType = 
  | 'npm-workspaces' 
  | 'yarn-workspaces' 
  | 'pnpm-workspaces'
  | 'lerna'
  | 'rush'
  | 'nx'
  | 'turborepo'
  | 'cargo-workspace'
  | 'go-workspace'
  | 'manual';

export interface MonorepoInfo {
  /** Type of monorepo detected */
  type: MonorepoType;
  /** Root directory of the monorepo */
  rootDir: string;
  /** Configuration file that identified the monorepo */
  configFile?: string;
  /** List of workspace/project paths */
  workspaces: string[];
  /** Monorepo tool version (if detectable) */
  toolVersion?: string;
}

export interface ProjectInfo {
  /** Project name (from package.json, Cargo.toml, etc.) */
  name: string;
  /** Project version */
  version?: string;
  /** Absolute path to project directory */
  path: string;
  /** Relative path from monorepo root */
  relativePath: string;
  /** Detected language */
  language: string;
  /** Package manager file (package.json, go.mod, etc.) */
  manifestFile: string;
  /** Dependencies */
  dependencies: Array<{ name: string; version: string }>;
}

export interface MonorepoAnalysisOptions {
  /** Root directory to scan (defaults to cwd) */
  rootDir?: string;
  /** Maximum depth to search for projects */
  maxDepth?: number;
  /** Patterns to ignore */
  ignorePatterns?: string[];
  /** SBOM file paths or component data per project */
  sbomFiles?: Record<string, string>;
  /** Enable parallel analysis */
  parallel?: boolean;
  /** Number of concurrent analyses (default: 4) */
  concurrency?: number;
  /** Include devDependencies */
  includeDevDependencies?: boolean;
  /** Enable OSV lookup */
  osv?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
}

export interface ProjectAnalysisResult {
  /** Project info */
  project: ProjectInfo;
  /** Analysis output */
  analysis: AnalysisOutput | null;
  /** Error if analysis failed */
  error?: string;
  /** Time taken in ms */
  durationMs: number;
}

export interface MonorepoAnalysisResult {
  /** Detected monorepo info */
  monorepo: MonorepoInfo;
  /** Individual project results */
  projects: ProjectAnalysisResult[];
  /** Aggregated summary */
  summary: MonorepoSummary;
  /** Total time taken in ms */
  totalDurationMs: number;
}

export interface MonorepoSummary {
  /** Total projects analyzed */
  totalProjects: number;
  /** Projects with errors */
  failedProjects: number;
  /** Total dependencies across all projects */
  totalDependencies: number;
  /** Unique dependencies (deduplicated) */
  uniqueDependencies: number;
  /** Vulnerable dependencies */
  vulnerableDependencies: number;
  /** Reachable vulnerable dependencies */
  reachableVulnerabilities: number;
  /** Dependencies shared across multiple projects */
  sharedDependencies: SharedDependency[];
  /** Most common vulnerable dependencies */
  topVulnerabilities: VulnerabilitySummary[];
}

export interface SharedDependency {
  /** Dependency name */
  name: string;
  /** Versions used across projects */
  versions: string[];
  /** Projects using this dependency */
  usedBy: string[];
  /** Is vulnerable */
  vulnerable: boolean;
  /** Is reachable */
  reachable: boolean;
}

export interface VulnerabilitySummary {
  /** Dependency name */
  dependency: string;
  /** Version */
  version: string;
  /** CVE IDs */
  cves: string[];
  /** Projects affected */
  affectedProjects: string[];
  /** Is reachable in any project */
  reachableInAny: boolean;
}

// =============================================================================
// Monorepo Detection
// =============================================================================

const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/target/**',
  '**/__pycache__/**'
];

/**
 * Detect monorepo configuration
 */
export async function detectMonorepo(rootDir: string = process.cwd()): Promise<MonorepoInfo | null> {
  const absRoot = path.resolve(rootDir);
  
  // Check for various monorepo configs in order of specificity
  const checks: Array<() => Promise<MonorepoInfo | null>> = [
    () => checkNpmWorkspaces(absRoot),
    () => checkPnpmWorkspaces(absRoot),
    () => checkYarnWorkspaces(absRoot),
    () => checkLerna(absRoot),
    () => checkRush(absRoot),
    () => checkNx(absRoot),
    () => checkTurborepo(absRoot),
    () => checkCargoWorkspace(absRoot),
    () => checkGoWorkspace(absRoot),
    () => detectManualMonorepo(absRoot)
  ];

  for (const check of checks) {
    const result = await check();
    if (result) {
      return result;
    }
  }

  return null;
}

async function checkNpmWorkspaces(rootDir: string): Promise<MonorepoInfo | null> {
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(content);
    
    if (pkg.workspaces) {
      const patterns = Array.isArray(pkg.workspaces) 
        ? pkg.workspaces 
        : pkg.workspaces.packages || [];
      
      const workspaces = await expandWorkspacePatterns(rootDir, patterns);
      
      return {
        type: 'npm-workspaces',
        rootDir,
        configFile: pkgPath,
        workspaces
      };
    }
  } catch {
    // Not an npm workspaces monorepo
  }
  return null;
}

async function checkPnpmWorkspaces(rootDir: string): Promise<MonorepoInfo | null> {
  try {
    const yamlPath = path.join(rootDir, 'pnpm-workspace.yaml');
    const content = await fs.readFile(yamlPath, 'utf8');
    
    // Simple YAML parsing for packages field
    const packagesMatch = content.match(/packages:\s*\n((?:\s+-\s+['"]?[^\n]+['"]?\n?)+)/);
    if (packagesMatch) {
      const patterns = packagesMatch[1]
        .split('\n')
        .map(line => line.replace(/^\s*-\s*['"]?|['"]?\s*$/g, ''))
        .filter(Boolean);
      
      const workspaces = await expandWorkspacePatterns(rootDir, patterns);
      
      return {
        type: 'pnpm-workspaces',
        rootDir,
        configFile: yamlPath,
        workspaces
      };
    }
  } catch {
    // Not a pnpm workspaces monorepo
  }
  return null;
}

async function checkYarnWorkspaces(rootDir: string): Promise<MonorepoInfo | null> {
  try {
    // Yarn 2+ uses .yarnrc.yml
    const yarnrcPath = path.join(rootDir, '.yarnrc.yml');
    await fs.access(yarnrcPath);
    
    // If .yarnrc.yml exists, check package.json for workspaces
    const pkgPath = path.join(rootDir, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(content);
    
    if (pkg.workspaces) {
      const patterns = Array.isArray(pkg.workspaces) 
        ? pkg.workspaces 
        : pkg.workspaces.packages || [];
      
      const workspaces = await expandWorkspacePatterns(rootDir, patterns);
      
      return {
        type: 'yarn-workspaces',
        rootDir,
        configFile: pkgPath,
        workspaces
      };
    }
  } catch {
    // Not a yarn workspaces monorepo
  }
  return null;
}

async function checkLerna(rootDir: string): Promise<MonorepoInfo | null> {
  try {
    const lernaPath = path.join(rootDir, 'lerna.json');
    const content = await fs.readFile(lernaPath, 'utf8');
    const lerna = JSON.parse(content);
    
    const patterns = lerna.packages || ['packages/*'];
    const workspaces = await expandWorkspacePatterns(rootDir, patterns);
    
    return {
      type: 'lerna',
      rootDir,
      configFile: lernaPath,
      workspaces,
      toolVersion: lerna.version
    };
  } catch {
    // Not a Lerna monorepo
  }
  return null;
}

async function checkRush(rootDir: string): Promise<MonorepoInfo | null> {
  try {
    const rushPath = path.join(rootDir, 'rush.json');
    const content = await fs.readFile(rushPath, 'utf8');
    const rush = JSON.parse(content);
    
    const workspaces = (rush.projects || []).map((p: { projectFolder: string }) => 
      path.join(rootDir, p.projectFolder)
    );
    
    return {
      type: 'rush',
      rootDir,
      configFile: rushPath,
      workspaces,
      toolVersion: rush.rushVersion
    };
  } catch {
    // Not a Rush monorepo
  }
  return null;
}

async function checkNx(rootDir: string): Promise<MonorepoInfo | null> {
  try {
    const nxPath = path.join(rootDir, 'nx.json');
    await fs.access(nxPath);
    
    // Nx typically uses packages/* or apps/* + libs/*
    const patterns = ['packages/*', 'apps/*', 'libs/*'];
    const workspaces = await expandWorkspacePatterns(rootDir, patterns);
    
    if (workspaces.length > 0) {
      return {
        type: 'nx',
        rootDir,
        configFile: nxPath,
        workspaces
      };
    }
  } catch {
    // Not an Nx monorepo
  }
  return null;
}

async function checkTurborepo(rootDir: string): Promise<MonorepoInfo | null> {
  try {
    const turboPath = path.join(rootDir, 'turbo.json');
    await fs.access(turboPath);
    
    // Turborepo uses package.json workspaces
    const pkgPath = path.join(rootDir, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(content);
    
    if (pkg.workspaces) {
      const patterns = Array.isArray(pkg.workspaces) 
        ? pkg.workspaces 
        : pkg.workspaces.packages || [];
      
      const workspaces = await expandWorkspacePatterns(rootDir, patterns);
      
      return {
        type: 'turborepo',
        rootDir,
        configFile: turboPath,
        workspaces
      };
    }
  } catch {
    // Not a Turborepo monorepo
  }
  return null;
}

async function checkCargoWorkspace(rootDir: string): Promise<MonorepoInfo | null> {
  try {
    const cargoPath = path.join(rootDir, 'Cargo.toml');
    const content = await fs.readFile(cargoPath, 'utf8');
    
    // Check for [workspace] section
    const workspaceMatch = content.match(/\[workspace\]/);
    if (workspaceMatch) {
      // Extract members
      const membersMatch = content.match(/members\s*=\s*\[([\s\S]*?)\]/);
      if (membersMatch) {
        const patterns = membersMatch[1]
          .split(',')
          .map(s => s.replace(/["\s]/g, ''))
          .filter(Boolean);
        
        const workspaces = await expandWorkspacePatterns(rootDir, patterns);
        
        return {
          type: 'cargo-workspace',
          rootDir,
          configFile: cargoPath,
          workspaces
        };
      }
    }
  } catch {
    // Not a Cargo workspace
  }
  return null;
}

async function checkGoWorkspace(rootDir: string): Promise<MonorepoInfo | null> {
  try {
    const goWorkPath = path.join(rootDir, 'go.work');
    const content = await fs.readFile(goWorkPath, 'utf8');
    
    // Extract use directives
    const useMatch = content.match(/use\s*\(([\s\S]*?)\)/);
    if (useMatch) {
      const workspaces = useMatch[1]
        .split('\n')
        .map(line => line.trim().replace(/^\.\//, ''))
        .filter(Boolean)
        .map(w => path.join(rootDir, w));
      
      return {
        type: 'go-workspace',
        rootDir,
        configFile: goWorkPath,
        workspaces
      };
    }
  } catch {
    // Not a Go workspace
  }
  return null;
}

/**
 * Detect manual monorepo (multiple independent projects)
 */
async function detectManualMonorepo(
  rootDir: string, 
  maxDepth: number = 3
): Promise<MonorepoInfo | null> {
  const manifestFiles = [
    'package.json',
    'go.mod',
    'Cargo.toml',
    'pyproject.toml',
    'requirements.txt',
    'Gemfile',
    'composer.json',
    'pubspec.yaml',
    'mix.exs',
    'build.gradle',
    'pom.xml',
    '*.cabal',
    'dune-project'
  ];

  const patterns = manifestFiles.map(f => `**/${f}`);
  
  const found: string[] = [];
  
  for (const pattern of patterns) {
    try {
      const matches = await glob(pattern, {
        cwd: rootDir,
        ignore: DEFAULT_IGNORE_PATTERNS,
        maxDepth,
        absolute: true
      });
      found.push(...matches);
    } catch {
      // Ignore glob errors
    }
  }

  // Deduplicate by directory
  const projectDirs = new Set<string>();
  for (const file of found) {
    projectDirs.add(path.dirname(file));
  }

  // Filter out root directory and subdirectories of other projects
  const projects = Array.from(projectDirs)
    .filter(dir => dir !== rootDir)
    .sort()
    .filter((dir, _, arr) => {
      // Remove nested projects
      return !arr.some(other => 
        other !== dir && dir.startsWith(other + path.sep)
      );
    });

  if (projects.length >= 2) {
    return {
      type: 'manual',
      rootDir,
      workspaces: projects
    };
  }

  return null;
}

/**
 * Expand workspace glob patterns to actual directories
 */
async function expandWorkspacePatterns(
  rootDir: string, 
  patterns: string[]
): Promise<string[]> {
  const results: string[] = [];
  
  for (const pattern of patterns) {
    // Handle negation patterns
    if (pattern.startsWith('!')) {
      continue; // Skip for now, handled by filtering
    }
    
    try {
      const matches = await glob(pattern, {
        cwd: rootDir,
        ignore: DEFAULT_IGNORE_PATTERNS,
        absolute: true
      });
      
      for (const match of matches) {
        const stat = await fs.stat(match);
        if (stat.isDirectory()) {
          results.push(match);
        }
      }
    } catch {
      // Ignore glob errors
    }
  }
  
  return [...new Set(results)].sort();
}

// =============================================================================
// Project Discovery
// =============================================================================

/**
 * Discover projects within monorepo workspaces
 */
export async function discoverProjects(
  monorepo: MonorepoInfo,
  options: MonorepoAnalysisOptions = {}
): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  
  for (const workspace of monorepo.workspaces) {
    const project = await parseProjectInfo(workspace, monorepo.rootDir, options);
    if (project) {
      projects.push(project);
    }
  }
  
  return projects;
}

async function parseProjectInfo(
  projectPath: string,
  rootDir: string,
  options: MonorepoAnalysisOptions
): Promise<ProjectInfo | null> {
  const relativePath = path.relative(rootDir, projectPath);
  
  // Try various manifest files
  const parsers: Array<() => Promise<ProjectInfo | null>> = [
    () => parseNodeProject(projectPath, relativePath, options),
    () => parseGoProject(projectPath, relativePath),
    () => parseRustProject(projectPath, relativePath),
    () => parsePythonProject(projectPath, relativePath),
    () => parseRubyProject(projectPath, relativePath),
    () => parsePhpProject(projectPath, relativePath)
  ];

  for (const parser of parsers) {
    const result = await parser();
    if (result) {
      return result;
    }
  }

  return null;
}

async function parseNodeProject(
  projectPath: string, 
  relativePath: string,
  options: MonorepoAnalysisOptions
): Promise<ProjectInfo | null> {
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(content);
    
    const deps: Array<{ name: string; version: string }> = [];
    
    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        deps.push({ name, version: String(version) });
      }
    }
    
    if (options.includeDevDependencies && pkg.devDependencies) {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        deps.push({ name, version: String(version) });
      }
    }
    
    return {
      name: pkg.name || path.basename(projectPath),
      version: pkg.version,
      path: projectPath,
      relativePath,
      language: 'javascript',
      manifestFile: 'package.json',
      dependencies: deps
    };
  } catch {
    return null;
  }
}

async function parseGoProject(
  projectPath: string, 
  relativePath: string
): Promise<ProjectInfo | null> {
  try {
    const modPath = path.join(projectPath, 'go.mod');
    const content = await fs.readFile(modPath, 'utf8');
    
    const moduleMatch = content.match(/module\s+(\S+)/);
    const name = moduleMatch?.[1] || path.basename(projectPath);
    
    const deps: Array<{ name: string; version: string }> = [];
    const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock) {
      const lines = requireBlock[1].split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*(\S+)\s+(v[\d.]+)/);
        if (match) {
          deps.push({ name: match[1], version: match[2] });
        }
      }
    }
    
    return {
      name,
      path: projectPath,
      relativePath,
      language: 'go',
      manifestFile: 'go.mod',
      dependencies: deps
    };
  } catch {
    return null;
  }
}

async function parseRustProject(
  projectPath: string, 
  relativePath: string
): Promise<ProjectInfo | null> {
  try {
    const cargoPath = path.join(projectPath, 'Cargo.toml');
    const content = await fs.readFile(cargoPath, 'utf8');
    
    const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
    const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
    
    const deps: Array<{ name: string; version: string }> = [];
    
    // Simple dependency parsing
    const depSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
    if (depSection) {
      const lines = depSection[1].split('\n');
      for (const line of lines) {
        const simpleMatch = line.match(/^(\w[\w-]*)\s*=\s*"([^"]+)"/);
        const inlineMatch = line.match(/^(\w[\w-]*)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
        
        if (simpleMatch) {
          deps.push({ name: simpleMatch[1], version: simpleMatch[2] });
        } else if (inlineMatch) {
          deps.push({ name: inlineMatch[1], version: inlineMatch[2] });
        }
      }
    }
    
    return {
      name: nameMatch?.[1] || path.basename(projectPath),
      version: versionMatch?.[1],
      path: projectPath,
      relativePath,
      language: 'rust',
      manifestFile: 'Cargo.toml',
      dependencies: deps
    };
  } catch {
    return null;
  }
}

async function parsePythonProject(
  projectPath: string, 
  relativePath: string
): Promise<ProjectInfo | null> {
  try {
    // Try pyproject.toml first
    const pyprojectPath = path.join(projectPath, 'pyproject.toml');
    const content = await fs.readFile(pyprojectPath, 'utf8');
    
    const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
    const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
    
    const deps: Array<{ name: string; version: string }> = [];
    
    // Parse dependencies from pyproject.toml
    const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depsMatch) {
      const lines = depsMatch[1].split('\n');
      for (const line of lines) {
        const match = line.match(/"([^">=<]+)([>=<][^"]+)?"/);
        if (match) {
          deps.push({ 
            name: match[1].trim(), 
            version: match[2]?.replace(/[>=<]/g, '').trim() || '*' 
          });
        }
      }
    }
    
    return {
      name: nameMatch?.[1] || path.basename(projectPath),
      version: versionMatch?.[1],
      path: projectPath,
      relativePath,
      language: 'python',
      manifestFile: 'pyproject.toml',
      dependencies: deps
    };
  } catch {
    // Try requirements.txt
    try {
      const reqPath = path.join(projectPath, 'requirements.txt');
      const content = await fs.readFile(reqPath, 'utf8');
      
      const deps: Array<{ name: string; version: string }> = [];
      const lines = content.split('\n');
      
      for (const line of lines) {
        const match = line.match(/^([^#=><\s]+)(?:[=><]+(.+))?/);
        if (match) {
          deps.push({ name: match[1], version: match[2] || '*' });
        }
      }
      
      return {
        name: path.basename(projectPath),
        path: projectPath,
        relativePath,
        language: 'python',
        manifestFile: 'requirements.txt',
        dependencies: deps
      };
    } catch {
      return null;
    }
  }
}

async function parseRubyProject(
  projectPath: string, 
  relativePath: string
): Promise<ProjectInfo | null> {
  try {
    const gemfilePath = path.join(projectPath, 'Gemfile');
    const content = await fs.readFile(gemfilePath, 'utf8');
    
    const deps: Array<{ name: string; version: string }> = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const match = line.match(/gem\s+['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"])?/);
      if (match) {
        deps.push({ name: match[1], version: match[2] || '*' });
      }
    }
    
    return {
      name: path.basename(projectPath),
      path: projectPath,
      relativePath,
      language: 'ruby',
      manifestFile: 'Gemfile',
      dependencies: deps
    };
  } catch {
    return null;
  }
}

async function parsePhpProject(
  projectPath: string, 
  relativePath: string
): Promise<ProjectInfo | null> {
  try {
    const composerPath = path.join(projectPath, 'composer.json');
    const content = await fs.readFile(composerPath, 'utf8');
    const composer = JSON.parse(content);
    
    const deps: Array<{ name: string; version: string }> = [];
    
    if (composer.require) {
      for (const [name, version] of Object.entries(composer.require)) {
        if (!name.startsWith('php') && !name.startsWith('ext-')) {
          deps.push({ name, version: String(version) });
        }
      }
    }
    
    return {
      name: composer.name || path.basename(projectPath),
      version: composer.version,
      path: projectPath,
      relativePath,
      language: 'php',
      manifestFile: 'composer.json',
      dependencies: deps
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Multi-Project Analysis
// =============================================================================

/**
 * Analyze all projects in a monorepo
 */
export async function analyzeMonorepo(
  options: MonorepoAnalysisOptions = {}
): Promise<MonorepoAnalysisResult> {
  const startTime = Date.now();
  const rootDir = options.rootDir || process.cwd();
  
  // Detect monorepo
  const monorepo = await detectMonorepo(rootDir);
  if (!monorepo) {
    throw new Error(`No monorepo detected in ${rootDir}`);
  }

  // Discover projects
  const projects = await discoverProjects(monorepo, options);
  if (projects.length === 0) {
    throw new Error(`No projects found in monorepo workspaces`);
  }

  // Analyze projects
  const results: ProjectAnalysisResult[] = [];
  
  if (options.parallel && options.concurrency && options.concurrency > 1) {
    // Parallel analysis
    const chunks = chunkArray(projects, options.concurrency);
    
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(project => analyzeProject(project, options))
      );
      results.push(...chunkResults);
    }
  } else {
    // Sequential analysis
    for (const project of projects) {
      const result = await analyzeProject(project, options);
      results.push(result);
    }
  }

  // Generate summary
  const summary = generateMonorepoSummary(results);

  return {
    monorepo,
    projects: results,
    summary,
    totalDurationMs: Date.now() - startTime
  };
}

async function analyzeProject(
  project: ProjectInfo,
  _options: MonorepoAnalysisOptions
): Promise<ProjectAnalysisResult> {
  const startTime = Date.now();
  
  try {
    // Build components from dependencies
    const components: Component[] = project.dependencies.map(dep => ({
      name: dep.name,
      version: dep.version,
      type: 'library',
      purl: buildPurl(project.language, dep.name, dep.version)
    }));

    if (components.length === 0) {
      return {
        project,
        analysis: null,
        durationMs: Date.now() - startTime
      };
    }

    // Run analysis
    const analyzer = new Analyzer({
      sourceDir: project.path,
      language: project.language as any
    });

    const analysis = await analyzer.analyze(components);

    return {
      project,
      analysis,
      durationMs: Date.now() - startTime
    };
  } catch (err) {
    return {
      project,
      analysis: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime
    };
  }
}

function buildPurl(language: string, name: string, version: string): string {
  const ecosystemMap: Record<string, string> = {
    javascript: 'npm',
    typescript: 'npm',
    go: 'golang',
    rust: 'cargo',
    python: 'pypi',
    ruby: 'gem',
    php: 'composer',
    java: 'maven',
    csharp: 'nuget'
  };
  
  const ecosystem = ecosystemMap[language] || language;
  return `pkg:${ecosystem}/${name}@${version}`;
}

// =============================================================================
// Summary Generation
// =============================================================================

function generateMonorepoSummary(results: ProjectAnalysisResult[]): MonorepoSummary {
  const depMap = new Map<string, SharedDependency>();
  const vulnMap = new Map<string, VulnerabilitySummary>();
  
  let totalDeps = 0;
  let vulnerableDeps = 0;
  let reachableVulns = 0;
  let failedProjects = 0;

  for (const result of results) {
    if (result.error || !result.analysis) {
      failedProjects++;
      continue;
    }

    for (const compResult of result.analysis.results) {
      totalDeps++;
      
      const comp = compResult.component;
      const key = comp.name;
      const existing = depMap.get(key);
      const isVulnerable = !!(comp.vulnerabilities && comp.vulnerabilities.length > 0);
      const isReachable = compResult.status === 'reachable';
      
      if (existing) {
        if (!existing.versions.includes(comp.version)) {
          existing.versions.push(comp.version);
        }
        if (!existing.usedBy.includes(result.project.name)) {
          existing.usedBy.push(result.project.name);
        }
        if (isVulnerable) existing.vulnerable = true;
        if (isReachable) existing.reachable = true;
      } else {
        depMap.set(key, {
          name: comp.name,
          versions: [comp.version],
          usedBy: [result.project.name],
          vulnerable: isVulnerable,
          reachable: isReachable
        });
      }

      if (isVulnerable) {
        vulnerableDeps++;
        
        const vulnKey = `${comp.name}@${comp.version}`;
        const cves = (comp.vulnerabilities || []).map((v: { id: string }) => v.id);
        
        const existingVuln = vulnMap.get(vulnKey);
        if (existingVuln) {
          if (!existingVuln.affectedProjects.includes(result.project.name)) {
            existingVuln.affectedProjects.push(result.project.name);
          }
          if (isReachable) {
            existingVuln.reachableInAny = true;
          }
        } else {
          vulnMap.set(vulnKey, {
            dependency: comp.name,
            version: comp.version,
            cves,
            affectedProjects: [result.project.name],
            reachableInAny: isReachable
          });
        }

        if (isReachable) {
          reachableVulns++;
        }
      }
    }
  }

  // Find shared dependencies (used by multiple projects)
  const sharedDeps = Array.from(depMap.values())
    .filter(d => d.usedBy.length > 1)
    .sort((a, b) => b.usedBy.length - a.usedBy.length)
    .slice(0, 20);

  // Top vulnerabilities
  const topVulns = Array.from(vulnMap.values())
    .sort((a, b) => {
      // Prioritize reachable, then by affected project count
      if (a.reachableInAny !== b.reachableInAny) {
        return a.reachableInAny ? -1 : 1;
      }
      return b.affectedProjects.length - a.affectedProjects.length;
    })
    .slice(0, 10);

  return {
    totalProjects: results.length,
    failedProjects,
    totalDependencies: totalDeps,
    uniqueDependencies: depMap.size,
    vulnerableDependencies: vulnerableDeps,
    reachableVulnerabilities: reachableVulns,
    sharedDependencies: sharedDeps,
    topVulnerabilities: topVulns
  };
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Format monorepo analysis result as text
 */
export function formatMonorepoReport(result: MonorepoAnalysisResult): string {
  const lines: string[] = [];
  const { monorepo, summary } = result;

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('                    MONOREPO ANALYSIS REPORT');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  
  // Monorepo info
  lines.push(`📦 Type: ${monorepo.type}`);
  lines.push(`📁 Root: ${monorepo.rootDir}`);
  if (monorepo.configFile) {
    lines.push(`📄 Config: ${monorepo.configFile}`);
  }
  lines.push(`📊 Workspaces: ${monorepo.workspaces.length}`);
  lines.push('');

  // Summary
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('                         SUMMARY');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`Projects analyzed:    ${summary.totalProjects}`);
  lines.push(`Failed projects:      ${summary.failedProjects}`);
  lines.push(`Total dependencies:   ${summary.totalDependencies}`);
  lines.push(`Unique dependencies:  ${summary.uniqueDependencies}`);
  lines.push(`Vulnerable deps:      ${summary.vulnerableDependencies}`);
  lines.push(`Reachable vulns:      ${summary.reachableVulnerabilities}`);
  lines.push('');

  // Top vulnerabilities
  if (summary.topVulnerabilities.length > 0) {
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('                    TOP VULNERABILITIES');
    lines.push('───────────────────────────────────────────────────────────────');
    
    for (const vuln of summary.topVulnerabilities) {
      const status = vuln.reachableInAny ? '🔴 REACHABLE' : '🟡 IMPORTED';
      const cves = vuln.cves.length > 0 ? vuln.cves.join(', ') : 'N/A';
      lines.push(`${status} ${vuln.dependency}@${vuln.version}`);
      lines.push(`   CVEs: ${cves}`);
      lines.push(`   Affected: ${vuln.affectedProjects.join(', ')}`);
      lines.push('');
    }
  }

  // Shared dependencies
  if (summary.sharedDependencies.length > 0) {
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('                   SHARED DEPENDENCIES');
    lines.push('───────────────────────────────────────────────────────────────');
    
    for (const dep of summary.sharedDependencies.slice(0, 10)) {
      const status = dep.vulnerable ? (dep.reachable ? '🔴' : '🟡') : '✅';
      const versions = dep.versions.length > 1 
        ? `[${dep.versions.join(', ')}]` 
        : dep.versions[0];
      lines.push(`${status} ${dep.name} ${versions}`);
      lines.push(`   Used by: ${dep.usedBy.join(', ')}`);
    }
    lines.push('');
  }

  // Per-project details
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('                    PROJECT DETAILS');
  lines.push('───────────────────────────────────────────────────────────────');
  
  for (const project of result.projects) {
    const status = project.error ? '❌' : '✅';
    const summary = project.analysis?.summary;
    
    lines.push(`${status} ${project.project.name} (${project.project.relativePath})`);
    lines.push(`   Language: ${project.project.language}`);
    
    if (project.error) {
      lines.push(`   Error: ${project.error}`);
    } else if (summary) {
      lines.push(`   Dependencies: ${summary.total}`);
      lines.push(`   Vulnerable+Reachable: ${summary.vulnerableReachable} | Reachable: ${summary.reachable}`);
    }
    lines.push(`   Duration: ${project.durationMs}ms`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`Total time: ${result.totalDurationMs}ms`);

  return lines.join('\n');
}

/**
 * Format monorepo analysis result as JSON
 */
export function toMonorepoJson(result: MonorepoAnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format monorepo analysis result as Markdown
 */
export function formatMonorepoMarkdown(result: MonorepoAnalysisResult): string {
  const lines: string[] = [];
  const { monorepo, summary } = result;

  lines.push('# Monorepo Analysis Report');
  lines.push('');
  
  // Info
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Type | ${monorepo.type} |`);
  lines.push(`| Root | \`${monorepo.rootDir}\` |`);
  lines.push(`| Workspaces | ${monorepo.workspaces.length} |`);
  lines.push(`| Projects Analyzed | ${summary.totalProjects} |`);
  lines.push(`| Failed | ${summary.failedProjects} |`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Dependencies | ${summary.totalDependencies} |`);
  lines.push(`| Unique Dependencies | ${summary.uniqueDependencies} |`);
  lines.push(`| Vulnerable | ${summary.vulnerableDependencies} |`);
  lines.push(`| Reachable Vulnerabilities | ${summary.reachableVulnerabilities} |`);
  lines.push('');

  // Vulnerabilities
  if (summary.topVulnerabilities.length > 0) {
    lines.push('## Top Vulnerabilities');
    lines.push('');
    lines.push('| Status | Package | CVEs | Affected Projects |');
    lines.push('|--------|---------|------|-------------------|');
    
    for (const vuln of summary.topVulnerabilities) {
      const status = vuln.reachableInAny ? '🔴 Reachable' : '🟡 Imported';
      const pkg = `\`${vuln.dependency}@${vuln.version}\``;
      const cves = vuln.cves.length > 0 ? vuln.cves.map(c => `\`${c}\``).join(', ') : '-';
      const projects = vuln.affectedProjects.join(', ');
      lines.push(`| ${status} | ${pkg} | ${cves} | ${projects} |`);
    }
    lines.push('');
  }

  // Projects
  lines.push('## Projects');
  lines.push('');
  
  for (const project of result.projects) {
    const status = project.error ? '❌' : '✅';
    const s = project.analysis?.summary;
    
    lines.push(`### ${status} ${project.project.name}`);
    lines.push('');
    lines.push(`- **Path:** \`${project.project.relativePath}\``);
    lines.push(`- **Language:** ${project.project.language}`);
    
    if (project.error) {
      lines.push(`- **Error:** ${project.error}`);
    } else if (s) {
      lines.push(`- **Dependencies:** ${s.total}`);
      lines.push(`- **Vulnerable+Reachable:** ${s.vulnerableReachable} | **Reachable:** ${s.reachable}`);
    }
    
    lines.push(`- **Duration:** ${project.durationMs}ms`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated in ${result.totalDurationMs}ms*`);

  return lines.join('\n');
}

// =============================================================================
// Utilities
// =============================================================================

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
