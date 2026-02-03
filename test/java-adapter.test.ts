/**
 * Java Adapter Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJavaAdapter, JavaLanguageAdapter } from '../src/languages/java/index.js';
import type { Component } from '../src/types.js';

describe('JavaLanguageAdapter', () => {
  let adapter: JavaLanguageAdapter;
  let testDir: string;

  beforeAll(async () => {
    adapter = createJavaAdapter();
    testDir = join(tmpdir(), `reachvet-java-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('canHandle', () => {
    it('should handle directory with pom.xml', async () => {
      const pomDir = join(testDir, 'maven-project');
      await mkdir(pomDir, { recursive: true });
      await writeFile(join(pomDir, 'pom.xml'), '<project></project>');
      
      expect(await adapter.canHandle(pomDir)).toBe(true);
    });

    it('should handle directory with build.gradle', async () => {
      const gradleDir = join(testDir, 'gradle-project');
      await mkdir(gradleDir, { recursive: true });
      await writeFile(join(gradleDir, 'build.gradle'), 'plugins { id "java" }');
      
      expect(await adapter.canHandle(gradleDir)).toBe(true);
    });

    it('should handle directory with .java files', async () => {
      const javaDir = join(testDir, 'java-only');
      await mkdir(javaDir, { recursive: true });
      await writeFile(join(javaDir, 'Main.java'), 'public class Main {}');
      
      expect(await adapter.canHandle(javaDir)).toBe(true);
    });

    it('should not handle empty directory', async () => {
      const emptyDir = join(testDir, 'empty');
      await mkdir(emptyDir, { recursive: true });
      
      expect(await adapter.canHandle(emptyDir)).toBe(false);
    });
  });

  describe('analyze', () => {
    it('should detect imported dependencies', async () => {
      // Setup Maven project
      const projectDir = join(testDir, 'maven-import-test');
      await mkdir(join(projectDir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
      
      const pomXml = `
<project>
  <dependencies>
    <dependency>
      <groupId>org.apache.commons</groupId>
      <artifactId>commons-lang3</artifactId>
      <version>3.12.0</version>
    </dependency>
  </dependencies>
</project>
`;
      await writeFile(join(projectDir, 'pom.xml'), pomXml);

      const javaSource = `
package com.example;

import org.apache.commons.lang3.StringUtils;

public class Main {
    public static void main(String[] args) {
        String result = StringUtils.trim("  hello  ");
        System.out.println(StringUtils.isBlank(result));
    }
}
`;
      await writeFile(join(projectDir, 'src', 'main', 'java', 'com', 'example', 'Main.java'), javaSource);

      const components: Component[] = [
        {
          name: 'org.apache.commons:commons-lang3',
          version: '3.12.0',
          purl: 'pkg:maven/org.apache.commons/commons-lang3@3.12.0'
        }
      ];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].usage?.usedMembers).toContain('trim');
      expect(results[0].usage?.usedMembers).toContain('isBlank');
    });

    it('should detect not-reachable dependencies', async () => {
      const projectDir = join(testDir, 'not-used-test');
      await mkdir(join(projectDir, 'src', 'main', 'java'), { recursive: true });
      
      const pomXml = `
<project>
  <dependencies>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>31.1-jre</version>
    </dependency>
  </dependencies>
</project>
`;
      await writeFile(join(projectDir, 'pom.xml'), pomXml);

      const javaSource = `
package com.example;

// Guava is not imported
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> items = List.of("a", "b");
    }
}
`;
      await writeFile(join(projectDir, 'src', 'main', 'java', 'Main.java'), javaSource);

      const components: Component[] = [
        {
          name: 'com.google.guava:guava',
          version: '31.1-jre',
          purl: 'pkg:maven/com.google.guava/guava@31.1-jre'
        }
      ];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_reachable');
      expect(results[0].notes).toContain('Declared in dependencies but not imported');
    });

    it('should handle wildcard imports with warning', async () => {
      const projectDir = join(testDir, 'wildcard-test');
      await mkdir(join(projectDir, 'src', 'main', 'java'), { recursive: true });
      
      await writeFile(join(projectDir, 'pom.xml'), '<project></project>');

      const javaSource = `
import org.apache.commons.lang3.*;

public class Main {
    public static void main(String[] args) {}
}
`;
      await writeFile(join(projectDir, 'src', 'main', 'java', 'Main.java'), javaSource);

      const components: Component[] = [
        {
          name: 'org.apache.commons:commons-lang3',
          version: '3.12.0'
        }
      ];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('imported');
      expect(results[0].warnings).toBeDefined();
      expect(results[0].warnings?.some(w => w.code === 'star_import')).toBe(true);
    });

    it('should detect static import usages', async () => {
      const projectDir = join(testDir, 'static-import-test');
      await mkdir(join(projectDir, 'src', 'main', 'java'), { recursive: true });
      
      await writeFile(join(projectDir, 'pom.xml'), '<project></project>');

      const javaSource = `
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class MyTest {
    public void test() {
        assertEquals(1, 1);
        assertTrue(true);
    }
}
`;
      await writeFile(join(projectDir, 'src', 'main', 'java', 'MyTest.java'), javaSource);

      const components: Component[] = [
        {
          name: 'junit:junit',
          version: '4.13.2',
          purl: 'pkg:maven/junit/junit@4.13.2'
        }
      ];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].usage?.usedMembers).toContain('assertEquals');
      expect(results[0].usage?.usedMembers).toContain('assertTrue');
    });

    it('should handle Gradle projects', async () => {
      const projectDir = join(testDir, 'gradle-test');
      await mkdir(join(projectDir, 'src', 'main', 'java'), { recursive: true });
      
      const buildGradle = `
plugins {
    id 'java'
}

dependencies {
    implementation 'com.google.code.gson:gson:2.10.1'
}
`;
      await writeFile(join(projectDir, 'build.gradle'), buildGradle);

      const javaSource = `
import com.google.gson.Gson;
import com.google.gson.JsonObject;

public class Main {
    public static void main(String[] args) {
        Gson gson = new Gson();
        JsonObject obj = gson.toJsonTree(new Object()).getAsJsonObject();
    }
}
`;
      await writeFile(join(projectDir, 'src', 'main', 'java', 'Main.java'), javaSource);

      const components: Component[] = [
        {
          name: 'com.google.code.gson:gson',
          version: '2.10.1'
        }
      ];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should detect vulnerable function reachability', async () => {
      const projectDir = join(testDir, 'vuln-test');
      await mkdir(join(projectDir, 'src', 'main', 'java'), { recursive: true });
      
      await writeFile(join(projectDir, 'pom.xml'), '<project></project>');

      const javaSource = `
import org.apache.commons.lang3.StringUtils;

public class Main {
    public static void main(String[] args) {
        String result = StringUtils.strip("  hello  ");
    }
}
`;
      await writeFile(join(projectDir, 'src', 'main', 'java', 'Main.java'), javaSource);

      const components: Component[] = [
        {
          name: 'org.apache.commons:commons-lang3',
          version: '3.12.0',
          vulnerabilities: [
            {
              id: 'CVE-FAKE-TEST',
              severity: 'critical',
              affectedFunctions: ['strip']
            }
          ]
        }
      ];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].confidence).toBe('high');
      expect(results[0].notes).toBeDefined();
      expect(results[0].notes).toContain('Vulnerable function(s) reachable: strip');
    });

    it('should handle multiple files', async () => {
      const projectDir = join(testDir, 'multi-file-test');
      await mkdir(join(projectDir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
      
      await writeFile(join(projectDir, 'pom.xml'), '<project></project>');

      // File 1: Uses commons-lang3
      await writeFile(
        join(projectDir, 'src', 'main', 'java', 'com', 'example', 'Utils.java'),
        `
package com.example;
import org.apache.commons.lang3.StringUtils;
public class Utils {
    public static boolean isEmpty(String s) {
        return StringUtils.isEmpty(s);
    }
}
`
      );

      // File 2: Uses Gson
      await writeFile(
        join(projectDir, 'src', 'main', 'java', 'com', 'example', 'JsonHelper.java'),
        `
package com.example;
import com.google.gson.Gson;
public class JsonHelper {
    private Gson gson = new Gson();
}
`
      );

      const components: Component[] = [
        { name: 'org.apache.commons:commons-lang3', version: '3.12.0' },
        { name: 'com.google.code.gson:gson', version: '2.10.1' }
      ];

      const results = await adapter.analyze(projectDir, components);
      
      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === 'reachable')).toBe(true);
    });
  });

  describe('language property', () => {
    it('should be java', () => {
      expect(adapter.language).toBe('java');
    });
  });

  describe('fileExtensions', () => {
    it('should include .java', () => {
      expect(adapter.fileExtensions).toContain('.java');
    });
  });
});
