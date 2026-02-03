/**
 * ReachVet - Scala Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findTypeUsages, getPackagesForArtifact, isStandardPackage, type ScalaImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class ScalaAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'scala';
  fileExtensions = ['.scala', '.sc'];

  protected ignorePatterns = [
    '**/target/**',
    '**/.bsp/**',
    '**/.metals/**',
    '**/.bloop/**',
    '**/project/target/**',
    '**/*Test.scala',
    '**/*Spec.scala',
    '**/*Suite.scala',
    '**/test/**',
    '**/it/**',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    return existsSync(join(sourceDir, 'build.sbt')) ||
           existsSync(join(sourceDir, 'build.sc')) ||
           (await glob('**/*.scala', { cwd: sourceDir, ignore: this.ignorePatterns })).length > 0;
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No Scala source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: ScalaImportInfo[]; source: string }> = [];
    
    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const imports = parseSource(content, file);
        if (imports.length > 0) {
          allImports.push({ file, imports, source: content });
        }
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Analyze each component
    const results: ComponentResult[] = [];
    for (const component of components) {
      const result = this.analyzeComponent(component, allImports);
      results.push(result);
    }

    return results;
  }

  private analyzeComponent(
    component: Component,
    allImports: Array<{ file: string; imports: ScalaImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: ScalaImportInfo; source: string }> = [];
    const warnings: AnalysisWarning[] = [];

    // Get expected packages for this artifact
    const expectedPackages = getPackagesForArtifact(component.name);

    // Find matching imports
    for (const { file, imports, source } of allImports) {
      for (const imp of imports) {
        // Skip standard packages
        const packageName = imp.moduleName.split('.').slice(0, 2).join('.');
        if (isStandardPackage(packageName)) {
          continue;
        }

        // Check if the import matches any expected package
        const matchesPackage = expectedPackages.some(pkg => 
          imp.moduleName.startsWith(pkg) ||
          imp.moduleName.startsWith(pkg + '.') ||
          imp.moduleName === pkg
        );

        if (matchesPackage) {
          matchingImports.push({ file, import: imp, source });

          // Add warning for wildcard imports
          if (imp.importStyle === 'wildcard') {
            warnings.push({
              code: 'star_import',
              message: `Wildcard import makes usage tracking imprecise`,
              location: imp.location,
              severity: 'info'
            });
          }
        }
      }
    }

    // Not found
    if (matchingImports.length === 0) {
      return this.notReachable(component, ['No matching import statements found']);
    }

    // Collect usage info
    const locations: CodeLocation[] = matchingImports.map(m => m.import.location);
    
    // Common types from packages
    const packageToTypes: Record<string, string[]> = {
      'cats': ['Functor', 'Monad', 'Applicative', 'Traverse', 'Foldable', 'Semigroup', 'Monoid'],
      'cats.data': ['OptionT', 'EitherT', 'Validated', 'NonEmptyList', 'Chain', 'Kleisli'],
      'cats.effect': ['IO', 'Resource', 'Ref', 'Deferred', 'IOApp'],
      'zio': ['ZIO', 'UIO', 'Task', 'IO', 'ZLayer', 'ZEnvironment'],
      'akka.actor': ['Actor', 'ActorSystem', 'ActorRef', 'Props'],
      'akka.stream': ['Source', 'Sink', 'Flow', 'Graph'],
      'akka.http': ['HttpRoutes', 'Route', 'Directive'],
      'io.circe': ['Json', 'Decoder', 'Encoder', 'Codec', 'HCursor'],
      'slick': ['Database', 'Table', 'TableQuery', 'Rep'],
      'doobie': ['Transactor', 'ConnectionIO', 'Fragment', 'Query0', 'Update0'],
      'org.http4s': ['HttpRoutes', 'Request', 'Response', 'Uri', 'EntityDecoder'],
      'fs2': ['Stream', 'Pipe', 'Pull', 'Chunk'],
      'monix.eval': ['Task', 'Coeval'],
      'play.api.mvc': ['Controller', 'Action', 'Request', 'Result'],
    };

    // Get type names to look for
    const typeNames: string[] = [];
    for (const pkg of expectedPackages) {
      if (packageToTypes[pkg]) {
        typeNames.push(...packageToTypes[pkg]);
      }
    }

    // Also extract imported members
    for (const m of matchingImports) {
      if (m.import.members) {
        typeNames.push(...m.import.members.filter(mem => mem !== '_'));
      }
    }

    // Find type/method usages
    let usedMethods: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findTypeUsages(source, [...new Set(typeNames)], file);
      usedMethods.push(...usages.filter(u => u.method).map(u => u.method!));
    }
    usedMethods = [...new Set(usedMethods)];

    const usage: UsageInfo = {
      importStyle: 'esm',
      usedMembers: usedMethods.length > 0 ? usedMethods : undefined,
      locations
    };

    // Check vulnerable functions
    const vulnFunctions = component.vulnerabilities?.flatMap(v => v.affectedFunctions ?? []) ?? [];
    
    if (vulnFunctions.length > 0 && usedMethods.length > 0) {
      const affectedUsed = vulnFunctions.filter(f => usedMethods.includes(f));
      
      if (affectedUsed.length > 0) {
        return this.reachable(
          component,
          { ...usage, usedMembers: affectedUsed },
          'high',
          [`Vulnerable method(s) called: ${affectedUsed.join(', ')}`],
          warnings
        );
      }
    }

    return this.reachable(
      component,
      usage,
      'high',
      [`Used in ${locations.length} location(s)`],
      warnings
    );
  }

  protected async findSourceFiles(sourceDir: string): Promise<string[]> {
    const patterns = this.fileExtensions.map(ext => `**/*${ext}`);
    
    const files = await glob(patterns, {
      cwd: sourceDir,
      absolute: true,
      ignore: this.ignorePatterns,
      nodir: true
    });

    return files;
  }
}

export const scalaAdapter = new ScalaAdapter();
