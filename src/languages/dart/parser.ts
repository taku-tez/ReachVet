/**
 * ReachVet - Dart Import Parser
 * 
 * Parses Dart import/export statements:
 * - import 'package:name/file.dart';
 * - import 'package:name/file.dart' as alias;
 * - import 'package:name/file.dart' show Class1, Class2;
 * - import 'package:name/file.dart' hide Class1;
 * - export 'package:name/file.dart';
 */

import type { CodeLocation } from '../../types.js';

export interface DartImportInfo {
  /** The package being imported */
  packageName: string;
  /** Path within the package */
  path: string;
  /** Import style */
  importStyle: 'import' | 'export' | 'part';
  /** Alias if any */
  alias?: string;
  /** show filter */
  show?: string[];
  /** hide filter */
  hide?: string[];
  /** Is deferred import */
  isDeferred: boolean;
  /** Location in source */
  location: CodeLocation;
}

export interface DartUsageInfo {
  /** Class/function being used */
  identifier: string;
  /** Method being called */
  method?: string;
  /** Is it a static call */
  isStatic: boolean;
  /** Location in source */
  location: CodeLocation;
}

// Map pub.dev package names to their common exports
const PACKAGE_TO_CLASSES: Record<string, string[]> = {
  // Flutter
  'flutter': ['Widget', 'StatelessWidget', 'StatefulWidget', 'State', 'BuildContext', 'MaterialApp', 'Scaffold'],
  
  // State Management
  'provider': ['Provider', 'Consumer', 'ChangeNotifierProvider', 'MultiProvider'],
  'riverpod': ['Provider', 'ConsumerWidget', 'ProviderScope', 'StateNotifier', 'StateProvider'],
  'flutter_riverpod': ['ProviderScope', 'ConsumerWidget', 'ConsumerStatefulWidget'],
  'bloc': ['Bloc', 'Cubit', 'BlocProvider', 'BlocBuilder', 'BlocListener'],
  'flutter_bloc': ['BlocProvider', 'BlocBuilder', 'BlocConsumer', 'BlocListener'],
  'get': ['GetxController', 'Obx', 'Get', 'GetMaterialApp'],
  'mobx': ['Observable', 'Action', 'Store', 'reaction'],
  
  // Networking
  'http': ['Client', 'Response', 'Request', 'get', 'post'],
  'dio': ['Dio', 'Response', 'Options', 'Interceptor'],
  'retrofit': ['RestClient'],
  'graphql': ['GraphQLClient', 'QueryResult', 'MutationOptions'],
  
  // Database
  'sqflite': ['Database', 'openDatabase', 'Batch'],
  'hive': ['Hive', 'Box', 'HiveObject'],
  'isar': ['Isar', 'IsarCollection'],
  'drift': ['Database', 'Table', 'Column'],
  'floor': ['Database', 'Entity', 'Dao'],
  
  // JSON
  'json_serializable': ['JsonSerializable'],
  'json_annotation': ['JsonSerializable', 'JsonKey'],
  'freezed': ['Freezed'],
  'freezed_annotation': ['Freezed', 'freezed'],
  
  // UI
  'cached_network_image': ['CachedNetworkImage'],
  'flutter_svg': ['SvgPicture'],
  'lottie': ['Lottie'],
  'shimmer': ['Shimmer'],
  'fl_chart': ['LineChart', 'BarChart', 'PieChart'],
  
  // Navigation
  'go_router': ['GoRouter', 'GoRoute'],
  'auto_route': ['AutoRouter', 'AutoRoutePage'],
  
  // Firebase
  'firebase_core': ['Firebase'],
  'firebase_auth': ['FirebaseAuth', 'User'],
  'cloud_firestore': ['FirebaseFirestore', 'CollectionReference'],
  'firebase_storage': ['FirebaseStorage', 'Reference'],
  'firebase_messaging': ['FirebaseMessaging'],
  
  // Testing
  'flutter_test': ['WidgetTester', 'testWidgets', 'find', 'expect'],
  'mockito': ['Mock', 'when', 'verify'],
  'mocktail': ['Mock', 'when', 'verify'],
  
  // Utils
  'intl': ['DateFormat', 'NumberFormat', 'Intl'],
  'logger': ['Logger'],
  'path': ['join', 'basename', 'dirname'],
  'url_launcher': ['launchUrl', 'canLaunchUrl'],
  'shared_preferences': ['SharedPreferences'],
  'path_provider': ['getApplicationDocumentsDirectory', 'getTemporaryDirectory'],
};

// Dart SDK packages
const SDK_PACKAGES = new Set([
  'dart:core', 'dart:async', 'dart:collection', 'dart:convert',
  'dart:io', 'dart:math', 'dart:typed_data', 'dart:html',
  'dart:isolate', 'dart:mirrors', 'dart:developer',
]);

/**
 * Parse Dart source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.dart'): DartImportInfo[] {
  const imports: DartImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Stop at class/function definition (imports should be at top)
    if (/^(class|abstract\s+class|mixin|extension|enum|typedef|void|Future|String|int|double|bool|dynamic)\s/.test(trimmed)) {
      break;
    }

    // import 'package:name/path.dart' ...
    const importMatch = trimmed.match(/^(import|export)\s+['"]package:([^/]+)\/([^'"]+)['"]/);
    if (importMatch) {
      const importStyle = importMatch[1] as 'import' | 'export';
      const packageName = importMatch[2];
      const path = importMatch[3];
      
      // Parse modifiers
      let alias: string | undefined;
      let show: string[] | undefined;
      let hide: string[] | undefined;
      let isDeferred = false;

      const asMatch = trimmed.match(/\s+as\s+(\w+)/);
      if (asMatch) {
        alias = asMatch[1];
      }

      const showMatch = trimmed.match(/\s+show\s+([^;]+)/);
      if (showMatch) {
        show = showMatch[1].split(',').map(s => s.trim());
      }

      const hideMatch = trimmed.match(/\s+hide\s+([^;]+)/);
      if (hideMatch) {
        hide = hideMatch[1].split(',').map(s => s.trim());
      }

      isDeferred = trimmed.includes('deferred');

      imports.push({
        packageName,
        path,
        importStyle,
        alias,
        show,
        hide,
        isDeferred,
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // import 'dart:xxx' - SDK imports
    const dartImportMatch = trimmed.match(/^import\s+['"]dart:([^'"]+)['"]/);
    if (dartImportMatch) {
      // Skip SDK imports for now (not package dependencies)
      continue;
    }

    // part 'file.dart'
    const partMatch = trimmed.match(/^part\s+['"]([^'"]+)['"]/);
    if (partMatch && !trimmed.includes('part of')) {
      imports.push({
        packageName: 'local',
        path: partMatch[1],
        importStyle: 'part',
        isDeferred: false,
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
    }
  }

  return imports;
}

/**
 * Find class/function usages in source code
 */
export function findClassUsages(source: string, classNames: string[], fileName: string = 'file.dart'): DartUsageInfo[] {
  const usages: DartUsageInfo[] = [];
  const lines = source.split('\n');

  const patterns = classNames.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (patterns.length === 0) return usages;

  const classPattern = patterns.join('|');
  // Match ClassName() or ClassName.method() or ClassName<T>
  const regex = new RegExp(`\\b(${classPattern})(?:<[^>]+>)?(?:\\.(\\w+))?\\s*\\(`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Skip import lines
    if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) {
      continue;
    }

    let match;
    while ((match = regex.exec(line)) !== null) {
      usages.push({
        identifier: match[1],
        method: match[2],
        isStatic: !!match[2],
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
 * Get common classes for a package
 */
export function getClassesForPackage(packageName: string): string[] {
  if (PACKAGE_TO_CLASSES[packageName]) {
    return PACKAGE_TO_CLASSES[packageName];
  }

  // Infer from package name
  // e.g., "my_package" -> "MyPackage"
  const pascalCase = packageName
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  
  return [pascalCase];
}

/**
 * Check if a package is from Dart SDK
 */
export function isSdkPackage(packageUri: string): boolean {
  return SDK_PACKAGES.has(packageUri) || packageUri.startsWith('dart:');
}
