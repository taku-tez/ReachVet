/**
 * ReachVet - Ruby Import Parser
 * 
 * Parses Ruby require/require_relative statements:
 * - require 'gem_name'
 * - require "gem_name"
 * - require_relative './local_file'
 * - require 'gem_name/submodule'
 * - Bundler.require(:default)
 * - autoload :ClassName, 'file'
 */

import type { CodeLocation } from '../../types.js';

export interface RubyImportInfo {
  /** The gem/file being required */
  moduleName: string;
  /** Import style */
  importStyle: 'require' | 'require_relative' | 'autoload' | 'bundler';
  /** If autoload, the constant being autoloaded */
  autoloadConstant?: string;
  /** Location in source */
  location: CodeLocation;
}

export interface RubyUsageInfo {
  /** Class/module being used */
  identifier: string;
  /** Method being called (if any) */
  method?: string;
  /** Location in source */
  location: CodeLocation;
}

// Map gem names to their main module/class names
const GEM_TO_MODULE: Record<string, string[]> = {
  'activerecord': ['ActiveRecord'],
  'activesupport': ['ActiveSupport'],
  'actionpack': ['ActionController', 'ActionDispatch'],
  'actionview': ['ActionView'],
  'actionmailer': ['ActionMailer'],
  'activejob': ['ActiveJob'],
  'actioncable': ['ActionCable'],
  'rails': ['Rails'],
  'nokogiri': ['Nokogiri'],
  'json': ['JSON'],
  'yaml': ['YAML', 'Psych'],
  'httparty': ['HTTParty'],
  'faraday': ['Faraday'],
  'rest-client': ['RestClient'],
  'rspec': ['RSpec'],
  'minitest': ['Minitest'],
  'pry': ['Pry'],
  'sidekiq': ['Sidekiq'],
  'redis': ['Redis'],
  'pg': ['PG'],
  'mysql2': ['Mysql2'],
  'sqlite3': ['SQLite3'],
  'mongoid': ['Mongoid'],
  'devise': ['Devise'],
  'omniauth': ['OmniAuth'],
  'jwt': ['JWT'],
  'bcrypt': ['BCrypt'],
  'rack': ['Rack'],
  'sinatra': ['Sinatra'],
  'haml': ['Haml'],
  'slim': ['Slim'],
  'erb': ['ERB'],
  'sass': ['Sass'],
  'sprockets': ['Sprockets'],
  'webpack': ['Webpacker'],
  'capistrano': ['Capistrano'],
  'puma': ['Puma'],
  'unicorn': ['Unicorn'],
  'aws-sdk': ['Aws'],
  'aws-sdk-s3': ['Aws::S3'],
  'aws-sdk-ec2': ['Aws::EC2'],
  'fog': ['Fog'],
  'paperclip': ['Paperclip'],
  'carrierwave': ['CarrierWave'],
  'shrine': ['Shrine'],
  'pundit': ['Pundit'],
  'cancancan': ['CanCan'],
  'ransack': ['Ransack'],
  'kaminari': ['Kaminari'],
  'will_paginate': ['WillPaginate'],
  'prawn': ['Prawn'],
  'wicked_pdf': ['WickedPdf'],
  'mechanize': ['Mechanize'],
  'capybara': ['Capybara'],
  'selenium-webdriver': ['Selenium'],
  'oj': ['Oj'],
  'multi_json': ['MultiJson'],
  'rexml': ['REXML'],
  'csv': ['CSV'],
  'net-http': ['Net::HTTP'],
  'net-smtp': ['Net::SMTP'],
  'openssl': ['OpenSSL'],
  'digest': ['Digest'],
  'base64': ['Base64'],
  'uri': ['URI'],
  'cgi': ['CGI'],
  'fileutils': ['FileUtils'],
  'pathname': ['Pathname'],
  'tempfile': ['Tempfile'],
  'logger': ['Logger'],
  'stringio': ['StringIO'],
  'date': ['Date', 'DateTime'],
  'time': ['Time'],
  'bigdecimal': ['BigDecimal'],
  'set': ['Set'],
  'ostruct': ['OpenStruct'],
  'securerandom': ['SecureRandom'],
};

// Standard library modules (not gems)
const STDLIB_MODULES = new Set([
  'abbrev', 'base64', 'benchmark', 'bigdecimal', 'cgi', 'coverage',
  'csv', 'date', 'digest', 'drb', 'English', 'erb', 'etc', 'fcntl',
  'fiddle', 'fileutils', 'find', 'forwardable', 'getoptlong', 'io/console',
  'io/nonblock', 'io/wait', 'ipaddr', 'irb', 'json', 'logger', 'matrix',
  'minitest', 'monitor', 'mutex_m', 'net/ftp', 'net/http', 'net/imap',
  'net/pop', 'net/smtp', 'nkf', 'observer', 'open-uri', 'open3', 'openssl',
  'optparse', 'ostruct', 'pathname', 'pp', 'prettyprint', 'prime', 'pstore',
  'psych', 'pty', 'racc', 'rdoc', 'readline', 'reline', 'resolv', 'rexml',
  'rinda', 'ripper', 'ruby2_keywords', 'rubygems', 'securerandom', 'set',
  'shellwords', 'singleton', 'socket', 'stringio', 'strscan', 'syslog',
  'tempfile', 'time', 'timeout', 'tmpdir', 'tracer', 'tsort', 'un', 'uri',
  'weakref', 'webrick', 'yaml', 'zlib',
]);

/**
 * Parse Ruby source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.rb'): RubyImportInfo[] {
  const imports: RubyImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    const commentIndex = line.indexOf('#');
    const codeLine = commentIndex >= 0 ? line.slice(0, commentIndex) : line;

    // require 'gem' or require "gem"
    const requireMatch = codeLine.match(/require\s+['"]([^'"]+)['"]/);
    if (requireMatch) {
      imports.push({
        moduleName: requireMatch[1],
        importStyle: 'require',
        location: {
          file: fileName,
          line: lineNum,
          snippet: line.trim().slice(0, 100)
        }
      });
      continue;
    }

    // require_relative './file'
    const requireRelativeMatch = codeLine.match(/require_relative\s+['"]([^'"]+)['"]/);
    if (requireRelativeMatch) {
      imports.push({
        moduleName: requireRelativeMatch[1],
        importStyle: 'require_relative',
        location: {
          file: fileName,
          line: lineNum,
          snippet: line.trim().slice(0, 100)
        }
      });
      continue;
    }

    // autoload :ClassName, 'file'
    const autoloadMatch = codeLine.match(/autoload\s+:(\w+)\s*,\s*['"]([^'"]+)['"]/);
    if (autoloadMatch) {
      imports.push({
        moduleName: autoloadMatch[2],
        importStyle: 'autoload',
        autoloadConstant: autoloadMatch[1],
        location: {
          file: fileName,
          line: lineNum,
          snippet: line.trim().slice(0, 100)
        }
      });
      continue;
    }

    // Bundler.require or Bundler.require(:group)
    const bundlerMatch = codeLine.match(/Bundler\.require\s*(\(.*?\))?/);
    if (bundlerMatch) {
      imports.push({
        moduleName: '__bundler__',
        importStyle: 'bundler',
        location: {
          file: fileName,
          line: lineNum,
          snippet: line.trim().slice(0, 100)
        }
      });
      continue;
    }
  }

  return imports;
}

/**
 * Find usages of gem modules in source code
 */
export function findModuleUsages(source: string, moduleNames: string[], fileName: string = 'file.rb'): RubyUsageInfo[] {
  const usages: RubyUsageInfo[] = [];
  const lines = source.split('\n');

  // Build regex for all module names
  const modulePattern = moduleNames.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!modulePattern) return usages;

  const regex = new RegExp(`\\b(${modulePattern})(?:::\\w+)*(?:\\.(\\w+))?`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    const commentIndex = line.indexOf('#');
    const codeLine = commentIndex >= 0 ? line.slice(0, commentIndex) : line;

    let match;
    while ((match = regex.exec(codeLine)) !== null) {
      usages.push({
        identifier: match[1],
        method: match[2],
        location: {
          file: fileName,
          line: lineNum,
          column: match.index + 1,
          snippet: line.trim().slice(0, 100)
        }
      });
    }
  }

  return usages;
}

/**
 * Get module names for a gem
 */
export function getModulesForGem(gemName: string): string[] {
  // Normalize gem name (replace - with _)
  const normalized = gemName.toLowerCase().replace(/-/g, '_');
  
  // Check direct mapping
  if (GEM_TO_MODULE[gemName]) {
    return GEM_TO_MODULE[gemName];
  }
  if (GEM_TO_MODULE[normalized]) {
    return GEM_TO_MODULE[normalized];
  }

  // Try to generate from gem name
  // rails_helper -> RailsHelper, active_support -> ActiveSupport
  const camelCase = gemName
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  
  return [camelCase];
}

/**
 * Check if a module is from stdlib
 */
export function isStdlib(moduleName: string): boolean {
  // Check full path first (e.g., 'net/http')
  if (STDLIB_MODULES.has(moduleName)) {
    return true;
  }
  // Then check base name (e.g., 'json')
  const baseName = moduleName.split('/')[0];
  return STDLIB_MODULES.has(baseName);
}

/**
 * Extract gem name from require path
 */
export function extractGemName(requirePath: string): string {
  // Handle subpaths: 'aws-sdk/s3' -> 'aws-sdk'
  // Handle namespaced: 'active_record/base' -> 'activerecord'
  const parts = requirePath.split('/');
  const baseName = parts[0];
  
  // Normalize common patterns
  return baseName.replace(/_/g, '');
}
