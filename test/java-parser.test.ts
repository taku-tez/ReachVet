/**
 * Java Parser Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseJavaSource,
  parsePomXml,
  parseBuildGradle,
  parseBuildGradleKts,
  findClassUsages,
  extractArtifactFromPackage,
  isJavaStandardLibrary,
  MAVEN_ARTIFACT_ALIASES
} from '../src/languages/java/parser.js';

describe('parseJavaSource', () => {
  it('should parse simple imports', () => {
    const source = `
package com.example;

import java.util.List;
import java.util.Map;
import org.apache.commons.lang3.StringUtils;

public class Test {
}
`;
    const imports = parseJavaSource(source, 'Test.java');
    
    expect(imports).toHaveLength(3);
    expect(imports[0]).toMatchObject({
      path: 'java.util.List',
      packagePath: 'java.util',
      className: 'List'
    });
    expect(imports[2]).toMatchObject({
      path: 'org.apache.commons.lang3.StringUtils',
      packagePath: 'org.apache.commons.lang3',
      className: 'StringUtils'
    });
  });

  it('should parse wildcard imports', () => {
    const source = `
import java.util.*;
import org.apache.commons.lang3.*;
`;
    const imports = parseJavaSource(source, 'Test.java');
    
    expect(imports).toHaveLength(2);
    expect(imports[0]).toMatchObject({
      path: 'java.util.*',
      packagePath: 'java.util',
      className: '*',
      isWildcard: true
    });
    expect(imports[1]).toMatchObject({
      path: 'org.apache.commons.lang3.*',
      isWildcard: true
    });
  });

  it('should parse static imports', () => {
    const source = `
import static org.junit.Assert.assertEquals;
import static java.lang.Math.PI;
`;
    const imports = parseJavaSource(source, 'Test.java');
    
    expect(imports).toHaveLength(2);
    expect(imports[0]).toMatchObject({
      path: 'org.junit.Assert.assertEquals',
      packagePath: 'org.junit',
      className: 'Assert',
      isStatic: true,
      staticMember: 'assertEquals'
    });
    expect(imports[1]).toMatchObject({
      path: 'java.lang.Math.PI',
      className: 'Math',
      isStatic: true,
      staticMember: 'PI'
    });
  });

  it('should parse static wildcard imports', () => {
    const source = `import static org.junit.Assert.*;`;
    const imports = parseJavaSource(source, 'Test.java');
    
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({
      path: 'org.junit.Assert.*',
      packagePath: 'org.junit',
      className: 'Assert',
      isStatic: true,
      isWildcard: true
    });
  });

  it('should stop at class declaration', () => {
    const source = `
package com.example;

import java.util.List;

public class Test {
    // This should not be parsed as import
    import java.util.Map;
}
`;
    const imports = parseJavaSource(source, 'Test.java');
    expect(imports).toHaveLength(1);
    expect(imports[0].className).toBe('List');
  });

  it('should skip comment lines', () => {
    const source = `
// import java.util.List;
/* import java.util.Map; */
import java.util.Set;
`;
    const imports = parseJavaSource(source, 'Test.java');
    expect(imports).toHaveLength(1);
    expect(imports[0].className).toBe('Set');
  });

  it('should include location info', () => {
    const source = `import org.example.Test;`;
    const imports = parseJavaSource(source, 'Main.java');
    
    expect(imports[0].location).toMatchObject({
      file: 'Main.java',
      line: 1,
      snippet: 'import org.example.Test;'
    });
  });
});

describe('parsePomXml', () => {
  it('should parse project info', () => {
    const pom = `
<project>
  <groupId>com.example</groupId>
  <artifactId>my-app</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
</project>
`;
    const result = parsePomXml(pom);
    
    expect(result.groupId).toBe('com.example');
    expect(result.artifactId).toBe('my-app');
    expect(result.version).toBe('1.0.0');
    expect(result.packaging).toBe('jar');
  });

  it('should parse dependencies', () => {
    const pom = `
<project>
  <dependencies>
    <dependency>
      <groupId>org.apache.commons</groupId>
      <artifactId>commons-lang3</artifactId>
      <version>3.12.0</version>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.projectlombok</groupId>
      <artifactId>lombok</artifactId>
      <optional>true</optional>
    </dependency>
  </dependencies>
</project>
`;
    const result = parsePomXml(pom);
    
    expect(result.dependencies).toHaveLength(3);
    expect(result.dependencies[0]).toMatchObject({
      groupId: 'org.apache.commons',
      artifactId: 'commons-lang3',
      version: '3.12.0'
    });
    expect(result.dependencies[1]).toMatchObject({
      groupId: 'junit',
      artifactId: 'junit',
      scope: 'test'
    });
    expect(result.dependencies[2]).toMatchObject({
      groupId: 'org.projectlombok',
      artifactId: 'lombok',
      optional: true
    });
  });

  it('should handle empty pom', () => {
    const pom = '<project></project>';
    const result = parsePomXml(pom);
    
    expect(result.dependencies).toHaveLength(0);
    expect(result.groupId).toBeUndefined();
  });
});

describe('parseBuildGradle', () => {
  it('should parse plugins', () => {
    const gradle = `
plugins {
    id 'java'
    id 'org.springframework.boot' version '2.7.0'
    id 'application'
}
`;
    const result = parseBuildGradle(gradle);
    
    expect(result.plugins).toContain('java');
    expect(result.plugins).toContain('org.springframework.boot');
    expect(result.plugins).toContain('application');
  });

  it('should parse string notation dependencies', () => {
    const gradle = `
dependencies {
    implementation 'org.apache.commons:commons-lang3:3.12.0'
    testImplementation 'junit:junit:4.13.2'
}
`;
    const result = parseBuildGradle(gradle);
    
    expect(result.dependencies).toHaveLength(2);
    expect(result.dependencies[0]).toMatchObject({
      configuration: 'implementation',
      group: 'org.apache.commons',
      name: 'commons-lang3',
      version: '3.12.0'
    });
    expect(result.dependencies[1]).toMatchObject({
      configuration: 'testImplementation',
      group: 'junit',
      name: 'junit'
    });
  });

  it('should parse map notation dependencies', () => {
    const gradle = `
dependencies {
    implementation group: 'com.google.guava', name: 'guava', version: '31.1-jre'
    api group: 'org.slf4j', name: 'slf4j-api'
}
`;
    const result = parseBuildGradle(gradle);
    
    expect(result.dependencies).toHaveLength(2);
    expect(result.dependencies[0]).toMatchObject({
      configuration: 'implementation',
      group: 'com.google.guava',
      name: 'guava',
      version: '31.1-jre'
    });
  });

  it('should parse project dependencies', () => {
    const gradle = `
dependencies {
    implementation project(':core')
    api project(':utils')
}
`;
    const result = parseBuildGradle(gradle);
    
    expect(result.dependencies).toHaveLength(2);
    expect(result.dependencies[0]).toMatchObject({
      configuration: 'implementation',
      name: ':core'
    });
  });

  it('should skip comments', () => {
    const gradle = `
dependencies {
    // implementation 'commented:out:1.0'
    implementation 'actual:dep:1.0'
}
`;
    const result = parseBuildGradle(gradle);
    
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0].name).toBe('dep');
  });
});

describe('parseBuildGradleKts', () => {
  it('should parse Kotlin DSL dependencies', () => {
    // Kotlin DSL uses same parser as Groovy DSL
    // Both support: implementation("group:name:version") and implementation 'group:name:version'
    const gradle = `
dependencies {
    implementation 'org.apache.commons:commons-lang3:3.12.0'
    testImplementation 'junit:junit:4.13.2'
}
`;
    const result = parseBuildGradleKts(gradle);
    
    expect(result.dependencies).toHaveLength(2);
    expect(result.dependencies[0]).toMatchObject({
      configuration: 'implementation',
      group: 'org.apache.commons',
      name: 'commons-lang3'
    });
  });
});

describe('findClassUsages', () => {
  it('should find method calls', () => {
    const source = `
String result = StringUtils.isBlank(input);
boolean empty = StringUtils.isEmpty(other);
`;
    const usages = findClassUsages(source, 'StringUtils');
    
    expect(usages).toContain('isBlank');
    expect(usages).toContain('isEmpty');
  });

  it('should find static field access', () => {
    const source = `
double pi = Math.PI;
int max = Integer.MAX_VALUE;
`;
    const usages = findClassUsages(source, 'Math');
    expect(usages).toContain('PI');
    
    const intUsages = findClassUsages(source, 'Integer');
    expect(intUsages).toContain('MAX_VALUE');
  });

  it('should find constructor usage', () => {
    const source = `
List<String> list = new ArrayList<String>();
StringBuilder sb = new StringBuilder();
`;
    const usages = findClassUsages(source, 'ArrayList');
    expect(usages).toContain('<init>');
    
    const sbUsages = findClassUsages(source, 'StringBuilder');
    expect(sbUsages).toContain('<init>');
  });

  it('should find type usage', () => {
    const source = `
private List<String> items;
public Optional<User> findUser() {}
`;
    const listUsages = findClassUsages(source, 'List');
    expect(listUsages).toContain('<type>');
    
    const optUsages = findClassUsages(source, 'Optional');
    expect(optUsages).toContain('<type>');
  });
});

describe('extractArtifactFromPackage', () => {
  it('should map known packages', () => {
    expect(extractArtifactFromPackage('org.apache.commons.lang3')).toBe('org.apache.commons:commons-lang3');
    expect(extractArtifactFromPackage('com.google.gson')).toBe('com.google.code.gson:gson');
    expect(extractArtifactFromPackage('org.junit.jupiter')).toBe('org.junit.jupiter:junit-jupiter');
  });

  it('should handle sub-packages', () => {
    expect(extractArtifactFromPackage('org.apache.commons.lang3.builder')).toBe('org.apache.commons:commons-lang3');
    expect(extractArtifactFromPackage('com.google.common.collect')).toBe('com.google.guava:guava');
  });

  it('should fallback to pattern-based extraction', () => {
    const result = extractArtifactFromPackage('io.netty.buffer');
    expect(result).toBe('io.netty.buffer:buffer');
  });
});

describe('isJavaStandardLibrary', () => {
  it('should identify standard library packages', () => {
    expect(isJavaStandardLibrary('java.util')).toBe(true);
    expect(isJavaStandardLibrary('java.io')).toBe(true);
    expect(isJavaStandardLibrary('javax.servlet')).toBe(true);
    expect(isJavaStandardLibrary('sun.misc')).toBe(true);
    expect(isJavaStandardLibrary('org.w3c.dom')).toBe(true);
  });

  it('should identify third-party packages', () => {
    expect(isJavaStandardLibrary('org.apache.commons.lang3')).toBe(false);
    expect(isJavaStandardLibrary('com.google.gson')).toBe(false);
    expect(isJavaStandardLibrary('org.junit')).toBe(false);
  });
});

describe('MAVEN_ARTIFACT_ALIASES', () => {
  it('should have common aliases', () => {
    expect(MAVEN_ARTIFACT_ALIASES['gson']).toBe('com.google.code.gson:gson');
    expect(MAVEN_ARTIFACT_ALIASES['junit']).toBe('junit:junit');
    expect(MAVEN_ARTIFACT_ALIASES['guava']).toBe('com.google.guava:guava');
  });
});
