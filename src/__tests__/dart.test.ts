/**
 * ReachVet - Dart/Flutter Language Support Tests
 */

import { describe, it, expect } from 'vitest';
import { parseSource, findClassUsages, getClassesForPackage, isSdkPackage } from '../languages/dart/parser.js';
import { parsePubspecYaml, parsePubspecLock, getProjectName, getSdkVersion, isFlutterProject } from '../languages/dart/pubspec.js';
import { DartAdapter } from '../languages/dart/index.js';

describe('Dart Parser', () => {
  describe('parseSource', () => {
    it('should parse basic import statements', () => {
      const code = `
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:dio/dio.dart';

class MyApp extends StatelessWidget {
}
`;
      const imports = parseSource(code, 'main.dart');
      
      expect(imports).toHaveLength(3);
      expect(imports[0].packageName).toBe('flutter');
      expect(imports[0].path).toBe('material.dart');
      expect(imports[1].packageName).toBe('provider');
      expect(imports[2].packageName).toBe('dio');
    });

    it('should parse import with alias', () => {
      const code = `
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

void main() {}
`;
      const imports = parseSource(code, 'main.dart');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].alias).toBe('http');
      expect(imports[1].alias).toBe('p');
    });

    it('should parse import with show', () => {
      const code = `
import 'package:flutter/material.dart' show Widget, BuildContext, StatelessWidget;

class MyWidget extends StatelessWidget {}
`;
      const imports = parseSource(code, 'widget.dart');
      
      expect(imports).toHaveLength(1);
      expect(imports[0].show).toContain('Widget');
      expect(imports[0].show).toContain('BuildContext');
      expect(imports[0].show).toContain('StatelessWidget');
    });

    it('should parse import with hide', () => {
      const code = `
import 'package:flutter/material.dart' hide Text, Image;

class MyWidget {}
`;
      const imports = parseSource(code, 'widget.dart');
      
      expect(imports).toHaveLength(1);
      expect(imports[0].hide).toContain('Text');
      expect(imports[0].hide).toContain('Image');
    });

    it('should parse deferred import', () => {
      const code = `
import 'package:heavy_lib/heavy_lib.dart' deferred as heavy;

void main() {}
`;
      const imports = parseSource(code, 'main.dart');
      
      expect(imports).toHaveLength(1);
      expect(imports[0].isDeferred).toBe(true);
      expect(imports[0].alias).toBe('heavy');
    });

    it('should parse export statements', () => {
      const code = `
export 'package:my_package/src/feature.dart';
`;
      const imports = parseSource(code, 'lib.dart');
      
      expect(imports).toHaveLength(1);
      expect(imports[0].importStyle).toBe('export');
    });
  });

  describe('findClassUsages', () => {
    it('should find class instantiation', () => {
      const code = `
void main() {
  final dio = Dio();
  final response = await dio.get('https://api.example.com');
  final provider = ChangeNotifierProvider(create: (_) => MyModel());
}
`;
      const usages = findClassUsages(code, ['Dio', 'ChangeNotifierProvider'], 'main.dart');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
    });

    it('should find static method calls', () => {
      const code = `
void main() async {
  await Firebase.initializeApp();
  await FirebaseAuth.signIn();
}
`;
      const usages = findClassUsages(code, ['Firebase', 'FirebaseAuth'], 'main.dart');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getClassesForPackage', () => {
    it('should return known mappings', () => {
      expect(getClassesForPackage('flutter')).toContain('Widget');
      expect(getClassesForPackage('provider')).toContain('Provider');
      expect(getClassesForPackage('dio')).toContain('Dio');
    });

    it('should infer from package name', () => {
      const classes = getClassesForPackage('my_package');
      expect(classes).toContain('MyPackage');
    });
  });

  describe('isSdkPackage', () => {
    it('should identify SDK packages', () => {
      expect(isSdkPackage('dart:core')).toBe(true);
      expect(isSdkPackage('dart:async')).toBe(true);
      expect(isSdkPackage('dart:io')).toBe(true);
    });

    it('should not flag third-party packages', () => {
      expect(isSdkPackage('package:flutter')).toBe(false);
      expect(isSdkPackage('package:dio')).toBe(false);
    });
  });
});

describe('Pubspec Parser', () => {
  describe('parsePubspecYaml', () => {
    it('should parse dependencies', () => {
      const content = `
name: my_app
version: 1.0.0

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  provider: ^6.0.0
  dio: ^5.3.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  mockito: ^5.4.0
`;
      const deps = parsePubspecYaml(content);
      
      expect(deps.length).toBeGreaterThanOrEqual(4);
      
      const provider = deps.find(d => d.name === 'provider');
      expect(provider).toBeDefined();
      expect(provider?.version).toBe('^6.0.0');
      expect(provider?.isDev).toBe(false);

      const mockito = deps.find(d => d.name === 'mockito');
      expect(mockito).toBeDefined();
      expect(mockito?.isDev).toBe(true);
    });

    it('should parse git dependencies', () => {
      const content = `
name: my_app

dependencies:
  my_lib:
    git:
      url: https://github.com/user/my_lib.git
      ref: v1.0.0
`;
      const deps = parsePubspecYaml(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].source).toBe('git');
    });

    it('should parse path dependencies', () => {
      const content = `
name: my_app

dependencies:
  local_lib:
    path: ../local_lib
`;
      const deps = parsePubspecYaml(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].source).toBe('path');
    });
  });

  describe('parsePubspecLock', () => {
    it('should parse locked versions', () => {
      const content = `
packages:
  dio:
    dependency: "direct main"
    source: hosted
    version: "5.3.3"
  provider:
    dependency: "direct main"
    source: hosted
    version: "6.0.5"
  mockito:
    dependency: "direct dev"
    source: hosted
    version: "5.4.2"
`;
      const deps = parsePubspecLock(content);
      
      expect(deps).toHaveLength(3);
      expect(deps.find(d => d.name === 'dio')?.version).toBe('5.3.3');
      expect(deps.find(d => d.name === 'mockito')?.isDev).toBe(true);
    });
  });

  describe('getProjectName', () => {
    it('should extract project name', () => {
      const content = `name: my_awesome_app`;
      expect(getProjectName(content)).toBe('my_awesome_app');
    });
  });

  describe('getSdkVersion', () => {
    it('should extract SDK version', () => {
      const content = `
environment:
  sdk: '>=3.0.0 <4.0.0'
`;
      expect(getSdkVersion(content)).toBe('>=3.0.0 <4.0.0');
    });
  });

  describe('isFlutterProject', () => {
    it('should detect Flutter projects', () => {
      const flutter = `
dependencies:
  flutter:
    sdk: flutter
`;
      expect(isFlutterProject(flutter)).toBe(true);

      const dart = `
dependencies:
  http: ^1.0.0
`;
      expect(isFlutterProject(dart)).toBe(false);
    });
  });
});

describe('DartAdapter', () => {
  const adapter = new DartAdapter();

  it('should have correct language property', () => {
    expect(adapter.language).toBe('dart');
  });

  it('should have correct file extensions', () => {
    expect(adapter.fileExtensions).toContain('.dart');
  });
});
