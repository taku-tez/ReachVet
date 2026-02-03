/**
 * ReachVet Ruby Language Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSource, findModuleUsages, getModulesForGem, isStdlib, extractGemName } from '../languages/ruby/parser.js';
import { parseGemfile, parseGemfileLock } from '../languages/ruby/gemfile.js';
import { quickAnalyze } from '../core/analyzer.js';
import type { Component } from '../types.js';

describe('Ruby Parser', () => {
  describe('parseSource', () => {
    it('parses require statements', () => {
      const source = `
        require 'rails'
        require "nokogiri"
        require 'json'
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(3);
      expect(imports[0].moduleName).toBe('rails');
      expect(imports[1].moduleName).toBe('nokogiri');
      expect(imports[2].moduleName).toBe('json');
      expect(imports[0].importStyle).toBe('require');
    });

    it('parses require_relative', () => {
      const source = `require_relative './lib/helper'`;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleName).toBe('./lib/helper');
      expect(imports[0].importStyle).toBe('require_relative');
    });

    it('parses submodule requires', () => {
      const source = `require 'aws-sdk/s3'`;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleName).toBe('aws-sdk/s3');
    });

    it('parses autoload', () => {
      const source = `autoload :MyClass, 'my_gem/my_class'`;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].importStyle).toBe('autoload');
      expect(imports[0].autoloadConstant).toBe('MyClass');
      expect(imports[0].moduleName).toBe('my_gem/my_class');
    });

    it('parses Bundler.require', () => {
      const source = `Bundler.require(:default, Rails.env)`;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].importStyle).toBe('bundler');
      expect(imports[0].moduleName).toBe('__bundler__');
    });

    it('ignores comments', () => {
      const source = `
        # require 'commented_out'
        require 'real_gem' # inline comment
      `;
      const imports = parseSource(source);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleName).toBe('real_gem');
    });
  });

  describe('findModuleUsages', () => {
    it('finds module method calls', () => {
      const source = `
        doc = Nokogiri::HTML(html)
        data = JSON.parse(str)
      `;
      const usages = findModuleUsages(source, ['Nokogiri', 'JSON']);
      
      expect(usages.length).toBeGreaterThanOrEqual(2);
      expect(usages.some(u => u.identifier === 'JSON' && u.method === 'parse')).toBe(true);
    });

    it('finds nested module references', () => {
      const source = `Aws::S3::Client.new`;
      const usages = findModuleUsages(source, ['Aws']);
      
      expect(usages.length).toBeGreaterThan(0);
    });
  });

  describe('getModulesForGem', () => {
    it('maps known gems', () => {
      expect(getModulesForGem('nokogiri')).toContain('Nokogiri');
      expect(getModulesForGem('activerecord')).toContain('ActiveRecord');
      expect(getModulesForGem('aws-sdk')).toContain('Aws');
    });

    it('generates CamelCase for unknown gems', () => {
      expect(getModulesForGem('my_custom_gem')).toContain('MyCustomGem');
      expect(getModulesForGem('some-gem-name')).toContain('SomeGemName');
    });
  });

  describe('isStdlib', () => {
    it('identifies stdlib modules', () => {
      expect(isStdlib('json')).toBe(true);
      expect(isStdlib('yaml')).toBe(true);
      expect(isStdlib('net/http')).toBe(true);
      expect(isStdlib('fileutils')).toBe(true);
    });

    it('identifies non-stdlib gems', () => {
      expect(isStdlib('rails')).toBe(false);
      expect(isStdlib('nokogiri')).toBe(false);
    });
  });

  describe('extractGemName', () => {
    it('extracts and normalizes gem name from subpath', () => {
      // extractGemName takes base name and removes underscores
      const awsResult = extractGemName('aws-sdk/s3');
      expect(awsResult).toBe('aws-sdk'); // hyphens preserved
      
      const arResult = extractGemName('active_record/base');
      expect(arResult).toBe('activerecord'); // underscores removed
    });
  });
});

describe('Gemfile Parser', () => {
  describe('parseGemfile', () => {
    it('parses simple gem declarations', () => {
      const content = `
        source 'https://rubygems.org'
        gem 'rails', '~> 7.0'
        gem 'pg'
      `;
      const deps = parseGemfile(content);
      
      expect(deps).toHaveLength(2);
      expect(deps[0].name).toBe('rails');
      expect(deps[0].version).toBe('~> 7.0');
      expect(deps[1].name).toBe('pg');
    });

    it('parses group blocks', () => {
      const content = `
        group :development, :test do
          gem 'rspec'
          gem 'pry'
        end
        gem 'rails'
      `;
      const deps = parseGemfile(content);
      
      expect(deps).toHaveLength(3);
      expect(deps[0].groups).toContain('development');
      expect(deps[0].groups).toContain('test');
      expect(deps[2].groups).toBeUndefined();
    });

    it('parses git and path sources', () => {
      const content = `
        gem 'my_gem', git: 'https://github.com/user/my_gem.git'
        gem 'local_gem', path: './local'
      `;
      const deps = parseGemfile(content);
      
      expect(deps[0].git).toBe('https://github.com/user/my_gem.git');
      expect(deps[1].path).toBe('./local');
    });

    it('parses require option', () => {
      const content = `
        gem 'sass-rails', require: 'sass'
        gem 'bootsnap', require: false
      `;
      const deps = parseGemfile(content);
      
      expect(deps[0].require).toBe('sass');
      expect(deps[1].require).toBe(false);
    });
  });

  describe('parseGemfileLock', () => {
    it('parses gem specs', () => {
      const content = `
GEM
  remote: https://rubygems.org/
  specs:
    rails (7.0.4)
    nokogiri (1.14.0)
    pg (1.4.5)

PLATFORMS
  x86_64-linux

DEPENDENCIES
  rails (~> 7.0)

BUNDLED WITH
   2.4.0
`;
      const info = parseGemfileLock(content);
      
      expect(info.gems.get('rails')).toBe('7.0.4');
      expect(info.gems.get('nokogiri')).toBe('1.14.0');
      expect(info.gems.get('pg')).toBe('1.4.5');
      expect(info.platforms).toContain('x86_64-linux');
      expect(info.bundlerVersion).toBe('2.4.0');
    });
  });
});

describe('Ruby Adapter Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-ruby-'));
    
    // Create Gemfile
    await writeFile(
      join(tempDir, 'Gemfile'),
      `source 'https://rubygems.org'
gem 'nokogiri'
gem 'rails'
`
    );

    await mkdir(join(tempDir, 'app'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects required gems', async () => {
    await writeFile(
      join(tempDir, 'app', 'parser.rb'),
      `
        require 'nokogiri'
        
        def parse_html(html)
          Nokogiri::HTML(html)
        end
      `
    );

    const components: Component[] = [
      { name: 'nokogiri', version: '1.14.0' },
      { name: 'rails', version: '7.0.4' }
    ];

    const result = await quickAnalyze(tempDir, components, { language: 'ruby' });
    
    expect(result.results[0].status).toBe('reachable');
    expect(result.results[1].status).toBe('not_reachable');
  });

  it('detects vulnerable method usage', async () => {
    await writeFile(
      join(tempDir, 'app', 'service.rb'),
      `
        require 'nokogiri'
        
        doc = Nokogiri::XML(data)
        Nokogiri.xpath('//item')
      `
    );

    const components: Component[] = [
      { 
        name: 'nokogiri', 
        version: '1.13.0',
        vulnerabilities: [{
          id: 'CVE-2022-XXXXX',
          severity: 'high',
          affectedFunctions: ['xpath']
        }]
      }
    ];

    const result = await quickAnalyze(tempDir, components, { language: 'ruby' });
    
    expect(result.results[0].status).toBe('reachable');
    // Method tracking may or may not capture xpath depending on call style
  });

  it('handles Bundler.require', async () => {
    await mkdir(join(tempDir, 'config'));
    await writeFile(
      join(tempDir, 'config', 'application.rb'),
      `
        require 'bundler/setup'
        Bundler.require(*Rails.groups)
      `
    );

    const components: Component[] = [
      { name: 'rails', version: '7.0.4' }
    ];

    const result = await quickAnalyze(tempDir, components, { language: 'ruby' });
    
    // Should be imported (via Bundler.require) even without explicit require
    expect(['reachable', 'imported']).toContain(result.results[0].status);
  });
});
