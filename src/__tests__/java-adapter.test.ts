/**
 * Java Adapter Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JavaLanguageAdapter } from '../languages/java/index.js';

describe('Java precision tests', () => {
  it('should detect wildcard imports', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-java-wild-'));
    
    await writeFile(join(tmpDir, 'pom.xml'), `<?xml version="1.0"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.apache.commons</groupId>
      <artifactId>commons-lang3</artifactId>
      <version>3.12.0</version>
    </dependency>
  </dependencies>
</project>`);
    
    await mkdir(join(tmpDir, 'src', 'main', 'java'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'main', 'java', 'Main.java'), `
import org.apache.commons.lang3.*;

public class Main {
    public static void main(String[] args) {
        StringUtils.isEmpty("");
    }
}
`);
    
    const adapter = new JavaLanguageAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'org.apache.commons:commons-lang3',
      version: '3.12.0',
      type: 'maven'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const commonsResult = result.find(r => 
      r.component.name === 'org.apache.commons:commons-lang3'
    );
    expect(commonsResult?.warnings?.some(w => 
      w.code === 'star_import'
    )).toBe(true);
  });

  it('should detect reflection usage', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-java-reflect-'));
    
    await writeFile(join(tmpDir, 'pom.xml'), `<?xml version="1.0"?>
<project>
  <dependencies>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>31.0-jre</version>
    </dependency>
  </dependencies>
</project>`);
    
    await mkdir(join(tmpDir, 'src', 'main', 'java'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'main', 'java', 'Main.java'), `
import com.google.common.base.Strings;

public class Main {
    public static void main(String[] args) throws Exception {
        Class<?> cls = Class.forName("com.google.common.base.Strings");
        Object obj = cls.newInstance();
    }
}
`);
    
    const adapter = new JavaLanguageAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'com.google.guava:guava',
      version: '31.0-jre',
      type: 'maven'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const guavaResult = result.find(r => 
      r.component.name === 'com.google.guava:guava'
    );
    expect(guavaResult?.warnings?.some(w => 
      w.code === 'reflection'
    )).toBe(true);
  });

  it('should track static imports', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-java-static-'));
    
    await writeFile(join(tmpDir, 'pom.xml'), `<?xml version="1.0"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.9.0</version>
    </dependency>
  </dependencies>
</project>`);
    
    await mkdir(join(tmpDir, 'src', 'test', 'java'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'test', 'java', 'MainTest.java'), `
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.Test;

public class MainTest {
    @Test
    void test() {
        assertEquals(1, 1);
        assertTrue(true);
    }
}
`);
    
    const adapter = new JavaLanguageAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'org.junit.jupiter:junit-jupiter',
      version: '5.9.0',
      type: 'maven'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const junitResult = result.find(r => 
      r.component.name === 'org.junit.jupiter:junit-jupiter'
    );
    // Static imports should be tracked
    expect(junitResult?.status).not.toBe('not_reachable');
    if (junitResult?.usage?.usedMembers) {
      expect(junitResult.usage.usedMembers).toContain('assertEquals');
    }
  });
});
