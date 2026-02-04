#!/usr/bin/env node

/**
 * ReachVet - CLI Entry Point
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Analyzer } from './core/analyzer.js';
import { OSVClient } from './osv/index.js';
import { parseSimpleJson, parseFromStdin, parseSBOM } from './input/index.js';
import { listSupportedLanguages, detectLanguage } from './languages/index.js';
import { toSarif, generateGraph, printAnnotations } from './output/index.js';
import { startWatch, Watcher } from './watch/index.js';
import {
  isGitRepository,
  getStagedFiles,
  filterByLanguage,
  detectLanguageFromStaged,
  hasRelevantStagedFiles,
  formatPreCommitOutput,
  generatePreCommitConfig,
} from './precommit/index.js';
import type { Component, ComponentResult, AnalysisOutput, SupportedLanguage } from './types.js';
import { writeFile } from 'node:fs/promises';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('reachvet')
  .description('Supply chain reachability analyzer - Check if dependencies are actually used')
  .version(VERSION);

// === analyze command ===
program
  .command('analyze')
  .description('Analyze if components are reachable in source code')
  .requiredOption('-s, --source <dir>', 'Source code directory to analyze')
  .option('-c, --components <file>', 'JSON file with component list')
  .option('--sbom <file>', 'SBOM file (CycloneDX or SPDX)')
  .option('--stdin', 'Read component list from stdin')
  .option('-l, --language <lang>', 'Language (javascript, typescript)')
  .option('-v, --verbose', 'Show progress')
  .option('--pretty', 'Pretty print JSON output')
  .option('--sarif', 'Output in SARIF format (for GitHub Code Scanning)')
  .option('--graph [file]', 'Output dependency graph in Mermaid format')
  .option('--dot [file]', 'Output dependency graph in DOT (Graphviz) format')
  .option('--graph-direction <dir>', 'Graph direction: TB, LR, BT, RL', 'TB')
  .option('--vulnerable-only', 'Only show vulnerable/reachable in graph')
  .option('--osv', 'Fetch vulnerability data from OSV.dev')
  .option('--osv-cache <dir>', 'OSV cache directory')
  .option('--osv-ttl <seconds>', 'OSV cache TTL in seconds', parseInt)
  .option('--annotations', 'Output GitHub Actions annotations')
  .option('--annotations-notices', 'Include notice-level annotations for imported deps')
  .action(async (options) => {
    try {
      // Load components
      let components: Component[];

      if (options.stdin) {
        components = await parseFromStdin();
      } else if (options.sbom) {
        components = await parseSBOM(options.sbom);
      } else if (options.components) {
        components = await parseSimpleJson(options.components);
      } else {
        console.error(chalk.red('Error: Provide --components, --sbom, or --stdin'));
        process.exit(1);
      }

      if (components.length === 0) {
        console.error(chalk.red('Error: No components to analyze'));
        process.exit(1);
      }

      if (options.verbose) {
        console.error(chalk.cyan(`ReachVet v${VERSION}`));
        console.error(chalk.gray(`Analyzing ${components.length} components...`));
        if (options.osv) {
          console.error(chalk.gray('OSV vulnerability lookup: enabled'));
        }
      }

      // Run analysis
      const analyzer = new Analyzer({
        sourceDir: options.source,
        language: options.language,
        verbose: options.verbose,
        osvLookup: options.osv,
        osvOptions: options.osv ? {
          cache: {
            enabled: true,
            directory: options.osvCache,
            ttlSeconds: options.osvTtl ?? 3600,
          },
        } : undefined,
      });

      const output = await analyzer.analyze(components);

      // Output in selected format
      if (options.graph !== undefined || options.dot !== undefined) {
        const format = options.dot !== undefined ? 'dot' : 'mermaid';
        const graphOutput = generateGraph(output.results, {
          format,
          direction: options.graphDirection as 'TB' | 'LR' | 'BT' | 'RL',
          vulnerableOnly: options.vulnerableOnly,
        });
        const filePath = options.dot !== undefined ? options.dot : options.graph;
        if (typeof filePath === 'string') {
          await writeFile(filePath, graphOutput, 'utf-8');
          if (options.verbose) {
            console.error(chalk.green(`Graph written to ${filePath}`));
          }
        } else {
          console.log(graphOutput);
        }
      } else if (options.sarif) {
        const sarif = toSarif(output);
        const json = options.pretty
          ? JSON.stringify(sarif, null, 2)
          : JSON.stringify(sarif);
        console.log(json);
      } else if (options.annotations) {
        // Output GitHub Actions annotations
        printAnnotations(output, {
          errors: true,
          warnings: true,
          notices: options.annotationsNotices ?? false,
        });
        // Also output JSON summary
        const json = options.pretty
          ? JSON.stringify(output, null, 2)
          : JSON.stringify(output);
        console.log(json);
      } else {
        const json = options.pretty
          ? JSON.stringify(output, null, 2)
          : JSON.stringify(output);
        console.log(json);
      }

      // Exit codes
      if (output.summary.vulnerableReachable > 0) {
        process.exit(2);
      } else if (output.summary.reachable > 0) {
        process.exit(0);
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// === check command (human readable) ===
program
  .command('check')
  .description('Check reachability with human-readable output')
  .requiredOption('-s, --source <dir>', 'Source code directory')
  .option('-c, --components <file>', 'JSON file with component list')
  .option('--sbom <file>', 'SBOM file (CycloneDX or SPDX)')
  .option('--stdin', 'Read component list from stdin')
  .option('-l, --language <lang>', 'Language (javascript, typescript)')
  .option('--json', 'Output as JSON instead')
  .option('--sarif', 'Output in SARIF format (for GitHub Code Scanning)')
  .option('--graph [file]', 'Output dependency graph in Mermaid format')
  .option('--dot [file]', 'Output dependency graph in DOT (Graphviz) format')
  .option('--graph-direction <dir>', 'Graph direction: TB, LR, BT, RL', 'TB')
  .option('--vulnerable-only', 'Only show vulnerable/reachable in graph')
  .option('--osv', 'Fetch vulnerability data from OSV.dev')
  .option('--osv-cache <dir>', 'OSV cache directory')
  .option('--osv-ttl <seconds>', 'OSV cache TTL in seconds', parseInt)
  .option('--annotations', 'Output GitHub Actions annotations')
  .option('--annotations-notices', 'Include notice-level annotations for imported deps')
  .action(async (options) => {
    try {
      // Load components
      let components: Component[];

      if (options.stdin) {
        components = await parseFromStdin();
      } else if (options.sbom) {
        components = await parseSBOM(options.sbom);
      } else if (options.components) {
        components = await parseSimpleJson(options.components);
      } else {
        console.error(chalk.red('Error: Provide --components, --sbom, or --stdin'));
        process.exit(1);
      }

      // Run analysis
      const analyzer = new Analyzer({
        sourceDir: options.source,
        language: options.language,
        osvLookup: options.osv,
        osvOptions: options.osv ? {
          cache: {
            enabled: true,
            directory: options.osvCache,
            ttlSeconds: options.osvTtl ?? 3600,
          },
        } : undefined,
      });

      const output = await analyzer.analyze(components);

      if (options.graph !== undefined || options.dot !== undefined) {
        const format = options.dot !== undefined ? 'dot' : 'mermaid';
        const graphOutput = generateGraph(output.results, {
          format,
          direction: options.graphDirection as 'TB' | 'LR' | 'BT' | 'RL',
          vulnerableOnly: options.vulnerableOnly,
        });
        const filePath = options.dot !== undefined ? options.dot : options.graph;
        if (typeof filePath === 'string') {
          await writeFile(filePath, graphOutput, 'utf-8');
          console.error(chalk.green(`Graph written to ${filePath}`));
        } else {
          console.log(graphOutput);
        }
        return;
      }

      if (options.sarif) {
        const sarif = toSarif(output);
        console.log(JSON.stringify(sarif, null, 2));
        return;
      }

      if (options.annotations) {
        // Output GitHub Actions annotations before human-readable report
        printAnnotations(output, {
          errors: true,
          warnings: true,
          notices: options.annotationsNotices ?? false,
        });
      }

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Human-readable output
      printReport(output);

      // Exit codes
      if (output.summary.vulnerableReachable > 0) {
        process.exit(2);
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// === languages command ===
program
  .command('languages')
  .description('List supported languages')
  .action(() => {
    console.log(chalk.cyan('\nSupported Languages:\n'));
    for (const lang of listSupportedLanguages()) {
      console.log(`  • ${lang}`);
    }
    console.log();
  });

// === detect command ===
program
  .command('detect')
  .description('Auto-detect language from source directory')
  .argument('<dir>', 'Source directory')
  .action(async (dir) => {
    const lang = await detectLanguage(dir);
    if (lang) {
      console.log(lang);
    } else {
      console.error(chalk.red('Could not detect language'));
      process.exit(1);
    }
  });

// === osv-lookup command ===
program
  .command('osv-lookup')
  .description('Look up vulnerabilities from OSV.dev')
  .requiredOption('-p, --package <name>', 'Package name')
  .requiredOption('-v, --version <version>', 'Package version')
  .option('-e, --ecosystem <ecosystem>', 'Package ecosystem (default: npm)', 'npm')
  .option('--functions', 'Show vulnerable functions only')
  .option('--pretty', 'Pretty print JSON')
  .action(async (options) => {
    try {
      const client = new OSVClient();
      const info = await client.getPackageVulnerabilityInfo(
        options.ecosystem,
        options.package,
        options.version
      );

      if (options.functions) {
        // Show only vulnerable functions
        const allFunctions: string[] = [];
        for (const vuln of info.vulnerabilities) {
          allFunctions.push(...vuln.functions);
        }
        const uniqueFunctions = [...new Set(allFunctions)];
        
        if (uniqueFunctions.length === 0) {
          console.log(chalk.yellow('No vulnerable function information available'));
        } else {
          console.log(chalk.cyan('Vulnerable functions:'));
          for (const fn of uniqueFunctions) {
            console.log(`  • ${fn}`);
          }
        }
      } else {
        // Full output
        const json = options.pretty
          ? JSON.stringify(info, null, 2)
          : JSON.stringify(info);
        console.log(json);
      }

      // Exit code based on vulnerabilities found
      if (info.vulnerabilities.length > 0) {
        process.exit(1);
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// === osv-cache command ===
program
  .command('osv-cache')
  .description('Manage OSV cache')
  .option('--stats', 'Show cache statistics')
  .option('--clear', 'Clear cache')
  .option('--dir <directory>', 'Cache directory')
  .action(async (options) => {
    try {
      const client = new OSVClient({
        cache: {
          directory: options.dir,
          enabled: true,
        },
      });

      if (options.clear) {
        const cleared = await client.clearCache();
        console.log(chalk.green(`Cleared ${cleared} cache entries`));
      } else if (options.stats) {
        const stats = await client.cacheStats();
        console.log(chalk.cyan('OSV Cache Statistics:'));
        console.log(`  Entries: ${stats.entries}`);
        console.log(`  Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
        console.log(`  Expired: ${stats.expiredCount}`);
      } else {
        const stats = await client.cacheStats();
        console.log(JSON.stringify(stats, null, 2));
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// === watch command ===
program
  .command('watch')
  .description('Watch source files and re-analyze on changes')
  .requiredOption('-s, --source <dir>', 'Source code directory to watch')
  .option('-c, --components <file>', 'JSON file with component list')
  .option('--sbom <file>', 'SBOM file (CycloneDX or SPDX)')
  .option('-l, --language <lang>', 'Language (auto-detect if not specified)')
  .option('--osv', 'Fetch vulnerability data from OSV.dev')
  .option('--osv-cache <dir>', 'OSV cache directory')
  .option('--osv-ttl <seconds>', 'OSV cache TTL in seconds', parseInt)
  .option('--debounce <ms>', 'Debounce delay in milliseconds', parseInt, 500)
  .option('--quiet', 'Quiet mode - only show summary line')
  .option('--ignore <patterns...>', 'Additional glob patterns to ignore')
  .action(async (options) => {
    try {
      // Load components
      let components: Component[];

      if (options.sbom) {
        components = await parseSBOM(options.sbom);
      } else if (options.components) {
        components = await parseSimpleJson(options.components);
      } else {
        console.error(chalk.red('Error: Provide --components or --sbom'));
        process.exit(1);
      }

      if (components.length === 0) {
        console.error(chalk.red('Error: No components to analyze'));
        process.exit(1);
      }

      // Build ignore patterns
      const defaultIgnored = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];
      const ignored = options.ignore
        ? [...defaultIgnored, ...options.ignore]
        : defaultIgnored;

      // Start watcher
      let watcher: Watcher | null = null;
      
      watcher = await startWatch({
        sourceDir: options.source,
        components,
        language: options.language as SupportedLanguage | undefined,
        osvLookup: options.osv,
        osvOptions: options.osv ? {
          cache: {
            enabled: true,
            directory: options.osvCache,
            ttlSeconds: options.osvTtl ?? 3600,
          },
        } : undefined,
        debounceMs: options.debounce,
        quiet: options.quiet,
        ignored,
      });

      // Handle Ctrl+C gracefully
      const cleanup = async () => {
        if (watcher) {
          await watcher.stop();
          process.exit(0);
        }
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Keep process alive
      await new Promise<void>(() => {});

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// === pre-commit command ===
program
  .command('pre-commit')
  .description('Run reachability check as a pre-commit hook (analyzes staged files)')
  .option('-c, --components <file>', 'JSON file with component list')
  .option('--sbom <file>', 'SBOM file (CycloneDX or SPDX)')
  .option('-l, --language <lang>', 'Language (auto-detect if not specified)')
  .option('--osv', 'Fetch vulnerability data from OSV.dev')
  .option('--osv-cache <dir>', 'OSV cache directory')
  .option('--osv-ttl <seconds>', 'OSV cache TTL in seconds', parseInt)
  .option('--verbose', 'Show detailed output')
  .option('--no-color', 'Disable colored output')
  .option('--block-on-reachable', 'Exit non-zero if any dependency is reachable (not just vulnerable)')
  .option('--skip-no-staged', 'Skip check if no relevant files are staged (exit 0)')
  .action(async (options) => {
    try {
      // Check if we're in a git repo
      if (!isGitRepository()) {
        console.error(chalk.red('Error: Not a git repository'));
        process.exit(1);
      }

      // Check for relevant staged files
      if (!hasRelevantStagedFiles()) {
        if (options.skipNoStaged) {
          if (!options.noColor) {
            console.log(chalk.gray('No relevant files staged, skipping check.'));
          }
          process.exit(0);
        }
        console.error(chalk.yellow('No relevant source files staged'));
        process.exit(0);
      }

      // Load components
      let components: Component[] | undefined;

      if (options.sbom) {
        components = await parseSBOM(options.sbom);
      } else if (options.components) {
        components = await parseSimpleJson(options.components);
      } else {
        // Try to auto-detect SBOM or package files
        const sbomCandidates = [
          'sbom.json', 'bom.json', 'cyclonedx.json', 'spdx.json',
          '.sbom.json', 'sbom/bom.json',
        ];
        const { existsSync } = await import('node:fs');
        for (const candidate of sbomCandidates) {
          try {
            if (existsSync(candidate)) {
              components = await parseSBOM(candidate);
              if (options.verbose) {
                console.log(chalk.gray(`Using SBOM: ${candidate}`));
              }
              break;
            }
          } catch {
            continue;
          }
        }
        if (!components) {
          console.error(chalk.red('Error: No SBOM or components file found.'));
          console.error(chalk.gray('  Provide --sbom or --components, or create sbom.json'));
          process.exit(1);
        }
      }

      if (components.length === 0) {
        console.error(chalk.yellow('No components to check'));
        process.exit(0);
      }

      // Get staged files
      const stagedFiles = getStagedFiles();
      
      // Detect or use specified language
      let language: SupportedLanguage | undefined = options.language;
      if (!language) {
        const detected = detectLanguageFromStaged(stagedFiles);
        if (detected) {
          language = detected;
        }
      }

      if (!language) {
        console.error(chalk.red('Error: Could not detect language from staged files'));
        console.error(chalk.gray('  Specify language with --language'));
        process.exit(1);
      }

      // Filter to relevant staged files
      const relevantFiles = filterByLanguage(stagedFiles, language);
      
      if (relevantFiles.length === 0) {
        if (options.skipNoStaged) {
          if (!options.noColor) {
            console.log(chalk.gray(`No ${language} files staged, skipping check.`));
          }
          process.exit(0);
        }
      }

      if (options.verbose) {
        console.log(chalk.gray(`Checking ${relevantFiles.length} staged ${language} files...`));
      }

      // Run analysis on current source (staged content would require temp files)
      const analyzer = new Analyzer({
        sourceDir: '.',
        language,
        verbose: false,
        osvLookup: options.osv,
        osvOptions: options.osv ? {
          cache: {
            enabled: true,
            directory: options.osvCache,
            ttlSeconds: options.osvTtl ?? 3600,
          },
        } : undefined,
      });

      const output = await analyzer.analyze(components);

      // Format and print output
      const formatted = formatPreCommitOutput(output, {
        color: options.color !== false,
        verbose: options.verbose,
      });
      console.log(formatted);

      // Exit codes
      if (output.summary.vulnerableReachable > 0) {
        process.exit(1);
      } else if (options.blockOnReachable && output.summary.reachable > 0) {
        process.exit(1);
      }
      process.exit(0);

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// === pre-commit-config command ===
program
  .command('pre-commit-config')
  .description('Generate .pre-commit-hooks.yaml configuration')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .action(async (options) => {
    const config = generatePreCommitConfig();
    
    if (options.output) {
      await writeFile(options.output, config, 'utf-8');
      console.log(chalk.green(`Written to ${options.output}`));
    } else {
      console.log(config);
    }
  });

// === Helper Functions ===

function printReport(output: AnalysisOutput): void {
  console.log();
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold('  ReachVet Analysis Report'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log();
  console.log(chalk.gray(`Source: ${output.sourceDir}`));
  console.log(chalk.gray(`Language: ${output.language}`));
  console.log(chalk.gray(`Timestamp: ${output.timestamp}`));
  console.log();

  // Summary
  console.log(chalk.bold('Summary:'));
  console.log(`  Total components: ${output.summary.total}`);
  console.log(`  ${chalk.red('🔴 Reachable:')} ${output.summary.reachable}`);
  console.log(`  ${chalk.yellow('🟡 Imported (usage unclear):')} ${output.summary.imported}`);
  console.log(`  ${chalk.green('🟢 Not reachable:')} ${output.summary.notReachable}`);
  console.log(`  ${chalk.gray('⚪ Unknown:')} ${output.summary.unknown}`);
  
  if (output.summary.vulnerableReachable > 0) {
    console.log();
    console.log(chalk.red.bold(`  ⚠️  VULNERABLE & REACHABLE: ${output.summary.vulnerableReachable}`));
  }

  console.log();
  console.log(chalk.bold('Details:'));
  console.log();

  // Group by status
  const reachable = output.results.filter(r => r.status === 'reachable');
  const imported = output.results.filter(r => r.status === 'imported');
  const notReachable = output.results.filter(r => r.status === 'not_reachable');
  const unknown = output.results.filter(r => r.status === 'unknown');

  if (reachable.length > 0) {
    console.log(chalk.red.bold('Reachable:'));
    for (const result of reachable) {
      printComponentResult(result, 'red');
    }
    console.log();
  }

  if (imported.length > 0) {
    console.log(chalk.yellow.bold('Imported (usage unclear):'));
    for (const result of imported) {
      printComponentResult(result, 'yellow');
    }
    console.log();
  }

  if (notReachable.length > 0) {
    console.log(chalk.green.bold('Not Reachable:'));
    for (const result of notReachable) {
      printComponentResult(result, 'green');
    }
    console.log();
  }

  if (unknown.length > 0) {
    console.log(chalk.gray.bold('Unknown:'));
    for (const result of unknown) {
      printComponentResult(result, 'gray');
    }
    console.log();
  }
}

function printComponentResult(result: ComponentResult, color: 'red' | 'yellow' | 'green' | 'gray'): void {
  const colorFn = chalk[color];
  const hasVuln = result.component.vulnerabilities && result.component.vulnerabilities.length > 0;
  const vulnMarker = hasVuln ? chalk.red(' ⚠️ VULNERABLE') : '';
  
  console.log(`  ${colorFn('●')} ${result.component.name}@${result.component.version}${vulnMarker}`);
  
  if (result.usage) {
    console.log(chalk.gray(`    Import style: ${result.usage.importStyle}`));
    if (result.usage.usedMembers && result.usage.usedMembers.length > 0) {
      console.log(chalk.gray(`    Used: ${result.usage.usedMembers.join(', ')}`));
    }
    if (result.usage.locations.length > 0) {
      console.log(chalk.gray(`    Locations:`));
      for (const loc of result.usage.locations.slice(0, 3)) {
        console.log(chalk.gray(`      - ${loc.file}:${loc.line}`));
      }
      if (result.usage.locations.length > 3) {
        console.log(chalk.gray(`      ... and ${result.usage.locations.length - 3} more`));
      }
    }
  }

  if (result.notes && result.notes.length > 0) {
    for (const note of result.notes) {
      console.log(chalk.gray(`    ℹ️  ${note}`));
    }
  }

  if (hasVuln) {
    for (const vuln of result.component.vulnerabilities!) {
      console.log(chalk.red(`    🔓 ${vuln.id}${vuln.severity ? ` (${vuln.severity})` : ''}`));
      if (vuln.affectedFunctions && vuln.affectedFunctions.length > 0) {
        console.log(chalk.red(`       Affected: ${vuln.affectedFunctions.join(', ')}`));
      }
    }
  }
}

// === init command ===
program
  .command('init')
  .description('Create a configuration file in the current directory')
  .option('-f, --format <format>', 'Config format: json, js', 'json')
  .option('--force', 'Overwrite existing config file')
  .action(async (options) => {
    const { generateSampleConfig, findConfigPath } = await import('./config/index.js');
    
    // Check for existing config
    const existing = findConfigPath(process.cwd());
    if (existing && !options.force) {
      console.error(chalk.yellow(`Config file already exists: ${existing}`));
      console.error(chalk.gray('Use --force to overwrite'));
      process.exit(1);
    }
    
    // Generate config content
    const content = generateSampleConfig(options.format as 'json' | 'js');
    
    // Determine filename
    let filename: string;
    if (options.format === 'js') {
      filename = 'reachvet.config.cjs';
    } else {
      filename = '.reachvetrc.json';
    }
    
    // Write file
    await writeFile(filename, content);
    console.log(chalk.green(`✓ Created ${filename}`));
    console.log();
    console.log('Edit the config file to customize ReachVet behavior.');
    console.log('Documentation: https://github.com/taku-tez/ReachVet#configuration');
  });

// === config command ===
program
  .command('config')
  .description('Show current configuration')
  .option('-c, --config <file>', 'Path to config file')
  .option('--validate', 'Validate the configuration')
  .action(async (options) => {
    const { loadConfig, validateConfig, findConfigPath } = await import('./config/index.js');
    
    const config = loadConfig(process.cwd(), options.config);
    
    if (!config) {
      const configPath = findConfigPath(process.cwd());
      if (configPath) {
        console.error(chalk.red(`Failed to load config from: ${configPath}`));
      } else {
        console.error(chalk.yellow('No configuration file found.'));
        console.error(chalk.gray('Run `reachvet init` to create one.'));
      }
      process.exit(1);
    }
    
    // Display config location
    const configPath = options.config || findConfigPath(process.cwd());
    console.log(chalk.cyan(`Config loaded from: ${configPath}`));
    console.log();
    
    // Validate if requested
    if (options.validate) {
      const validation = validateConfig(config);
      if (validation.valid) {
        console.log(chalk.green('✓ Configuration is valid'));
      } else {
        console.log(chalk.red('✗ Configuration has errors:'));
        for (const error of validation.errors) {
          console.log(chalk.red(`  - ${error}`));
        }
        process.exit(1);
      }
      console.log();
    }
    
    // Display configuration
    console.log(chalk.gray('Current configuration:'));
    console.log(JSON.stringify(config, null, 2));
  });

// === serve command ===
program
  .command('serve')
  .description('Start ReachVet API server')
  .option('-p, --port <port>', 'Port number', parseInt, 3000)
  .option('-H, --host <host>', 'Host to bind', '127.0.0.1')
  .option('--cors', 'Enable CORS (default: true)', true)
  .option('--no-cors', 'Disable CORS')
  .option('--api-key <key>', 'Require API key for authentication')
  .option('--rate-limit <max>', 'Max requests per minute', parseInt, 100)
  .option('--no-rate-limit', 'Disable rate limiting')
  .option('--osv-cache', 'Enable OSV cache (default: true)', true)
  .option('--no-osv-cache', 'Disable OSV cache')
  .option('--cache-ttl <ms>', 'OSV cache TTL in milliseconds', parseInt, 3600000)
  .action(async (options) => {
    const { ReachVetServer } = await import('./server/index.js');
    
    const server = new ReachVetServer({
      port: options.port,
      host: options.host,
      cors: options.cors,
      apiKey: options.apiKey,
      rateLimit: options.rateLimit === false ? undefined : {
        windowMs: 60000,
        maxRequests: options.rateLimit,
      },
      osvCache: options.osvCache,
      cacheTtl: options.cacheTtl,
    });

    // Event handlers
    server.on('listening', ({ port, host }: { port: number; host: string }) => {
      console.log(chalk.green(`🚀 ReachVet API server running at http://${host}:${port}`));
      console.log();
      console.log(chalk.gray('Endpoints:'));
      console.log(chalk.gray('  GET  /              Health check'));
      console.log(chalk.gray('  GET  /info          Server info'));
      console.log(chalk.gray('  POST /analyze       Analyze project'));
      console.log(chalk.gray('  POST /check         Check dependency'));
      console.log(chalk.gray('  POST /osv/query     Query OSV database'));
      console.log(chalk.gray('  POST /osv/batch     Batch OSV query'));
      console.log(chalk.gray('  GET  /languages     List supported languages'));
      console.log();
      if (options.apiKey) {
        console.log(chalk.yellow('🔒 API key authentication enabled'));
      }
      if (options.rateLimit !== false) {
        console.log(chalk.gray(`Rate limit: ${options.rateLimit} requests/minute`));
      }
      console.log();
      console.log(chalk.gray('Press Ctrl+C to stop'));
    });

    server.on('request', ({ status, durationMs, path }: { status: number; durationMs: number; path: string }) => {
      const statusColor = status < 400 ? chalk.green : status < 500 ? chalk.yellow : chalk.red;
      console.log(`${statusColor(status)} ${path} ${chalk.gray(`${durationMs}ms`)}`);
    });

    server.on('error', (err: Error) => {
      console.error(chalk.red(`Server error: ${err.message}`));
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log();
      console.log(chalk.gray('Shutting down...'));
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await server.stop();
      process.exit(0);
    });

    try {
      await server.start();
    } catch (err) {
      const error = err as Error;
      console.error(chalk.red(`Failed to start server: ${error.message}`));
      process.exit(1);
    }
  });

// Run CLI
program.parse();
