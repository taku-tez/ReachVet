/**
 * Tests for Shell Completions Generator
 */

import { describe, it, expect } from 'vitest';
import {
  generateCompletions,
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
  getSupportedShells,
  getInstallInstructions,
  ShellType,
} from '../src/completions/index.js';
import { VERSION } from '../src/version.js';

describe('Shell Completions', () => {
  describe('getSupportedShells', () => {
    it('returns array of supported shells', () => {
      const shells = getSupportedShells();
      expect(shells).toContain('bash');
      expect(shells).toContain('zsh');
      expect(shells).toContain('fish');
      expect(shells).toHaveLength(3);
    });
  });

  describe('generateCompletions', () => {
    it('generates bash completions', () => {
      const script = generateCompletions('bash');
      expect(script).toContain('# Bash completion for reachvet');
      expect(script).toContain('_reachvet_completions');
      expect(script).toContain('complete -F _reachvet_completions reachvet');
    });

    it('generates zsh completions', () => {
      const script = generateCompletions('zsh');
      expect(script).toContain('#compdef reachvet');
      expect(script).toContain('_reachvet');
      expect(script).toContain('_describe');
    });

    it('generates fish completions', () => {
      const script = generateCompletions('fish');
      expect(script).toContain('# Fish completion for reachvet');
      expect(script).toContain('complete -c reachvet');
    });

    it('throws on unsupported shell', () => {
      expect(() => generateCompletions('powershell' as ShellType)).toThrow('Unsupported shell');
    });
  });

  describe('generateBashCompletions', () => {
    const script = generateBashCompletions();

    it('includes version', () => {
      expect(script).toContain(`v${VERSION}`);
    });

    it('includes installation instructions', () => {
      expect(script).toContain('# Installation:');
      expect(script).toContain('source <(reachvet completions bash)');
    });

    it('includes all commands', () => {
      expect(script).toContain('analyze');
      expect(script).toContain('check');
      expect(script).toContain('languages');
      expect(script).toContain('detect');
      expect(script).toContain('osv-lookup');
      expect(script).toContain('osv-cache');
      expect(script).toContain('watch');
      expect(script).toContain('pre-commit');
      expect(script).toContain('pre-commit-config');
      expect(script).toContain('init');
      expect(script).toContain('config');
      expect(script).toContain('serve');
      expect(script).toContain('completions');
    });

    it('includes language completions', () => {
      expect(script).toContain('javascript');
      expect(script).toContain('typescript');
      expect(script).toContain('python');
      expect(script).toContain('go');
      expect(script).toContain('java');
      expect(script).toContain('rust');
      expect(script).toContain('ruby');
      expect(script).toContain('php');
      expect(script).toContain('csharp');
      expect(script).toContain('swift');
      expect(script).toContain('kotlin');
      expect(script).toContain('scala');
      expect(script).toContain('elixir');
      expect(script).toContain('dart');
      expect(script).toContain('perl');
      expect(script).toContain('haskell');
      expect(script).toContain('clojure');
      expect(script).toContain('ocaml');
    });

    it('includes option completions for analyze', () => {
      expect(script).toContain('--source');
      expect(script).toContain('--components');
      expect(script).toContain('--sbom');
      expect(script).toContain('--osv');
      expect(script).toContain('--sarif');
      expect(script).toContain('--junit');
    });

    it('includes ecosystem completions for osv-lookup', () => {
      expect(script).toContain('npm');
      expect(script).toContain('pypi');
      expect(script).toContain('maven');
      expect(script).toContain('cargo');
    });

    it('includes graph direction completions', () => {
      expect(script).toContain('TB LR BT RL');
    });

    it('has _init_completion guard', () => {
      expect(script).toContain('_init_completion || return');
    });
  });

  describe('generateZshCompletions', () => {
    const script = generateZshCompletions();

    it('includes version', () => {
      expect(script).toContain(`v${VERSION}`);
    });

    it('includes compdef header', () => {
      expect(script).toContain('#compdef reachvet');
    });

    it('includes installation instructions', () => {
      expect(script).toContain('# Installation:');
      expect(script).toContain('fpath=');
      expect(script).toContain('compinit');
    });

    it('includes all commands with descriptions', () => {
      expect(script).toContain('analyze:Analyze if components are reachable');
      expect(script).toContain('check:Check reachability with human-readable');
      expect(script).toContain('serve:Start ReachVet API server');
    });

    it('includes command-specific argument specs', () => {
      // analyze command
      expect(script).toContain('-s[Source directory]');
      expect(script).toContain('--sarif[Output SARIF format]');
      
      // serve command
      expect(script).toContain('-p[Port]');
      expect(script).toContain('--api-key[API key]');
      
      // osv-lookup command
      expect(script).toContain('-p[Package name]');
      expect(script).toContain('--ecosystem[Ecosystem]');
    });

    it('includes directory/file completion hints', () => {
      expect(script).toContain('_files -/');
      expect(script).toContain('_files -g "*.json"');
    });

    it('includes state machine for subcommands', () => {
      expect(script).toContain("'1: :->command'");
      expect(script).toContain("'*: :->args'");
      expect(script).toContain('case $state in');
    });
  });

  describe('generateFishCompletions', () => {
    const script = generateFishCompletions();

    it('includes version', () => {
      expect(script).toContain(`v${VERSION}`);
    });

    it('includes installation instructions', () => {
      expect(script).toContain('# Installation:');
      expect(script).toContain('~/.config/fish/completions/reachvet.fish');
    });

    it('disables file completions by default', () => {
      expect(script).toContain('complete -c reachvet -f');
    });

    it('includes all commands with descriptions', () => {
      expect(script).toContain('-a "analyze" -d "Analyze if components are reachable');
      expect(script).toContain('-a "check" -d "Check reachability with human-readable');
      expect(script).toContain('-a "serve" -d "Start ReachVet API server');
    });

    it('includes language completions for relevant commands', () => {
      expect(script).toContain('__fish_seen_subcommand_from analyze check watch pre-commit');
      expect(script).toContain('-l language -s l -xa');
    });

    it('includes subcommand-specific completions', () => {
      // analyze
      expect(script).toContain('__fish_seen_subcommand_from analyze');
      expect(script).toContain('-s s -l source -d "Source directory"');
      
      // serve
      expect(script).toContain('__fish_seen_subcommand_from serve');
      expect(script).toContain('-l port -d "Port number"');
      
      // osv-lookup
      expect(script).toContain('__fish_seen_subcommand_from osv-lookup');
      expect(script).toContain('-l ecosystem -d "Ecosystem" -xa');
    });

    it('includes directory/file completion hints', () => {
      expect(script).toContain('__fish_complete_directories');
      expect(script).toContain('-r -F'); // file completion
    });

    it('includes completions for completions command itself', () => {
      expect(script).toContain('__fish_seen_subcommand_from completions');
      expect(script).toContain('-xa "bash zsh fish"');
    });
  });

  describe('getInstallInstructions', () => {
    it('returns bash instructions', () => {
      const instructions = getInstallInstructions('bash');
      expect(instructions).toContain('# Installation for Bash:');
      expect(instructions).toContain('~/.bashrc');
      expect(instructions).toContain('/etc/bash_completion.d/reachvet');
    });

    it('returns zsh instructions', () => {
      const instructions = getInstallInstructions('zsh');
      expect(instructions).toContain('# Installation for Zsh:');
      expect(instructions).toContain('~/.zsh/completions');
      expect(instructions).toContain('fpath=');
      expect(instructions).toContain('compinit');
      expect(instructions).toContain('Oh My Zsh');
    });

    it('returns fish instructions', () => {
      const instructions = getInstallInstructions('fish');
      expect(instructions).toContain('# Installation for Fish:');
      expect(instructions).toContain('~/.config/fish/completions/reachvet.fish');
      expect(instructions).toContain('loaded automatically');
    });

    it('handles unknown shell gracefully', () => {
      const instructions = getInstallInstructions('invalid' as ShellType);
      expect(instructions).toContain('Unknown shell');
    });
  });

  describe('Completeness', () => {
    it('all 18 languages are included in all shell completions', () => {
      const languages = [
        'javascript', 'typescript', 'python', 'go', 'java', 'rust',
        'ruby', 'php', 'csharp', 'swift', 'kotlin', 'scala',
        'elixir', 'dart', 'perl', 'haskell', 'clojure', 'ocaml'
      ];

      for (const shell of getSupportedShells()) {
        const script = generateCompletions(shell);
        for (const lang of languages) {
          expect(script).toContain(lang);
        }
      }
    });

    it('all major commands are included in all shell completions', () => {
      const commands = [
        'analyze', 'check', 'watch', 'serve', 'init', 'config',
        'completions', 'languages', 'detect', 'pre-commit'
      ];

      for (const shell of getSupportedShells()) {
        const script = generateCompletions(shell);
        for (const cmd of commands) {
          expect(script).toContain(cmd);
        }
      }
    });

    it('SBOM output options are included', () => {
      for (const shell of getSupportedShells()) {
        const script = generateCompletions(shell);
        expect(script).toContain('sbom-cyclonedx');
        expect(script).toContain('sbom-spdx');
        expect(script).toContain('vex');
      }
    });
  });
});
