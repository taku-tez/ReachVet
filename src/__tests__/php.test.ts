/**
 * ReachVet PHP Language Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSource, findClassUsages, getNamespacesForPackage, isBuiltinClass } from '../languages/php/parser.js';
import { parseComposerJson, getDependencies, parseComposerLock, getLockedDependencies } from '../languages/php/composer.js';
import { quickAnalyze } from '../core/analyzer.js';
import type { Component } from '../types.js';

describe('PHP Parser', () => {
  describe('parseSource', () => {
    it('parses simple use statements', () => {
      const source = `<?php
        use GuzzleHttp\\Client;
        use Monolog\\Logger;
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(2);
      expect(imports[0].moduleName).toBe('GuzzleHttp\\Client');
      expect(imports[0].importStyle).toBe('use');
    });

    it('parses use with alias', () => {
      const source = `<?php
        use GuzzleHttp\\Client as HttpClient;
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].alias).toBe('HttpClient');
    });

    it('parses use function', () => {
      const source = `<?php
        use function str_contains;
        use function MyNamespace\\myFunction;
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(2);
      expect(imports[0].importStyle).toBe('use_function');
    });

    it('parses use const', () => {
      const source = `<?php
        use const MyNamespace\\MY_CONSTANT;
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].importStyle).toBe('use_const');
    });

    it('parses grouped use statements', () => {
      const source = `<?php
        use Symfony\\Component\\HttpFoundation\\{Request, Response, Cookie};
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleName).toBe('Symfony\\Component\\HttpFoundation');
      expect(imports[0].groupedNames).toContain('Request');
      expect(imports[0].groupedNames).toContain('Response');
    });

    it('parses require statements', () => {
      const source = `<?php
        require 'vendor/autoload.php';
        require_once 'config.php';
        include 'helpers.php';
        include_once 'functions.php';
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(4);
      expect(imports[0].importStyle).toBe('require');
      expect(imports[1].importStyle).toBe('require_once');
      expect(imports[2].importStyle).toBe('include');
      expect(imports[3].importStyle).toBe('include_once');
    });

    it('ignores comments', () => {
      const source = `<?php
        // use CommentedOut\\Class;
        # use AnotherComment\\Class;
        /* use BlockComment\\Class; */
        use Real\\Class;
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleName).toBe('Real\\Class');
    });
  });

  describe('findClassUsages', () => {
    it('finds static method calls', () => {
      const source = `<?php
        $response = Response::json(['data' => $data]);
        Logger::info('message');
      `;
      const usages = findClassUsages(source, ['Response', 'Logger']);
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
      expect(usages.some(u => u.identifier === 'Response' && u.method === 'json')).toBe(true);
    });

    it('finds new instantiations', () => {
      const source = `<?php
        $client = new Client(['timeout' => 30]);
      `;
      const usages = findClassUsages(source, ['Client']);
      
      expect(usages.length).toBeGreaterThan(0);
      expect(usages[0].identifier).toBe('Client');
    });
  });

  describe('getNamespacesForPackage', () => {
    it('returns known namespace mappings', () => {
      expect(getNamespacesForPackage('guzzlehttp/guzzle')).toContain('GuzzleHttp');
      expect(getNamespacesForPackage('monolog/monolog')).toContain('Monolog');
      expect(getNamespacesForPackage('laravel/framework')).toContain('Illuminate');
    });

    it('infers namespace from package name', () => {
      const namespaces = getNamespacesForPackage('acme/my-package');
      expect(namespaces.some(ns => ns.includes('Acme') || ns.includes('MyPackage'))).toBe(true);
    });
  });

  describe('isBuiltinClass', () => {
    it('identifies builtin classes', () => {
      expect(isBuiltinClass('DateTime')).toBe(true);
      expect(isBuiltinClass('PDO')).toBe(true);
      expect(isBuiltinClass('Exception')).toBe(true);
    });

    it('identifies non-builtin classes', () => {
      expect(isBuiltinClass('GuzzleHttp\\Client')).toBe(false);
      expect(isBuiltinClass('MyCustomClass')).toBe(false);
    });
  });
});

describe('Composer Parser', () => {
  describe('parseComposerJson', () => {
    it('parses dependencies', () => {
      const content = JSON.stringify({
        require: {
          'php': '^8.0',
          'guzzlehttp/guzzle': '^7.0',
          'monolog/monolog': '^3.0'
        },
        'require-dev': {
          'phpunit/phpunit': '^10.0'
        }
      });
      
      const composer = parseComposerJson(content);
      const deps = getDependencies(composer);
      
      expect(deps).toHaveLength(3); // Excluding php
      expect(deps.find(d => d.name === 'guzzlehttp/guzzle')).toBeDefined();
      expect(deps.find(d => d.name === 'phpunit/phpunit')?.type).toBe('require-dev');
    });
  });

  describe('parseComposerLock', () => {
    it('parses locked versions', () => {
      const content = JSON.stringify({
        packages: [
          { name: 'guzzlehttp/guzzle', version: 'v7.5.0' },
          { name: 'monolog/monolog', version: '3.2.0' }
        ],
        'packages-dev': [
          { name: 'phpunit/phpunit', version: '10.0.0' }
        ]
      });
      
      const lock = parseComposerLock(content);
      const deps = getLockedDependencies(lock);
      
      expect(deps).toHaveLength(3);
      expect(deps.find(d => d.name === 'guzzlehttp/guzzle')?.version).toBe('7.5.0');
    });
  });
});

describe('PHP Adapter Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-php-'));
    
    await writeFile(
      join(tempDir, 'composer.json'),
      JSON.stringify({
        require: {
          'guzzlehttp/guzzle': '^7.0',
          'monolog/monolog': '^3.0'
        }
      })
    );

    await mkdir(join(tempDir, 'src'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects used packages', async () => {
    await writeFile(
      join(tempDir, 'src', 'Service.php'),
      `<?php
        namespace App;
        
        use GuzzleHttp\\Client;
        
        class Service {
            public function fetch() {
                $client = new Client();
                return $client->get('https://api.example.com');
            }
        }
      `
    );

    const components: Component[] = [
      { name: 'guzzlehttp/guzzle', version: '7.5.0' },
      { name: 'monolog/monolog', version: '3.2.0' }
    ];

    const result = await quickAnalyze(tempDir, components, { language: 'php' });
    
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[1].status).toBe('not_reachable');
  });

  it('detects vulnerable method usage', async () => {
    await writeFile(
      join(tempDir, 'src', 'Logger.php'),
      `<?php
        namespace App;
        
        use Monolog\\Logger;
        use Monolog\\Handler\\StreamHandler;
        
        $log = new Logger('app');
        $log->pushHandler(new StreamHandler('app.log'));
        $log->info('Application started');
      `
    );

    const components: Component[] = [
      { 
        name: 'monolog/monolog', 
        version: '2.0.0',
        vulnerabilities: [{
          id: 'CVE-2022-XXXXX',
          severity: 'medium',
          affectedFunctions: ['pushHandler']
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components, { language: 'php' });
    
    expect(result.results[0].status).toBe('reachable');
  });
});
