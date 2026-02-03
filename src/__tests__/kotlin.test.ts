/**
 * ReachVet - Kotlin Language Support Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSource, findClassUsages, getPackagesForArtifact, isStandardPackage } from '../languages/kotlin/parser.js';
import { parseGradleKts, parseGradleGroovy, parseSettingsGradle, parseVersionCatalog, detectKotlinVersion } from '../languages/kotlin/gradle.js';
import { KotlinAdapter } from '../languages/kotlin/index.js';
import type { Component } from '../types.js';

describe('Kotlin Parser', () => {
  describe('parseSource', () => {
    it('should parse basic import statements', () => {
      const code = `
package com.example.app

import kotlin.collections.List
import kotlinx.coroutines.launch
import retrofit2.Retrofit
import okhttp3.OkHttpClient

class MyClass {
}
`;
      const imports = parseSource(code, 'MyClass.kt');
      
      expect(imports).toHaveLength(4);
      expect(imports[0].moduleName).toBe('kotlin.collections.List');
      expect(imports[0].importStyle).toBe('class');
      expect(imports[1].moduleName).toBe('kotlinx.coroutines.launch');
      expect(imports[1].importStyle).toBe('function');
      expect(imports[2].moduleName).toBe('retrofit2.Retrofit');
      expect(imports[3].moduleName).toBe('okhttp3.OkHttpClient');
    });

    it('should parse wildcard imports', () => {
      const code = `
package com.example

import kotlinx.coroutines.*
import retrofit2.*

class Test
`;
      const imports = parseSource(code, 'Test.kt');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('wildcard');
      expect(imports[0].moduleName).toBe('kotlinx.coroutines');
      expect(imports[1].importStyle).toBe('wildcard');
    });

    it('should parse alias imports', () => {
      const code = `
package com.example

import java.util.Date as JavaDate
import kotlinx.datetime.LocalDate as KotlinDate

class Test
`;
      const imports = parseSource(code, 'Test.kt');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('alias');
      expect(imports[0].alias).toBe('JavaDate');
      expect(imports[1].alias).toBe('KotlinDate');
    });

    it('should stop at class declaration', () => {
      const code = `
package com.example

import retrofit2.Retrofit

class MyClass {
    import kotlinx.coroutines.launch // This should not be parsed
}
`;
      const imports = parseSource(code, 'MyClass.kt');
      
      expect(imports).toHaveLength(1);
    });

    it('should include location info', () => {
      const code = `import retrofit2.Retrofit
import okhttp3.OkHttpClient`;
      
      const imports = parseSource(code, 'App.kt');
      
      expect(imports[0].location.file).toBe('App.kt');
      expect(imports[0].location.line).toBe(1);
      expect(imports[1].location.line).toBe(2);
    });
  });

  describe('findClassUsages', () => {
    it('should find method calls', () => {
      const code = `
class NetworkManager {
    private val client = OkHttpClient()
    
    fun fetch() {
        val retrofit = Retrofit.Builder()
            .baseUrl("https://api.example.com")
            .client(client)
            .build()
    }
}
`;
      const usages = findClassUsages(code, ['Retrofit', 'OkHttpClient'], 'NetworkManager.kt');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
    });

    it('should find companion object usage', () => {
      const code = `
val dispatchers = Dispatchers.IO
val scope = CoroutineScope(Dispatchers.Main)
`;
      const usages = findClassUsages(code, ['Dispatchers', 'CoroutineScope'], 'Test.kt');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getPackagesForArtifact', () => {
    it('should return known mappings', () => {
      expect(getPackagesForArtifact('retrofit')).toContain('retrofit2');
      expect(getPackagesForArtifact('okhttp')).toContain('okhttp3');
      expect(getPackagesForArtifact('kotlinx-coroutines-core')).toContain('kotlinx.coroutines');
    });

    it('should infer from artifact name', () => {
      const packages = getPackagesForArtifact('some-library');
      expect(packages).toContain('some.library');
    });
  });

  describe('isStandardPackage', () => {
    it('should identify standard packages', () => {
      expect(isStandardPackage('kotlin')).toBe(true);
      expect(isStandardPackage('kotlin.collections')).toBe(true);
      expect(isStandardPackage('java.util')).toBe(true);
      expect(isStandardPackage('android.app')).toBe(true);
    });

    it('should not flag third-party packages', () => {
      expect(isStandardPackage('retrofit2')).toBe(false);
      expect(isStandardPackage('okhttp3')).toBe(false);
      expect(isStandardPackage('kotlinx.coroutines')).toBe(false);
    });
  });
});

describe('Gradle Parser', () => {
  describe('parseGradleKts', () => {
    it('should parse Kotlin DSL dependencies', () => {
      const content = `
plugins {
    kotlin("jvm") version "1.9.0"
}

dependencies {
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.11.0")
    testImplementation("io.mockk:mockk:1.13.5")
}
`;
      const deps = parseGradleKts(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].groupId).toBe('com.squareup.retrofit2');
      expect(deps[0].artifactId).toBe('retrofit');
      expect(deps[0].version).toBe('2.9.0');
      expect(deps[0].configuration).toBe('implementation');
      expect(deps[2].configuration).toBe('testImplementation');
    });

    it('should parse kotlin() dependencies', () => {
      const content = `
dependencies {
    implementation(kotlin("stdlib"))
    implementation(kotlin("reflect"))
}
`;
      const deps = parseGradleKts(content);
      
      expect(deps).toHaveLength(2);
      expect(deps[0].artifactId).toBe('kotlin-stdlib');
      expect(deps[1].artifactId).toBe('kotlin-reflect');
    });

    it('should parse project dependencies', () => {
      const content = `
dependencies {
    implementation(project(":core"))
    api(project(":common"))
}
`;
      const deps = parseGradleKts(content);
      
      expect(deps).toHaveLength(2);
      expect(deps[0].groupId).toBe('project');
      expect(deps[0].artifactId).toBe('core');
      expect(deps[0].version).toBe('local');
    });
  });

  describe('parseGradleGroovy', () => {
    it('should parse Groovy DSL dependencies', () => {
      const content = `
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.0'
}

dependencies {
    implementation 'com.squareup.retrofit2:retrofit:2.9.0'
    implementation "com.squareup.okhttp3:okhttp:4.11.0"
    testImplementation 'io.mockk:mockk:1.13.5'
}
`;
      const deps = parseGradleGroovy(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].groupId).toBe('com.squareup.retrofit2');
      expect(deps[0].artifactId).toBe('retrofit');
      expect(deps[0].version).toBe('2.9.0');
    });

    it('should parse map-style dependencies', () => {
      const content = `
dependencies {
    implementation group: 'com.google.code.gson', name: 'gson', version: '2.10.1'
}
`;
      const deps = parseGradleGroovy(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].groupId).toBe('com.google.code.gson');
      expect(deps[0].artifactId).toBe('gson');
    });
  });

  describe('parseSettingsGradle', () => {
    it('should parse included modules', () => {
      const content = `
rootProject.name = "MyApp"
include(":app")
include(":core", ":common")
include ":feature:home"
`;
      const modules = parseSettingsGradle(content);
      
      expect(modules).toContain('app');
      expect(modules).toContain('core');
      expect(modules).toContain('common');
    });
  });

  describe('parseVersionCatalog', () => {
    it('should parse libs.versions.toml', () => {
      const content = `
[versions]
retrofit = "2.9.0"
okhttp = "4.11.0"

[libraries]
retrofit = { group = "com.squareup.retrofit2", name = "retrofit", version.ref = "retrofit" }
okhttp = "com.squareup.okhttp3:okhttp:4.11.0"
`;
      const deps = parseVersionCatalog(content);
      
      expect(deps.length).toBeGreaterThanOrEqual(2);
      expect(deps.find(d => d.artifactId === 'retrofit')).toBeDefined();
      expect(deps.find(d => d.artifactId === 'okhttp')).toBeDefined();
    });
  });

  describe('detectKotlinVersion', () => {
    it('should detect Kotlin version from kotlin()', () => {
      const content = `
plugins {
    kotlin("jvm") version "1.9.0"
}
`;
      expect(detectKotlinVersion(content)).toBe('1.9.0');
    });

    it('should detect Kotlin version from id()', () => {
      const content = `
plugins {
    id("org.jetbrains.kotlin.jvm") version "1.9.21"
}
`;
      expect(detectKotlinVersion(content)).toBe('1.9.21');
    });
  });
});

describe('KotlinAdapter', () => {
  const adapter = new KotlinAdapter();

  it('should have correct language property', () => {
    expect(adapter.language).toBe('kotlin');
  });

  it('should have correct file extensions', () => {
    expect(adapter.fileExtensions).toContain('.kt');
    expect(adapter.fileExtensions).toContain('.kts');
  });

  describe('integration', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-kotlin-'));
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should detect Kotlin project with build.gradle.kts', async () => {
      await writeFile(join(tmpDir, 'build.gradle.kts'), `
plugins {
    kotlin("jvm") version "1.9.0"
}
`);
      
      expect(await adapter.canHandle(tmpDir)).toBe(true);
    });

    it('should analyze Kotlin imports', async () => {
      await writeFile(join(tmpDir, 'build.gradle.kts'), '// build.gradle.kts');
      await mkdir(join(tmpDir, 'src', 'main', 'kotlin'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'main', 'kotlin', 'App.kt'), `
package com.example

import retrofit2.Retrofit
import retrofit2.Call

class NetworkClient {
    private val retrofit = Retrofit.Builder()
        .baseUrl("https://api.example.com")
        .build()
}
`);

      const components: Component[] = [
        { name: 'retrofit', version: '2.9.0' }
      ];

      const results = await adapter.analyze(tmpDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should return not_reachable for unused components', async () => {
      await writeFile(join(tmpDir, 'build.gradle.kts'), '// build');
      await mkdir(join(tmpDir, 'src', 'main', 'kotlin'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'main', 'kotlin', 'App.kt'), `
package com.example

class App
`);

      const components: Component[] = [
        { name: 'retrofit', version: '2.9.0' }
      ];

      const results = await adapter.analyze(tmpDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_reachable');
    });
  });
});
