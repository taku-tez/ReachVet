/**
 * ReachVet - Kotlin Import Parser
 * 
 * Parses Kotlin import statements:
 * - import package.name
 * - import package.name.*
 * - import package.name.Class
 * - import package.name.function
 * - import package.name.Class as Alias
 */

import type { CodeLocation } from '../../types.js';

export interface KotlinImportInfo {
  /** The package/class being imported */
  moduleName: string;
  /** Import style */
  importStyle: 'class' | 'wildcard' | 'function' | 'alias';
  /** Alias if any */
  alias?: string;
  /** Location in source */
  location: CodeLocation;
}

export interface KotlinUsageInfo {
  /** Class/type being used */
  identifier: string;
  /** Method being called (if any) */
  method?: string;
  /** Is it a static/companion call */
  isStatic: boolean;
  /** Location in source */
  location: CodeLocation;
}

// Map artifact IDs to their packages
const ARTIFACT_TO_PACKAGE: Record<string, string[]> = {
  // Kotlin stdlib/coroutines
  'kotlinx-coroutines-core': ['kotlinx.coroutines'],
  'kotlinx-coroutines-android': ['kotlinx.coroutines'],
  'kotlinx-serialization-json': ['kotlinx.serialization'],
  'kotlinx-datetime': ['kotlinx.datetime'],
  
  // AndroidX
  'core-ktx': ['androidx.core'],
  'appcompat': ['androidx.appcompat'],
  'activity-ktx': ['androidx.activity'],
  'fragment-ktx': ['androidx.fragment'],
  'lifecycle-runtime-ktx': ['androidx.lifecycle'],
  'lifecycle-viewmodel-ktx': ['androidx.lifecycle'],
  'lifecycle-livedata-ktx': ['androidx.lifecycle'],
  'compose-ui': ['androidx.compose.ui'],
  'compose-material': ['androidx.compose.material'],
  'compose-material3': ['androidx.compose.material3'],
  'navigation-compose': ['androidx.navigation.compose'],
  'room-runtime': ['androidx.room'],
  'room-ktx': ['androidx.room'],
  'datastore': ['androidx.datastore'],
  'work-runtime-ktx': ['androidx.work'],
  'paging-runtime': ['androidx.paging'],
  'hilt-android': ['dagger.hilt.android'],
  
  // Networking
  'retrofit': ['retrofit2'],
  'okhttp': ['okhttp3'],
  'okhttp-logging-interceptor': ['okhttp3.logging'],
  'ktor-client-core': ['io.ktor.client'],
  'ktor-client-android': ['io.ktor.client.engine.android'],
  'ktor-client-okhttp': ['io.ktor.client.engine.okhttp'],
  
  // DI
  'koin-android': ['org.koin'],
  'koin-core': ['org.koin.core'],
  'dagger': ['dagger'],
  'hilt-core': ['dagger.hilt'],
  
  // Database
  'realm-kotlin': ['io.realm.kotlin'],
  'sqldelight-runtime': ['com.squareup.sqldelight'],
  
  // Image loading
  'coil': ['coil'],
  'coil-compose': ['coil.compose'],
  'glide': ['com.bumptech.glide'],
  
  // Logging
  'timber': ['timber.log'],
  
  // JSON
  'gson': ['com.google.gson'],
  'moshi': ['com.squareup.moshi'],
  
  // Testing
  'junit': ['org.junit'],
  'mockk': ['io.mockk'],
  'kotest-runner-junit5': ['io.kotest'],
  'turbine': ['app.cash.turbine'],
  
  // Firebase
  'firebase-bom': ['com.google.firebase'],
  'firebase-analytics-ktx': ['com.google.firebase.analytics'],
  'firebase-auth-ktx': ['com.google.firebase.auth'],
  'firebase-firestore-ktx': ['com.google.firebase.firestore'],
  
  // Arrow
  'arrow-core': ['arrow.core'],
  'arrow-fx-coroutines': ['arrow.fx.coroutines'],
  
  // RxJava/RxKotlin
  'rxjava': ['io.reactivex.rxjava3'],
  'rxkotlin': ['io.reactivex.rxjava3.kotlin'],
  'rxandroid': ['io.reactivex.rxjava3.android'],
};

// Android/Kotlin standard packages
const STANDARD_PACKAGES = new Set([
  'kotlin', 'kotlin.collections', 'kotlin.coroutines', 'kotlin.io', 'kotlin.text',
  'java.lang', 'java.util', 'java.io', 'java.net', 'java.time',
  'android', 'android.app', 'android.content', 'android.os', 'android.view',
  'android.widget', 'android.graphics', 'android.util', 'android.net',
]);

/**
 * Parse Kotlin source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.kt'): KotlinImportInfo[] {
  const imports: KotlinImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Stop at class/object/fun declaration (imports should be at top)
    if (/^(class|object|fun|interface|enum|sealed|data|annotation|typealias)\s/.test(trimmed)) {
      break;
    }

    // import package.name.* (wildcard)
    const wildcardMatch = trimmed.match(/^import\s+([A-Za-z0-9_.]+)\.\*\s*$/);
    if (wildcardMatch) {
      imports.push({
        moduleName: wildcardMatch[1],
        importStyle: 'wildcard',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // import package.name.Class as Alias
    const aliasMatch = trimmed.match(/^import\s+([A-Za-z0-9_.]+)\s+as\s+([A-Za-z0-9_]+)\s*$/);
    if (aliasMatch) {
      imports.push({
        moduleName: aliasMatch[1],
        importStyle: 'alias',
        alias: aliasMatch[2],
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // import package.name or import package.name.Class
    const importMatch = trimmed.match(/^import\s+([A-Za-z0-9_.]+)\s*$/);
    if (importMatch) {
      const moduleName = importMatch[1];
      // Determine if it's a class import or function import
      const parts = moduleName.split('.');
      const lastPart = parts[parts.length - 1];
      
      // If last part starts with lowercase, likely a function
      const isFunction = /^[a-z]/.test(lastPart);
      
      imports.push({
        moduleName,
        importStyle: isFunction ? 'function' : 'class',
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }
  }

  return imports;
}

/**
 * Find usages of classes in source code
 */
export function findClassUsages(source: string, classNames: string[], fileName: string = 'file.kt'): KotlinUsageInfo[] {
  const usages: KotlinUsageInfo[] = [];
  const lines = source.split('\n');

  const patterns = classNames.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (patterns.length === 0) return usages;

  const classPattern = patterns.join('|');
  // Match ClassName.method() or ClassName() or ClassName::class
  const regex = new RegExp(`\\b(${classPattern})(?:<[^>]+>)?(?:\\.(\\w+)|\\(|::)`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Skip import lines
    if (trimmed.startsWith('import ')) {
      continue;
    }

    let match;
    while ((match = regex.exec(line)) !== null) {
      usages.push({
        identifier: match[1],
        method: match[2],
        isStatic: line.includes('Companion') || line.includes('::'),
        location: {
          file: fileName,
          line: lineNum,
          column: match.index + 1,
          snippet: trimmed.slice(0, 100)
        }
      });
    }
  }

  return usages;
}

/**
 * Get packages for an artifact
 */
export function getPackagesForArtifact(artifactId: string): string[] {
  // Try direct match
  if (ARTIFACT_TO_PACKAGE[artifactId]) {
    return ARTIFACT_TO_PACKAGE[artifactId];
  }

  // Try without version suffix
  const baseArtifact = artifactId.replace(/-[0-9]+.*$/, '');
  if (ARTIFACT_TO_PACKAGE[baseArtifact]) {
    return ARTIFACT_TO_PACKAGE[baseArtifact];
  }

  // Infer from artifact name
  // e.g., "my-library" -> "my.library" or "mylibrary"
  return [
    artifactId.replace(/-/g, '.'),
    artifactId.replace(/-/g, ''),
  ];
}

/**
 * Check if a package is from standard library
 */
export function isStandardPackage(packageName: string): boolean {
  if (STANDARD_PACKAGES.has(packageName)) {
    return true;
  }
  
  // Check prefixes
  for (const std of STANDARD_PACKAGES) {
    if (packageName.startsWith(std + '.')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract artifact ID from full dependency notation
 */
export function extractArtifactId(dependency: string): string | null {
  // Handle Gradle Kotlin DSL: implementation("group:artifact:version")
  // Handle Gradle Groovy: implementation 'group:artifact:version'
  const match = dependency.match(/['"]([\w.-]+):([\w.-]+):([\w.-]+)['"]/);
  if (match) {
    return match[2]; // artifact ID
  }
  
  return null;
}
