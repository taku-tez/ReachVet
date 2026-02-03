/**
 * ReachVet - Swift Language Support Tests
 */

import { describe, it, expect } from 'vitest';
import { parseSource, findTypeUsages, getModulesForPackage, isAppleFramework } from '../languages/swift/parser.js';
import { parsePackageSwift, parsePackageResolved, parsePodfile, parsePodfileLock, parseCartfile, getTargetPlatform } from '../languages/swift/spm.js';
import { SwiftAdapter } from '../languages/swift/index.js';

describe('Swift Parser', () => {
  describe('parseSource', () => {
    it('should parse basic import statements', () => {
      const code = `
import Foundation
import UIKit
import Alamofire
import SwiftyJSON

class MyViewController: UIViewController {
}
`;
      const imports = parseSource(code, 'ViewController.swift');
      
      expect(imports).toHaveLength(4);
      expect(imports[0].moduleName).toBe('Foundation');
      expect(imports[0].importStyle).toBe('module');
      expect(imports[2].moduleName).toBe('Alamofire');
      expect(imports[3].moduleName).toBe('SwiftyJSON');
    });

    it('should parse partial imports', () => {
      const code = `
import Foundation
import struct SwiftyJSON.JSON
import class Alamofire.Session
import func Darwin.arc4random

class Test {}
`;
      const imports = parseSource(code, 'Test.swift');
      
      expect(imports).toHaveLength(4);
      expect(imports[1].importStyle).toBe('struct');
      expect(imports[1].moduleName).toBe('SwiftyJSON');
      expect(imports[1].symbol).toBe('JSON');
      expect(imports[2].importStyle).toBe('class');
      expect(imports[2].moduleName).toBe('Alamofire');
      expect(imports[2].symbol).toBe('Session');
      expect(imports[3].importStyle).toBe('func');
    });

    it('should parse @_exported imports', () => {
      const code = `
@_exported import Alamofire
import Foundation
`;
      const imports = parseSource(code, 'Module.swift');
      
      expect(imports).toHaveLength(2);
      expect(imports[0].isExported).toBe(true);
      expect(imports[0].moduleName).toBe('Alamofire');
      expect(imports[1].isExported).toBe(false);
    });

    it('should parse @testable imports', () => {
      const code = `
import XCTest
@testable import MyApp

class MyAppTests: XCTestCase {}
`;
      const imports = parseSource(code, 'MyAppTests.swift');
      
      expect(imports).toHaveLength(2);
      expect(imports[1].isTestable).toBe(true);
      expect(imports[1].moduleName).toBe('MyApp');
    });

    it('should include location info', () => {
      const code = `import Foundation
import Alamofire`;
      
      const imports = parseSource(code, 'App.swift');
      
      expect(imports[0].location.file).toBe('App.swift');
      expect(imports[0].location.line).toBe(1);
      expect(imports[1].location.line).toBe(2);
    });
  });

  describe('findTypeUsages', () => {
    it('should find method calls', () => {
      const code = `
class NetworkManager {
    func fetch() {
        AF.request("https://api.example.com")
            .responseJSON { response in
                print(response)
            }
    }
}
`;
      const usages = findTypeUsages(code, ['AF'], 'NetworkManager.swift');
      
      expect(usages.length).toBeGreaterThanOrEqual(1);
      expect(usages[0].identifier).toBe('AF');
      expect(usages[0].method).toBe('request');
    });

    it('should find type instantiation', () => {
      const code = `
let json = JSON(data)
let session = Session.default
let disposeBag = DisposeBag()
`;
      const usages = findTypeUsages(code, ['JSON', 'Session', 'DisposeBag'], 'Test.swift');
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getModulesForPackage', () => {
    it('should return known mappings', () => {
      expect(getModulesForPackage('Alamofire')).toContain('Alamofire');
      expect(getModulesForPackage('RxSwift')).toContain('RxSwift');
      expect(getModulesForPackage('RxSwift')).toContain('RxCocoa');
    });

    it('should infer from package name', () => {
      expect(getModulesForPackage('SomePackage')).toContain('SomePackage');
    });
  });

  describe('isAppleFramework', () => {
    it('should identify Apple frameworks', () => {
      expect(isAppleFramework('Foundation')).toBe(true);
      expect(isAppleFramework('UIKit')).toBe(true);
      expect(isAppleFramework('SwiftUI')).toBe(true);
      expect(isAppleFramework('Combine')).toBe(true);
    });

    it('should not flag third-party modules', () => {
      expect(isAppleFramework('Alamofire')).toBe(false);
      expect(isAppleFramework('RxSwift')).toBe(false);
      expect(isAppleFramework('SnapKit')).toBe(false);
    });
  });
});

describe('SPM Parser', () => {
  describe('parsePackageSwift', () => {
    it('should parse package dependencies', () => {
      const content = `
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MyApp",
    dependencies: [
        .package(url: "https://github.com/Alamofire/Alamofire.git", from: "5.8.0"),
        .package(url: "https://github.com/SwiftyJSON/SwiftyJSON.git", .upToNextMajor(from: "5.0.0")),
        .package(url: "https://github.com/ReactiveX/RxSwift.git", exact: "6.6.0"),
    ]
)
`;
      const deps = parsePackageSwift(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].name).toBe('Alamofire');
      expect(deps[0].version).toBe('5.8.0');
      expect(deps[0].source).toBe('spm');
      expect(deps[1].name).toBe('SwiftyJSON');
      expect(deps[2].name).toBe('RxSwift');
      expect(deps[2].version).toBe('6.6.0');
    });

    it('should parse named packages', () => {
      const content = `
.package(name: "swift-nio", url: "https://github.com/apple/swift-nio.git", from: "2.50.0"),
`;
      const deps = parsePackageSwift(content);
      
      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('swift-nio');
    });

    it('should parse branch/revision dependencies', () => {
      const content = `
.package(url: "https://github.com/example/package.git", branch: "main"),
.package(url: "https://github.com/example/other.git", revision: "abc123"),
`;
      const deps = parsePackageSwift(content);
      
      expect(deps).toHaveLength(2);
      expect(deps[0].version).toBe('main');
      expect(deps[1].version).toBe('abc123');
    });
  });

  describe('parsePackageResolved', () => {
    it('should parse V2 format', () => {
      const content = JSON.stringify({
        pins: [
          {
            identity: 'alamofire',
            location: 'https://github.com/Alamofire/Alamofire.git',
            state: { version: '5.8.1' }
          },
          {
            identity: 'swiftyjson',
            location: 'https://github.com/SwiftyJSON/SwiftyJSON.git',
            state: { version: '5.0.1' }
          }
        ]
      });
      
      const deps = parsePackageResolved(content);
      
      expect(deps).toHaveLength(2);
      expect(deps[0].name).toBe('alamofire');
      expect(deps[0].version).toBe('5.8.1');
    });
  });

  describe('parsePodfile', () => {
    it('should parse pod dependencies', () => {
      const content = `
platform :ios, '15.0'

target 'MyApp' do
  use_frameworks!

  pod 'Alamofire', '~> 5.8'
  pod 'SwiftyJSON', '5.0.1'
  pod 'SnapKit'

end
`;
      const deps = parsePodfile(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].name).toBe('Alamofire');
      expect(deps[0].version).toBe('~> 5.8');
      expect(deps[0].source).toBe('cocoapods');
      expect(deps[1].name).toBe('SwiftyJSON');
      expect(deps[2].name).toBe('SnapKit');
      expect(deps[2].version).toBe('*');
    });
  });

  describe('parsePodfileLock', () => {
    it('should parse locked versions', () => {
      const content = `
PODS:
  - Alamofire (5.8.1)
  - SwiftyJSON (5.0.1)
  - SnapKit (5.6.0)

DEPENDENCIES:
  - Alamofire (~> 5.8)
`;
      const deps = parsePodfileLock(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].name).toBe('Alamofire');
      expect(deps[0].version).toBe('5.8.1');
    });
  });

  describe('parseCartfile', () => {
    it('should parse Carthage dependencies', () => {
      const content = `
github "Alamofire/Alamofire" ~> 5.8
github "SwiftyJSON/SwiftyJSON" == 5.0.1
github "SnapKit/SnapKit"
`;
      const deps = parseCartfile(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].name).toBe('Alamofire');
      expect(deps[0].version).toBe('5.8');
      expect(deps[0].source).toBe('carthage');
      expect(deps[1].name).toBe('SwiftyJSON');
      expect(deps[1].version).toBe('5.0.1');
    });
  });

  describe('getTargetPlatform', () => {
    it('should extract platforms', () => {
      const content = `
platforms: [
    .iOS(.v15),
    .macOS(.v12),
    .tvOS(.v15),
]
`;
      const platforms = getTargetPlatform(content);
      
      expect(platforms).toContain('iOS 15+');
      expect(platforms).toContain('macOS 12+');
      expect(platforms).toContain('tvOS 15+');
    });
  });
});

describe('SwiftAdapter', () => {
  const adapter = new SwiftAdapter();

  it('should have correct language property', () => {
    expect(adapter.language).toBe('swift');
  });

  it('should have correct file extensions', () => {
    expect(adapter.fileExtensions).toContain('.swift');
  });
});
