#!/usr/bin/env node

/**
 * ReachVet - CLI Entry Point
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Analyzer } from './core/analyzer.js';
import { parseSimpleJson, parseFromStdin, parseSBOM } from './input/index.js';
import { listSupportedLanguages, detectLanguage } from './languages/index.js';
import type { Component, ComponentResult, AnalysisOutput } from './types.js';

const VERSION = '0.1.0';

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
      }

      // Run analysis
      const analyzer = new Analyzer({
        sourceDir: options.source,
        language: options.language,
        verbose: options.verbose
      });

      const output = await analyzer.analyze(components);

      // Output JSON
      const json = options.pretty
        ? JSON.stringify(output, null, 2)
        : JSON.stringify(output);
      console.log(json);

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
        language: options.language
      });

      const output = await analyzer.analyze(components);

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

// Run CLI
program.parse();
