/**
 * ReachVet - Type Definitions
 */

// ============================================================
// Input Types (SBOM / Component List)
// ============================================================

/**
 * Component from SBOM or simple list
 */
export interface Component {
  name: string;
  version: string;
  purl?: string;           // Package URL (pkg:npm/lodash@4.17.20)
  ecosystem?: string;      // npm, pypi, maven, etc.
  license?: string;
  vulnerabilities?: ComponentVulnerability[];
}

/**
 * Vulnerability info for a component
 */
export interface ComponentVulnerability {
  id: string;              // CVE-2024-1234, GHSA-xxxx
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  affectedVersions?: string;
  affectedFunctions?: string[];  // Functions known to be vulnerable
  fixedVersion?: string;
  description?: string;
}

/**
 * Input format for ReachVet
 */
export interface ReachVetInput {
  format: 'simple' | 'cyclonedx' | 'spdx';
  components: Component[];
  sourceDir: string;
  language: SupportedLanguage;
}

// ============================================================
// Analysis Types
// ============================================================

export type SupportedLanguage = 'javascript' | 'typescript' | 'python' | 'go' | 'java' | 'rust' | 'ruby' | 'php' | 'csharp' | 'swift' | 'kotlin';

export type ReachabilityStatus = 
  | 'reachable'         // Component is imported and used
  | 'imported'          // Component is imported but usage unclear
  | 'not_reachable'     // Component is not imported anywhere
  | 'indirect'          // Used via re-export or transitive
  | 'unknown';          // Could not determine

/**
 * Import/usage location in source code
 */
export interface CodeLocation {
  file: string;
  line: number;
  column?: number;
  snippet?: string;
}

/**
 * How a component is used
 */
export interface UsageInfo {
  importStyle: 'esm' | 'commonjs' | 'dynamic' | 'require';
  importedAs?: string;       // import name or alias
  usedMembers?: string[];    // Specific exports used (e.g., ['merge', 'cloneDeep'])
  locations: CodeLocation[];
}

/**
 * Warning about analysis limitations
 */
export interface AnalysisWarning {
  code: 'dynamic_import' | 'eval_detected' | 'indirect_usage' | 'namespace_import' | 'barrel_file' | 'circular_reexport' | 'max_depth_reached' | 'star_import' | 'dot_import' | 'blank_import';
  message: string;
  location?: CodeLocation;
  severity: 'info' | 'warning';
}

/**
 * Analysis result for a single component
 */
export interface ComponentResult {
  component: Component;
  status: ReachabilityStatus;
  usage?: UsageInfo;
  confidence: 'high' | 'medium' | 'low';
  notes?: string[];
  warnings?: AnalysisWarning[];
}

// ============================================================
// Output Types
// ============================================================

export interface AnalysisSummary {
  total: number;
  reachable: number;
  imported: number;
  notReachable: number;
  indirect: number;
  unknown: number;
  vulnerableReachable: number;  // Vulnerable AND reachable
  warningsCount: number;        // Total warnings across all components
}

export interface AnalysisOutput {
  version: string;
  timestamp: string;
  sourceDir: string;
  language: SupportedLanguage;
  summary: AnalysisSummary;
  results: ComponentResult[];
}

// ============================================================
// Language Adapter Interface
// ============================================================

/**
 * Interface that each language adapter must implement
 */
export interface LanguageAdapter {
  language: SupportedLanguage;
  fileExtensions: string[];
  
  /**
   * Analyze if components are reachable in the source code
   */
  analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]>;
  
  /**
   * Check if this adapter can handle the given directory
   */
  canHandle(sourceDir: string): Promise<boolean>;
}

// ============================================================
// Options
// ============================================================

export interface AnalyzeOptions {
  sourceDir: string;
  language?: SupportedLanguage;  // Auto-detect if not specified
  concurrency?: number;
  verbose?: boolean;
  includeDevDependencies?: boolean;
  ignorePatterns?: string[];
}
