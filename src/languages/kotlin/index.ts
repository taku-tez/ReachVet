/**
 * ReachVet - Kotlin Language Adapter
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseLanguageAdapter } from '../base.js';
import { parseSource, findClassUsages, getPackagesForArtifact, isStandardPackage, type KotlinImportInfo } from './parser.js';
import type { Component, ComponentResult, SupportedLanguage, UsageInfo, CodeLocation, AnalysisWarning } from '../../types.js';

export class KotlinAdapter extends BaseLanguageAdapter {
  language: SupportedLanguage = 'kotlin';
  fileExtensions = ['.kt', '.kts'];

  protected ignorePatterns = [
    '**/build/**',
    '**/.gradle/**',
    '**/buildSrc/**',
    '**/*Test.kt',
    '**/*Tests.kt',
    '**/*Spec.kt',
    '**/test/**',
    '**/androidTest/**',
  ];

  async canHandle(sourceDir: string): Promise<boolean> {
    // Check for Gradle or Kotlin files
    return existsSync(join(sourceDir, 'build.gradle.kts')) ||
           existsSync(join(sourceDir, 'build.gradle')) ||
           existsSync(join(sourceDir, 'settings.gradle.kts')) ||
           existsSync(join(sourceDir, 'settings.gradle')) ||
           (await glob('**/*.kt', { cwd: sourceDir, ignore: this.ignorePatterns })).length > 0;
  }

  async analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]> {
    const files = await this.findSourceFiles(sourceDir);
    
    if (files.length === 0) {
      return components.map(c => this.unknown(c, ['No Kotlin source files found']));
    }

    // Parse all files
    const allImports: Array<{ file: string; imports: KotlinImportInfo[]; source: string }> = [];
    
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
    allImports: Array<{ file: string; imports: KotlinImportInfo[]; source: string }>
  ): ComponentResult {
    const matchingImports: Array<{ file: string; import: KotlinImportInfo; source: string }> = [];
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
    
    // Common classes from packages
    const packageToClasses: Record<string, string[]> = {
      'kotlinx.coroutines': ['CoroutineScope', 'Dispatchers', 'launch', 'async', 'withContext', 'flow', 'Flow'],
      'kotlinx.serialization': ['Json', 'Serializable', 'SerialName'],
      'retrofit2': ['Retrofit', 'Call', 'Response', 'Callback'],
      'okhttp3': ['OkHttpClient', 'Request', 'Response', 'Call'],
      'io.ktor.client': ['HttpClient', 'HttpResponse'],
      'org.koin': ['koinApplication', 'module', 'single', 'factory', 'inject', 'get'],
      'dagger.hilt': ['HiltAndroidApp', 'AndroidEntryPoint', 'Inject', 'Module', 'InstallIn'],
      'coil': ['ImageLoader', 'ImageRequest', 'rememberAsyncImagePainter'],
      'androidx.compose.ui': ['Composable', 'Modifier', 'remember', 'State'],
      'androidx.lifecycle': ['ViewModel', 'viewModelScope', 'LiveData', 'MutableLiveData'],
      'androidx.room': ['Room', 'Database', 'Entity', 'Dao', 'Query', 'Insert'],
      'com.google.gson': ['Gson', 'JsonObject', 'JsonArray'],
      'arrow.core': ['Either', 'Option', 'Some', 'None', 'Validated'],
      'io.mockk': ['mockk', 'every', 'verify', 'coEvery', 'coVerify'],
    };

    // Get class names to look for
    const classNames: string[] = [];
    for (const pkg of expectedPackages) {
      if (packageToClasses[pkg]) {
        classNames.push(...packageToClasses[pkg]);
      }
    }

    // Find class/method usages
    let usedMethods: string[] = [];
    for (const { source, file } of matchingImports) {
      const usages = findClassUsages(source, [...new Set(classNames)], file);
      usedMethods.push(...usages.filter(u => u.method).map(u => u.method!));
    }
    usedMethods = [...new Set(usedMethods)];

    const usage: UsageInfo = {
      importStyle: 'esm', // Kotlin imports are similar to ESM
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

export const kotlinAdapter = new KotlinAdapter();
