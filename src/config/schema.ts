/**
 * ReachVet Configuration JSON Schema Generator
 * 
 * Generates JSON Schema for IDE autocompletion and validation
 */

export interface JSONSchemaType {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, JSONSchemaType>;
  items?: JSONSchemaType;
  required?: string[];
  additionalProperties?: boolean;
  enum?: (string | number | boolean | null)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  oneOf?: JSONSchemaType[];
  anyOf?: JSONSchemaType[];
  allOf?: JSONSchemaType[];
  $ref?: string;
  definitions?: Record<string, JSONSchemaType>;
  examples?: unknown[];
}

/**
 * Supported languages for the language field
 */
export const SUPPORTED_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'go',
  'java',
  'rust',
  'ruby',
  'php',
  'csharp',
  'swift',
  'kotlin',
  'scala',
  'elixir',
  'dart',
  'perl',
  'haskell',
  'clojure',
  'ocaml'
] as const;

/**
 * Output format options
 */
export const OUTPUT_FORMATS = ['text', 'json', 'sarif'] as const;

/**
 * CI fail-on options
 */
export const FAIL_ON_OPTIONS = ['vulnerable', 'reachable', 'none'] as const;

/**
 * Generate the full JSON Schema for ReachVet configuration
 */
export function generateConfigSchema(): JSONSchemaType {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://github.com/taku-tez/ReachVet/blob/main/reachvet.schema.json',
    title: 'ReachVet Configuration',
    description: 'Configuration file schema for ReachVet - Supply chain reachability analyzer',
    type: 'object',
    properties: {
      // Analysis options
      language: {
        type: 'string',
        description: 'Programming language to analyze. Auto-detected if not specified.',
        enum: [...SUPPORTED_LANGUAGES],
        examples: ['javascript', 'python', 'go']
      },
      sbom: {
        type: 'string',
        description: 'Path to SBOM file (CycloneDX or SPDX JSON format)',
        examples: ['sbom.json', 'bom.json']
      },
      ignorePaths: {
        type: 'array',
        description: 'Glob patterns for paths to ignore during analysis',
        items: { type: 'string' },
        default: [],
        examples: [['node_modules/**', 'dist/**', 'build/**', '**/*.test.ts']]
      },
      ignorePackages: {
        type: 'array',
        description: 'Package names to ignore (won\'t be reported as reachable)',
        items: { type: 'string' },
        default: [],
        examples: [['lodash', 'underscore']]
      },
      ignoreVulnerabilities: {
        type: 'array',
        description: 'Vulnerability IDs to ignore (e.g., CVE-2021-xxxx, GHSA-xxxx)',
        items: { type: 'string' },
        default: [],
        examples: [['CVE-2021-12345', 'GHSA-abcd-efgh-ijkl']]
      },
      
      // Output options
      output: {
        type: 'string',
        description: 'Output format for analysis results',
        enum: [...OUTPUT_FORMATS],
        default: 'text'
      },
      sarif: {
        type: 'boolean',
        description: 'Output results in SARIF format (overrides output option)',
        default: false
      },
      html: {
        type: 'string',
        description: 'Path to write HTML report file',
        examples: ['report.html', 'analysis-report.html']
      },
      markdown: {
        type: 'string',
        description: 'Path to write Markdown report file',
        examples: ['REPORT.md', 'analysis.md']
      },
      graph: {
        type: 'string',
        description: 'Path to write Mermaid dependency graph file',
        examples: ['deps.mmd', 'graph.mermaid']
      },
      dot: {
        type: 'string',
        description: 'Path to write DOT (Graphviz) dependency graph file',
        examples: ['deps.dot', 'graph.gv']
      },
      junit: {
        type: 'string',
        description: 'Path to write JUnit XML report file',
        examples: ['junit.xml', 'test-results.xml']
      },
      dark: {
        type: 'boolean',
        description: 'Use dark theme for HTML reports',
        default: false
      },
      
      // OSV options
      osv: {
        type: 'boolean',
        description: 'Enable OSV.dev vulnerability lookup',
        default: false
      },
      osvCache: {
        type: 'string',
        description: 'Path to OSV cache directory',
        default: '.reachvet-cache'
      },
      
      // Cache options
      cache: {
        type: 'object',
        description: 'Analysis caching options',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'Enable analysis result caching',
            default: true
          },
          ttl: {
            type: 'number',
            description: 'Cache time-to-live in milliseconds',
            default: 3600000,
            minimum: 0,
            examples: [3600000, 86400000]
          },
          maxSize: {
            type: 'number',
            description: 'Maximum number of cached entries',
            default: 1000,
            minimum: 1
          },
          persist: {
            type: 'boolean',
            description: 'Persist cache to disk',
            default: false
          },
          persistPath: {
            type: 'string',
            description: 'Path for persistent cache file',
            default: '.reachvet-cache/analysis.json'
          }
        },
        additionalProperties: false
      },
      
      // Watch mode options
      watch: {
        type: 'object',
        description: 'File watcher options for continuous analysis',
        properties: {
          debounce: {
            type: 'number',
            description: 'Debounce delay in milliseconds before re-analyzing',
            default: 500,
            minimum: 0,
            examples: [250, 500, 1000]
          },
          ignore: {
            type: 'array',
            description: 'Additional glob patterns to ignore in watch mode',
            items: { type: 'string' },
            default: [],
            examples: [['**/*.test.ts', '**/*.spec.ts', 'coverage/**']]
          },
          quiet: {
            type: 'boolean',
            description: 'Show only summary line (no detailed output)',
            default: false
          }
        },
        additionalProperties: false
      },
      
      // Pre-commit options
      precommit: {
        type: 'object',
        description: 'Pre-commit hook options',
        properties: {
          blockOnReachable: {
            type: 'boolean',
            description: 'Block commit if any reachable dependencies are found',
            default: false
          },
          skipNoStaged: {
            type: 'boolean',
            description: 'Skip analysis if no relevant files are staged',
            default: true
          },
          verbose: {
            type: 'boolean',
            description: 'Show detailed output during pre-commit',
            default: false
          }
        },
        additionalProperties: false
      },
      
      // CI options
      ci: {
        type: 'object',
        description: 'CI/CD integration options',
        properties: {
          failOn: {
            type: 'string',
            description: 'When to fail the CI build',
            enum: [...FAIL_ON_OPTIONS],
            default: 'vulnerable'
          },
          annotations: {
            type: 'boolean',
            description: 'Output GitHub Actions annotations',
            default: true
          }
        },
        additionalProperties: false
      },
      
      // Server options
      server: {
        type: 'object',
        description: 'API server options',
        properties: {
          port: {
            type: 'number',
            description: 'Server port',
            default: 3000,
            minimum: 1,
            maximum: 65535
          },
          host: {
            type: 'string',
            description: 'Server host',
            default: 'localhost'
          },
          cors: {
            type: 'boolean',
            description: 'Enable CORS',
            default: true
          },
          apiKey: {
            type: 'string',
            description: 'API key for authentication (optional)'
          },
          rateLimit: {
            type: 'number',
            description: 'Maximum requests per minute (0 to disable)',
            default: 0,
            minimum: 0
          }
        },
        additionalProperties: false
      },
      
      // License options
      license: {
        type: 'object',
        description: 'License compliance options',
        properties: {
          policy: {
            type: 'string',
            description: 'Predefined license policy',
            enum: ['permissive-only', 'osi-approved', 'no-agpl', 'copyleft-aware'],
            examples: ['permissive-only', 'osi-approved']
          },
          allowed: {
            type: 'array',
            description: 'Explicitly allowed license SPDX identifiers',
            items: { type: 'string' },
            examples: [['MIT', 'Apache-2.0', 'BSD-3-Clause']]
          },
          denied: {
            type: 'array',
            description: 'Explicitly denied license SPDX identifiers',
            items: { type: 'string' },
            examples: [['GPL-3.0', 'AGPL-3.0']]
          }
        },
        additionalProperties: false
      }
    },
    additionalProperties: false
  };
}

/**
 * Format schema as JSON string
 */
export function formatSchema(indent: number = 2): string {
  return JSON.stringify(generateConfigSchema(), null, indent);
}

/**
 * Generate schema file content with $schema reference comment
 */
export function generateSchemaFile(): string {
  return formatSchema(2);
}

/**
 * Generate a sample config with $schema reference
 */
export function generateConfigWithSchema(): string {
  const config = {
    $schema: './reachvet.schema.json',
    language: 'javascript',
    ignorePaths: ['node_modules/**', 'dist/**'],
    osv: true,
    cache: {
      enabled: true,
      ttl: 3600000
    },
    ci: {
      failOn: 'vulnerable',
      annotations: true
    }
  };
  
  return JSON.stringify(config, null, 2);
}
