/**
 * ReachVet - Rust Language Adapter
 * Provides Rust language support for vulnerability reachability analysis
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { BaseLanguageAdapter } from '../base.js';
import {
  parseRustSource,
  parseCargoToml,
  findCrateUsages,
  isStdLibrary,
  normalizeCrateName,
  detectUnsafeCode,
  type RustUseInfo,
} from './parser.js';
import type {
  Component,
  ComponentResult,
  AnalysisWarning,
  CodeLocation,
} from '../../types.js';

export * from './parser.js';

/**
 * Rust Language Adapter for ReachVet
 */
export class RustLanguageAdapter extends BaseLanguageAdapter {
  readonly language = 'rust' as const;
  readonly fileExtensions = ['.rs'];

  /**
   * Analyze components in a Rust project
   */
  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const results: ComponentResult[] = [];

    // Parse Cargo.toml if exists
    let cargoDeps: Map<string, string> | null = null;
    try {
      const cargoPath = join(sourceDir, 'Cargo.toml');
      const content = await fs.readFile(cargoPath, 'utf-8');
      const cargo = parseCargoToml(content);
      cargoDeps = new Map(cargo.dependencies.map(d => [normalizeCrateName(d.name), d.version]));
    } catch {
      // No Cargo.toml found
    }

    // Scan Rust files and collect use statements
    const rustFiles = await this.scanRustFiles(sourceDir);
    const fileUses = new Map<string, { uses: RustUseInfo[], content: string }>();

    for (const filePath of rustFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const relPath = filePath.startsWith(sourceDir)
          ? filePath.slice(sourceDir.length + 1)
          : filePath;
        const uses = parseRustSource(content, relPath);
        fileUses.set(relPath, { uses, content });
      } catch {
        // Skip unreadable files
      }
    }

    // Analyze each component
    for (const component of components) {
      const result = await this.analyzeComponent(
        component,
        fileUses,
        cargoDeps
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Analyze a single component for reachability
   */
  private async analyzeComponent(
    component: Component,
    fileUses: Map<string, { uses: RustUseInfo[], content: string }>,
    cargoDeps: Map<string, string> | null
  ): Promise<ComponentResult> {
    const warnings: AnalysisWarning[] = [];
    // Normalize crate name (Cargo uses - but Rust code uses _)
    const crateName = normalizeCrateName(component.name);
    
    // Check if this component is in Cargo.toml
    if (cargoDeps && !cargoDeps.has(crateName)) {
      // Check for partial match
      const hasMatch = [...cargoDeps.keys()].some(
        dep => dep === crateName || dep.startsWith(crateName + '_')
      );
      if (!hasMatch) {
        return this.notReachable(component, ['Not found in Cargo.toml dependencies']);
      }
    }

    // Look for use statements of this crate
    let foundUse = false;
    let hasUsage = false;
    let usageLocation: CodeLocation | undefined;

    for (const [file, { uses, content }] of fileUses) {
      for (const use of uses) {
        // Skip crate-local, super, and self imports
        if (use.isCrateLocal || use.isSuper || use.isSelf) continue;
        
        // Skip standard library
        if (isStdLibrary(use.crateName)) continue;

        // Check if this use matches our component
        const normalizedUseCrate = normalizeCrateName(use.crateName);
        if (normalizedUseCrate === crateName) {
          foundUse = true;

          // Glob import - assume usage
          if (use.isGlob) {
            warnings.push({
              code: 'star_import',
              message: `Glob import found - all public items are available in scope`,
              location: use.location,
              severity: 'warning',
            });
            hasUsage = true;
            usageLocation = use.location;
            continue;
          }

          // Check for actual usage in code
          const crateUsages = findCrateUsages(content, use.crateName, use.alias);
          
          // Also check for direct type/function usage from imported items
          for (const item of use.items) {
            if (item !== '*') {
              // Check if the imported item is used directly
              const itemPattern = new RegExp(`\\b${item}\\b`, 'g');
              if (itemPattern.test(content)) {
                hasUsage = true;
                usageLocation = this.findItemUsageLocation(content, item, file) || use.location;
                break;
              }
            }
          }
          
          if (crateUsages.length > 0) {
            hasUsage = true;
            usageLocation = this.findUsageLocation(content, use.crateName, crateUsages[0], file);
            break;
          }
        }
      }
      
      if (hasUsage) break;
    }

    // Detect unsafe code usage
    for (const [file, { content }] of fileUses) {
      const unsafeWarnings = detectUnsafeCode(content, file);
      for (const uw of unsafeWarnings) {
        const typeMessages: Record<string, string> = {
          'unsafe_block': 'Unsafe block - manual memory management',
          'unsafe_fn': 'Unsafe function declaration',
          'unsafe_impl': 'Unsafe trait implementation',
          'unsafe_trait': 'Unsafe trait definition'
        };
        warnings.push({
          code: 'unsafe_code',
          message: typeMessages[uw.type] || `Unsafe code: ${uw.type}`,
          location: uw.location,
          severity: 'warning'
        });
      }
    }

    // Build result
    if (!foundUse) {
      return this.notReachable(component, ['No use statements found for this crate']);
    }

    if (hasUsage && usageLocation) {
      return this.reachable(
        component,
        {
          importStyle: 'esm' as const, // Rust use is similar to ESM imports
          locations: [usageLocation],
        },
        'high',
        undefined,
        warnings.length > 0 ? warnings : undefined
      );
    }

    // Imported but no direct usage detected
    return this.imported(
      component,
      undefined,
      ['Crate is imported but no direct usage detected'],
      warnings.length > 0 ? warnings : undefined
    );
  }

  /**
   * Find the location of a function/type usage in source
   */
  private findUsageLocation(
    content: string,
    crateName: string,
    itemName: string,
    file: string
  ): CodeLocation | undefined {
    const lines = content.split('\n');
    const pattern = new RegExp(`\\b${crateName}::${itemName}\\b`);

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        return {
          file,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 100),
        };
      }
    }

    return undefined;
  }

  /**
   * Find location where an imported item is used
   */
  private findItemUsageLocation(
    content: string,
    itemName: string,
    file: string
  ): CodeLocation | undefined {
    const lines = content.split('\n');
    // Look for usage, but not the use statement itself
    const pattern = new RegExp(`\\b${itemName}\\b`);
    const usePattern = /^\s*(?:pub\s+)?use\s+/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (pattern.test(line) && !usePattern.test(line)) {
        return {
          file,
          line: i + 1,
          snippet: line.trim().slice(0, 100),
        };
      }
    }

    return undefined;
  }

  /**
   * Check if this adapter can handle the given directory
   */
  async canHandle(sourceDir: string): Promise<boolean> {
    // Check for Cargo.toml
    try {
      await fs.access(join(sourceDir, 'Cargo.toml'));
      return true;
    } catch {
      // Fall through
    }

    // Check for any .rs files
    try {
      const entries = await fs.readdir(sourceDir);
      return entries.some(e => e.endsWith('.rs'));
    } catch {
      return false;
    }
  }

  /**
   * Recursively scan for Rust files
   */
  private async scanRustFiles(
    dir: string,
    maxDepth = 10,
    currentDepth = 0
  ): Promise<string[]> {
    if (currentDepth > maxDepth) return [];

    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        // Skip hidden directories and common non-source dirs
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'target') continue;
        if (entry.name === 'node_modules') continue;

        if (entry.isDirectory()) {
          const subFiles = await this.scanRustFiles(fullPath, maxDepth, currentDepth + 1);
          files.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.rs')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory not readable
    }

    return files;
  }
}

/**
 * Parse Cargo.toml file content
 */
export { parseCargoToml as parseCargoTomlFile } from './parser.js';

/**
 * Create a Rust language adapter instance
 */
export function createRustAdapter(): RustLanguageAdapter {
  return new RustLanguageAdapter();
}

// Default adapter instance
export const rustAdapter = new RustLanguageAdapter();
