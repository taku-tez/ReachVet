/**
 * ReachVet - Swift Import Parser
 * 
 * Parses Swift import statements:
 * - import Module
 * - import struct Module.Type
 * - import class Module.ClassName
 * - import func Module.function
 * - @_exported import Module
 * - @testable import Module
 */

import type { CodeLocation } from '../../types.js';

export interface SwiftImportInfo {
  /** The module being imported */
  moduleName: string;
  /** Import style */
  importStyle: 'module' | 'struct' | 'class' | 'func' | 'var' | 'typealias' | 'protocol' | 'enum';
  /** Specific symbol imported (for partial imports) */
  symbol?: string;
  /** Is it @_exported */
  isExported: boolean;
  /** Is it @testable */
  isTestable: boolean;
  /** Location in source */
  location: CodeLocation;
}

export interface SwiftUsageInfo {
  /** Type/class being used */
  identifier: string;
  /** Method being called (if any) */
  method?: string;
  /** Is it a static call */
  isStatic: boolean;
  /** Location in source */
  location: CodeLocation;
}

// Map SPM package names to their module names
const PACKAGE_TO_MODULE: Record<string, string[]> = {
  // Networking
  'Alamofire': ['Alamofire'],
  'Moya': ['Moya'],
  'swift-nio': ['NIO', 'NIOHTTP1', 'NIOHTTP2', 'NIOCore', 'NIOPosix'],
  'Vapor': ['Vapor'],
  'Kitura': ['Kitura'],
  'Perfect': ['PerfectHTTP', 'PerfectHTTPServer'],
  
  // Data/JSON
  'SwiftyJSON': ['SwiftyJSON'],
  'ObjectMapper': ['ObjectMapper'],
  'Codextended': ['Codextended'],
  
  // Reactive
  'RxSwift': ['RxSwift', 'RxCocoa', 'RxRelay', 'RxBlocking', 'RxTest'],
  'Combine': ['Combine'],
  'ReactiveSwift': ['ReactiveSwift'],
  'OpenCombine': ['OpenCombine'],
  
  // UI
  'SnapKit': ['SnapKit'],
  'Kingfisher': ['Kingfisher'],
  'SDWebImage': ['SDWebImage'],
  'Nuke': ['Nuke'],
  'Lottie': ['Lottie'],
  'Hero': ['Hero'],
  'SwiftUI': ['SwiftUI'],
  
  // Database/Storage
  'Realm': ['RealmSwift', 'Realm'],
  'GRDB.swift': ['GRDB'],
  'SQLite.swift': ['SQLite'],
  'CoreStore': ['CoreStore'],
  'SwiftData': ['SwiftData'],
  
  // Logging/Analytics
  'SwiftyBeaver': ['SwiftyBeaver'],
  'CocoaLumberjack': ['CocoaLumberjack'],
  'swift-log': ['Logging'],
  'Firebase': ['Firebase', 'FirebaseCore', 'FirebaseAuth', 'FirebaseFirestore', 'FirebaseAnalytics'],
  
  // Testing
  'Quick': ['Quick'],
  'Nimble': ['Nimble'],
  'OHHTTPStubs': ['OHHTTPStubs'],
  
  // Security
  'CryptoSwift': ['CryptoSwift'],
  'KeychainAccess': ['KeychainAccess'],
  
  // Dependency Injection
  'Swinject': ['Swinject'],
  'Resolver': ['Resolver'],
  'Factory': ['Factory'],
  
  // Architecture
  'TCA': ['ComposableArchitecture'],
  'swift-composable-architecture': ['ComposableArchitecture'],
  'ReSwift': ['ReSwift'],
  'RIBs': ['RIBs'],
  
  // AWS
  'AWSSDKSwift': ['AWSSDKSwift'],
  'Soto': ['SotoCore', 'SotoS3', 'SotoDynamoDB'],
  
  // Other
  'Then': ['Then'],
  'SwiftLint': ['SwiftLintFramework'],
  'PromiseKit': ['PromiseKit'],
  'SwiftDate': ['SwiftDate'],
  'R.swift': ['Rswift'],
};

// Apple framework modules (built-in)
const APPLE_FRAMEWORKS = new Set([
  'Foundation', 'UIKit', 'AppKit', 'SwiftUI', 'Combine', 'CoreData',
  'CoreGraphics', 'CoreAnimation', 'CoreImage', 'CoreML', 'Vision',
  'AVFoundation', 'AVKit', 'MapKit', 'StoreKit', 'GameKit',
  'HealthKit', 'HomeKit', 'WatchKit', 'ClockKit', 'SpriteKit',
  'SceneKit', 'ARKit', 'RealityKit', 'Metal', 'MetalKit',
  'Security', 'LocalAuthentication', 'CryptoKit', 'Network',
  'CoreLocation', 'CoreBluetooth', 'CoreMotion', 'CoreHaptics',
  'UserNotifications', 'PushKit', 'CloudKit', 'CallKit',
  'Photos', 'PhotosUI', 'PDFKit', 'QuickLook', 'WebKit',
  'SafariServices', 'AuthenticationServices', 'CoreTelephony',
  'MessageUI', 'Messages', 'ContactsUI', 'Contacts', 'EventKit',
  'Swift', 'Darwin', 'os', 'Dispatch', 'ObjectiveC',
  'XCTest', 'Testing',
]);

/**
 * Parse Swift source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.swift'): SwiftImportInfo[] {
  const imports: SwiftImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Check for attributes
    const isExported = trimmed.includes('@_exported');
    const isTestable = trimmed.includes('@testable');

    // Remove attributes for parsing
    let importLine = trimmed
      .replace(/@_exported\s+/g, '')
      .replace(/@testable\s+/g, '')
      .trim();

    // import struct/class/func/var/typealias/protocol/enum Module.Symbol
    const partialMatch = importLine.match(/^import\s+(struct|class|func|var|typealias|protocol|enum)\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/);
    if (partialMatch) {
      imports.push({
        moduleName: partialMatch[2],
        importStyle: partialMatch[1] as SwiftImportInfo['importStyle'],
        symbol: partialMatch[3],
        isExported,
        isTestable,
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // import Module
    const moduleMatch = importLine.match(/^import\s+([A-Za-z0-9_]+)\s*$/);
    if (moduleMatch) {
      imports.push({
        moduleName: moduleMatch[1],
        importStyle: 'module',
        isExported,
        isTestable,
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
 * Find usages of types in source code
 */
export function findTypeUsages(source: string, typeNames: string[], fileName: string = 'file.swift'): SwiftUsageInfo[] {
  const usages: SwiftUsageInfo[] = [];
  const lines = source.split('\n');

  const patterns = typeNames.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (patterns.length === 0) return usages;

  const typePattern = patterns.join('|');
  // Match TypeName.method() or TypeName() or TypeName<T> or TypeName.self
  const regex = new RegExp(`\\b(${typePattern})(?:<[^>]+>)?(?:\\.(\\w+))?`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Skip import lines
    if (trimmed.startsWith('import ') || trimmed.startsWith('@_exported') || trimmed.startsWith('@testable')) {
      continue;
    }

    let match;
    while ((match = regex.exec(line)) !== null) {
      const method = match[2];
      // Skip .Type, .self, .Protocol
      if (method && ['Type', 'self', 'Protocol'].includes(method)) {
        continue;
      }

      usages.push({
        identifier: match[1],
        method: method,
        isStatic: Boolean(line.includes('.shared') || (method !== undefined && method !== '' && !/^[a-z]/.test(method))),
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
 * Get module names for a package
 */
export function getModulesForPackage(packageName: string): string[] {
  if (PACKAGE_TO_MODULE[packageName]) {
    return PACKAGE_TO_MODULE[packageName];
  }

  // Try common patterns
  // Package name often matches module name
  return [packageName, packageName.replace(/[-_.]/g, '')];
}

/**
 * Check if a module is an Apple framework
 */
export function isAppleFramework(moduleName: string): boolean {
  return APPLE_FRAMEWORKS.has(moduleName);
}
