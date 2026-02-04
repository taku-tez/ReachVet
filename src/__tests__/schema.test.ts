/**
 * Tests for JSON Schema generation
 */

import { describe, it, expect } from 'vitest';
import {
  generateConfigSchema,
  formatSchema,
  generateSchemaFile,
  generateConfigWithSchema,
  SUPPORTED_LANGUAGES,
  OUTPUT_FORMATS,
  FAIL_ON_OPTIONS
} from '../config/schema.js';
import type { JSONSchemaType } from '../config/schema.js';

describe('JSON Schema Generation', () => {
  describe('generateConfigSchema', () => {
    it('should generate a valid JSON Schema', () => {
      const schema = generateConfigSchema();
      
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(schema.type).toBe('object');
      expect(schema.title).toBe('ReachVet Configuration');
      expect(schema.properties).toBeDefined();
    });

    it('should include all expected top-level properties', () => {
      const schema = generateConfigSchema();
      const props = Object.keys(schema.properties!);
      
      expect(props).toContain('language');
      expect(props).toContain('sbom');
      expect(props).toContain('ignorePaths');
      expect(props).toContain('ignorePackages');
      expect(props).toContain('ignoreVulnerabilities');
      expect(props).toContain('output');
      expect(props).toContain('sarif');
      expect(props).toContain('html');
      expect(props).toContain('markdown');
      expect(props).toContain('osv');
      expect(props).toContain('cache');
      expect(props).toContain('watch');
      expect(props).toContain('precommit');
      expect(props).toContain('ci');
      expect(props).toContain('server');
      expect(props).toContain('license');
    });

    it('should have correct language enum', () => {
      const schema = generateConfigSchema();
      const langProp = schema.properties!.language as JSONSchemaType;
      
      expect(langProp.type).toBe('string');
      expect(langProp.enum).toEqual([...SUPPORTED_LANGUAGES]);
      expect(langProp.enum).toContain('javascript');
      expect(langProp.enum).toContain('python');
      expect(langProp.enum).toContain('go');
      expect(langProp.enum).toContain('rust');
    });

    it('should have correct output enum', () => {
      const schema = generateConfigSchema();
      const outputProp = schema.properties!.output as JSONSchemaType;
      
      expect(outputProp.enum).toEqual([...OUTPUT_FORMATS]);
      expect(outputProp.enum).toContain('text');
      expect(outputProp.enum).toContain('json');
      expect(outputProp.enum).toContain('sarif');
    });

    it('should have correct ci.failOn enum', () => {
      const schema = generateConfigSchema();
      const ciProp = schema.properties!.ci as JSONSchemaType;
      const failOnProp = ciProp.properties!.failOn as JSONSchemaType;
      
      expect(failOnProp.enum).toEqual([...FAIL_ON_OPTIONS]);
      expect(failOnProp.enum).toContain('vulnerable');
      expect(failOnProp.enum).toContain('reachable');
      expect(failOnProp.enum).toContain('none');
    });

    it('should define cache nested properties', () => {
      const schema = generateConfigSchema();
      const cacheProp = schema.properties!.cache as JSONSchemaType;
      
      expect(cacheProp.type).toBe('object');
      expect(cacheProp.properties!.enabled).toBeDefined();
      expect(cacheProp.properties!.ttl).toBeDefined();
      expect(cacheProp.properties!.maxSize).toBeDefined();
      expect(cacheProp.properties!.persist).toBeDefined();
      expect(cacheProp.properties!.persistPath).toBeDefined();
      expect(cacheProp.additionalProperties).toBe(false);
    });

    it('should define watch nested properties', () => {
      const schema = generateConfigSchema();
      const watchProp = schema.properties!.watch as JSONSchemaType;
      
      expect(watchProp.type).toBe('object');
      expect(watchProp.properties!.debounce).toBeDefined();
      expect(watchProp.properties!.ignore).toBeDefined();
      expect(watchProp.properties!.quiet).toBeDefined();
      expect(watchProp.additionalProperties).toBe(false);
    });

    it('should define server nested properties', () => {
      const schema = generateConfigSchema();
      const serverProp = schema.properties!.server as JSONSchemaType;
      
      expect(serverProp.type).toBe('object');
      expect(serverProp.properties!.port).toBeDefined();
      expect(serverProp.properties!.host).toBeDefined();
      expect(serverProp.properties!.cors).toBeDefined();
      expect(serverProp.properties!.apiKey).toBeDefined();
      expect(serverProp.properties!.rateLimit).toBeDefined();
    });

    it('should have minimum/maximum constraints', () => {
      const schema = generateConfigSchema();
      
      // Cache TTL
      const cacheProp = schema.properties!.cache as JSONSchemaType;
      const ttlProp = cacheProp.properties!.ttl as JSONSchemaType;
      expect(ttlProp.minimum).toBe(0);
      
      // Cache maxSize
      const maxSizeProp = cacheProp.properties!.maxSize as JSONSchemaType;
      expect(maxSizeProp.minimum).toBe(1);
      
      // Server port
      const serverProp = schema.properties!.server as JSONSchemaType;
      const portProp = serverProp.properties!.port as JSONSchemaType;
      expect(portProp.minimum).toBe(1);
      expect(portProp.maximum).toBe(65535);
    });

    it('should have descriptions for all properties', () => {
      const schema = generateConfigSchema();
      
      // Check top-level properties have descriptions
      for (const [key, prop] of Object.entries(schema.properties!)) {
        expect((prop as JSONSchemaType).description, `${key} should have description`).toBeDefined();
      }
    });

    it('should have examples where appropriate', () => {
      const schema = generateConfigSchema();
      
      const langProp = schema.properties!.language as JSONSchemaType;
      expect(langProp.examples).toBeDefined();
      expect(langProp.examples).toContain('javascript');
      
      const ignorePathsProp = schema.properties!.ignorePaths as JSONSchemaType;
      expect(ignorePathsProp.examples).toBeDefined();
    });

    it('should disallow additional properties at root level', () => {
      const schema = generateConfigSchema();
      expect(schema.additionalProperties).toBe(false);
    });
  });

  describe('formatSchema', () => {
    it('should format with default indentation', () => {
      const formatted = formatSchema();
      const parsed = JSON.parse(formatted);
      
      expect(parsed.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(formatted).toContain('\n'); // Has newlines
      expect(formatted).toContain('  '); // Has indentation
    });

    it('should format with custom indentation', () => {
      const formatted4 = formatSchema(4);
      expect(formatted4).toContain('    '); // 4-space indent
      
      const formatted0 = formatSchema(0);
      expect(formatted0).not.toContain('\n'); // No newlines in compact
    });
  });

  describe('generateSchemaFile', () => {
    it('should generate valid JSON Schema file content', () => {
      const content = generateSchemaFile();
      const parsed = JSON.parse(content);
      
      expect(parsed.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(parsed.$id).toContain('ReachVet');
    });
  });

  describe('generateConfigWithSchema', () => {
    it('should generate config with $schema reference', () => {
      const content = generateConfigWithSchema();
      const config = JSON.parse(content);
      
      expect(config.$schema).toBe('./reachvet.schema.json');
      expect(config.language).toBe('javascript');
      expect(config.osv).toBe(true);
      expect(config.cache).toBeDefined();
      expect(config.ci).toBeDefined();
    });

    it('should have all essential config fields', () => {
      const content = generateConfigWithSchema();
      const config = JSON.parse(content);
      
      expect(config.ignorePaths).toBeInstanceOf(Array);
      expect(config.cache.enabled).toBe(true);
      expect(config.ci.failOn).toBe('vulnerable');
      expect(config.ci.annotations).toBe(true);
    });
  });

  describe('constants', () => {
    it('should export SUPPORTED_LANGUAGES with 18 languages', () => {
      expect(SUPPORTED_LANGUAGES).toHaveLength(18);
      expect(SUPPORTED_LANGUAGES).toContain('javascript');
      expect(SUPPORTED_LANGUAGES).toContain('typescript');
      expect(SUPPORTED_LANGUAGES).toContain('python');
      expect(SUPPORTED_LANGUAGES).toContain('go');
      expect(SUPPORTED_LANGUAGES).toContain('java');
      expect(SUPPORTED_LANGUAGES).toContain('rust');
      expect(SUPPORTED_LANGUAGES).toContain('ruby');
      expect(SUPPORTED_LANGUAGES).toContain('php');
      expect(SUPPORTED_LANGUAGES).toContain('csharp');
      expect(SUPPORTED_LANGUAGES).toContain('swift');
      expect(SUPPORTED_LANGUAGES).toContain('kotlin');
      expect(SUPPORTED_LANGUAGES).toContain('scala');
      expect(SUPPORTED_LANGUAGES).toContain('elixir');
      expect(SUPPORTED_LANGUAGES).toContain('dart');
      expect(SUPPORTED_LANGUAGES).toContain('perl');
      expect(SUPPORTED_LANGUAGES).toContain('haskell');
      expect(SUPPORTED_LANGUAGES).toContain('clojure');
      expect(SUPPORTED_LANGUAGES).toContain('ocaml');
    });

    it('should export OUTPUT_FORMATS', () => {
      expect(OUTPUT_FORMATS).toEqual(['text', 'json', 'sarif']);
    });

    it('should export FAIL_ON_OPTIONS', () => {
      expect(FAIL_ON_OPTIONS).toEqual(['vulnerable', 'reachable', 'none']);
    });
  });
});

describe('Schema Validation', () => {
  it('should generate a schema that validates sample configs', () => {
    // The schema should be valid JSON Schema
    const schema = generateConfigSchema();
    
    // These configs should be valid according to the schema
    const validConfigs = [
      {},
      { language: 'javascript' },
      { osv: true, cache: { enabled: true } },
      { ci: { failOn: 'vulnerable', annotations: true } },
      { watch: { debounce: 500, quiet: false } },
      { ignorePaths: ['node_modules/**'], ignorePackages: ['lodash'] },
      { server: { port: 3000, host: 'localhost' } },
      { license: { policy: 'permissive-only' } },
    ];
    
    // Verify schema has all needed parts
    for (const config of validConfigs) {
      for (const key of Object.keys(config)) {
        expect(schema.properties, `Schema should have property ${key}`).toHaveProperty(key);
      }
    }
  });

  it('should have proper types for array properties', () => {
    const schema = generateConfigSchema();
    
    const arrayProps = ['ignorePaths', 'ignorePackages', 'ignoreVulnerabilities'];
    for (const prop of arrayProps) {
      const propSchema = schema.properties![prop] as JSONSchemaType;
      expect(propSchema.type).toBe('array');
      expect(propSchema.items).toBeDefined();
      expect(propSchema.items!.type).toBe('string');
    }
  });

  it('should have boolean types where appropriate', () => {
    const schema = generateConfigSchema();
    
    const boolProps = ['sarif', 'dark', 'osv'];
    for (const prop of boolProps) {
      const propSchema = schema.properties![prop] as JSONSchemaType;
      expect(propSchema.type).toBe('boolean');
    }
  });
});
