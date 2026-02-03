/**
 * ReachVet - Scala Language Support Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSource, findTypeUsages, getPackagesForArtifact, isStandardPackage } from '../languages/scala/parser.js';
import { parseBuildSbt, parsePluginsSbt, getScalaVersion, getCrossScalaVersions, isMultiProjectBuild, getSubProjects } from '../languages/scala/sbt.js';
import { ScalaAdapter } from '../languages/scala/index.js';
import type { Component } from '../types.js';

describe('Scala Parser', () => {
  describe('parseSource', () => {
    it('should parse basic import statements', () => {
      const code = `
package com.example

import scala.collection.mutable
import cats.effect.IO
import io.circe.Json
import akka.actor.ActorSystem

object Main extends App {
}
`;
      const imports = parseSource(code, 'Main.scala');
      
      expect(imports).toHaveLength(4);
      expect(imports[0].moduleName).toBe('scala.collection.mutable');
      expect(imports[0].importStyle).toBe('class');
      expect(imports[1].moduleName).toBe('cats.effect.IO');
      expect(imports[2].moduleName).toBe('io.circe.Json');
      expect(imports[3].moduleName).toBe('akka.actor.ActorSystem');
    });

    it('should parse wildcard imports', () => {
      const code = `
package com.example

import cats.effect._
import io.circe.syntax._

object Main
`;
      const imports = parseSource(code, 'Main.scala');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('wildcard');
      expect(imports[0].moduleName).toBe('cats.effect');
      expect(imports[1].importStyle).toBe('wildcard');
    });

    it('should parse selective imports', () => {
      const code = `
package com.example

import cats.data.{OptionT, EitherT, Validated}
import io.circe.{Decoder, Encoder}

object Main
`;
      const imports = parseSource(code, 'Main.scala');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('selective');
      expect(imports[0].members).toContain('OptionT');
      expect(imports[0].members).toContain('EitherT');
      expect(imports[0].members).toContain('Validated');
    });

    it('should parse alias imports', () => {
      const code = `
package com.example

import java.util.{List => JList, Map => JMap}
import scala.collection.mutable.{Map => MutableMap}

object Main
`;
      const imports = parseSource(code, 'Main.scala');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('alias');
      expect(imports[0].aliases?.get('List')).toBe('JList');
      expect(imports[0].aliases?.get('Map')).toBe('JMap');
    });

    it('should parse Scala 3 given imports', () => {
      const code = `
package com.example

import cats.syntax.all.given
import io.circe.generic.auto.given

object Main
`;
      const imports = parseSource(code, 'Main.scala');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('given');
      expect(imports[0].moduleName).toBe('cats.syntax.all');
    });

    it('should stop at class/object definition', () => {
      const code = `
package com.example

import cats.effect.IO

object Main {
  import io.circe.Json // This should not be parsed
}
`;
      const imports = parseSource(code, 'Main.scala');
      
      expect(imports).toHaveLength(1);
    });

    it('should include location info', () => {
      const code = `import cats.effect.IO
import io.circe.Json`;
      
      const imports = parseSource(code, 'App.scala');
      
      expect(imports[0].location.file).toBe('App.scala');
      expect(imports[0].location.line).toBe(1);
      expect(imports[1].location.line).toBe(2);
    });
  });

  describe('findTypeUsages', () => {
    it('should find type instantiation', () => {
      const code = `
object Main {
  val io: IO[Unit] = IO.println("Hello")
  val json = Json.obj("key" -> Json.fromString("value"))
}
`;
      const usages = findTypeUsages(code, ['IO', 'Json'], 'Main.scala');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
    });

    it('should find method calls', () => {
      const code = `
val result = Source.fromFile("test.txt")
  .getLines()
  .toList
`;
      const usages = findTypeUsages(code, ['Source'], 'Test.scala');
      
      expect(usages.length).toBeGreaterThanOrEqual(1);
      expect(usages[0].method).toBe('fromFile');
    });
  });

  describe('getPackagesForArtifact', () => {
    it('should return known mappings', () => {
      expect(getPackagesForArtifact('cats-core')).toContain('cats');
      expect(getPackagesForArtifact('cats-effect')).toContain('cats.effect');
      expect(getPackagesForArtifact('circe-core')).toContain('io.circe');
    });

    it('should handle Scala version suffix', () => {
      expect(getPackagesForArtifact('cats-core_2.13')).toContain('cats');
      expect(getPackagesForArtifact('zio_3')).toContain('zio');
    });

    it('should infer from artifact name', () => {
      const packages = getPackagesForArtifact('some-library');
      expect(packages).toContain('some.library');
    });
  });

  describe('isStandardPackage', () => {
    it('should identify standard packages', () => {
      expect(isStandardPackage('scala')).toBe(true);
      expect(isStandardPackage('scala.collection')).toBe(true);
      expect(isStandardPackage('java.util')).toBe(true);
      expect(isStandardPackage('java.io')).toBe(true);
    });

    it('should not flag third-party packages', () => {
      expect(isStandardPackage('cats')).toBe(false);
      expect(isStandardPackage('io.circe')).toBe(false);
      expect(isStandardPackage('akka.actor')).toBe(false);
    });
  });
});

describe('sbt Parser', () => {
  describe('parseBuildSbt', () => {
    it('should parse single % dependencies', () => {
      const content = `
libraryDependencies += "org.scalatest" % "scalatest" % "3.2.15" % Test
`;
      const deps = parseBuildSbt(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].groupId).toBe('org.scalatest');
      expect(deps[0].artifactId).toBe('scalatest');
      expect(deps[0].version).toBe('3.2.15');
      expect(deps[0].crossVersion).toBe(false);
      expect(deps[0].configuration).toBe('Test');
    });

    it('should parse cross-version %% dependencies', () => {
      const content = `
libraryDependencies ++= Seq(
  "org.typelevel" %% "cats-core" % "2.9.0",
  "org.typelevel" %% "cats-effect" % "3.5.0",
  "io.circe" %% "circe-core" % "0.14.5"
)
`;
      const deps = parseBuildSbt(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].groupId).toBe('org.typelevel');
      expect(deps[0].artifactId).toBe('cats-core');
      expect(deps[0].crossVersion).toBe(true);
      expect(deps[2].artifactId).toBe('circe-core');
    });

    it('should parse quoted configurations', () => {
      const content = `
libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.15" % "test"
`;
      const deps = parseBuildSbt(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].configuration).toBe('test');
    });
  });

  describe('parsePluginsSbt', () => {
    it('should parse sbt plugins', () => {
      const content = `
addSbtPlugin("org.scalameta" % "sbt-scalafmt" % "2.5.0")
addSbtPlugin("com.github.sbt" % "sbt-native-packager" % "1.9.16")
`;
      const deps = parsePluginsSbt(content);
      
      expect(deps).toHaveLength(2);
      expect(deps[0].groupId).toBe('org.scalameta');
      expect(deps[0].artifactId).toBe('sbt-scalafmt');
      expect(deps[0].configuration).toBe('plugin');
    });
  });

  describe('getScalaVersion', () => {
    it('should extract Scala version', () => {
      const content = `
scalaVersion := "2.13.12"
`;
      expect(getScalaVersion(content)).toBe('2.13.12');
    });
  });

  describe('getCrossScalaVersions', () => {
    it('should extract cross versions', () => {
      const content = `
crossScalaVersions := Seq("2.12.18", "2.13.12", "3.3.1")
`;
      const versions = getCrossScalaVersions(content);
      
      expect(versions).toContain('2.12.18');
      expect(versions).toContain('2.13.12');
      expect(versions).toContain('3.3.1');
    });
  });

  describe('isMultiProjectBuild', () => {
    it('should detect multi-project builds', () => {
      const multiProject = `
lazy val root = project.in(file("."))
  .aggregate(core, api)

lazy val core = project
lazy val api = project
`;
      expect(isMultiProjectBuild(multiProject)).toBe(true);

      const singleProject = `
name := "myapp"
scalaVersion := "2.13.12"
`;
      expect(isMultiProjectBuild(singleProject)).toBe(false);
    });
  });

  describe('getSubProjects', () => {
    it('should extract sub-project names', () => {
      const content = `
lazy val root = project.in(file("."))
lazy val core = project
lazy val api = (project in file("api"))
lazy val common = project.settings(commonSettings)
`;
      const projects = getSubProjects(content);
      
      expect(projects).toContain('root');
      expect(projects).toContain('core');
      expect(projects).toContain('api');
      expect(projects).toContain('common');
    });
  });
});

describe('ScalaAdapter', () => {
  const adapter = new ScalaAdapter();

  it('should have correct language property', () => {
    expect(adapter.language).toBe('scala');
  });

  it('should have correct file extensions', () => {
    expect(adapter.fileExtensions).toContain('.scala');
    expect(adapter.fileExtensions).toContain('.sc');
  });

  describe('integration', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-scala-'));
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('should detect Scala project with build.sbt', async () => {
      await writeFile(join(tmpDir, 'build.sbt'), `
name := "MyApp"
scalaVersion := "2.13.12"
`);
      
      expect(await adapter.canHandle(tmpDir)).toBe(true);
    });

    it('should analyze Scala imports', async () => {
      await writeFile(join(tmpDir, 'build.sbt'), 'name := "test"');
      await mkdir(join(tmpDir, 'src', 'main', 'scala'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'main', 'scala', 'Main.scala'), `
package com.example

import cats.effect.IO
import cats.effect.IOApp

object Main extends IOApp.Simple {
  def run: IO[Unit] = IO.println("Hello")
}
`);

      const components: Component[] = [
        { name: 'cats-effect', version: '3.5.0' }
      ];

      const results = await adapter.analyze(tmpDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
    });

    it('should return not_reachable for unused components', async () => {
      await writeFile(join(tmpDir, 'build.sbt'), 'name := "test"');
      await mkdir(join(tmpDir, 'src', 'main', 'scala'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'main', 'scala', 'Main.scala'), `
package com.example

object Main extends App
`);

      const components: Component[] = [
        { name: 'cats-effect', version: '3.5.0' }
      ];

      const results = await adapter.analyze(tmpDir, components);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_reachable');
    });
  });
});
