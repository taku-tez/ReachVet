/**
 * ReachVet - Supply Chain Reachability Analyzer
 * 
 * @example
 * ```typescript
 * import { Analyzer, quickAnalyze } from 'reachvet';
 * import { parseSimpleJson } from 'reachvet/input';
 * 
 * // Quick analyze
 * const components = await parseSimpleJson('components.json');
 * const results = await quickAnalyze('./src', components);
 * 
 * // With options
 * const analyzer = new Analyzer({ sourceDir: './src' });
 * const output = await analyzer.analyze(components);
 * ```
 */

// Core
export { Analyzer, quickAnalyze } from './core/analyzer.js';

// Input parsers
export {
  parseSimpleJson,
  parseSimpleJsonString,
  parseFromStdin,
  parseSBOM,
  parseSBOMString,
  parseCycloneDX,
  parseSPDX
} from './input/index.js';

// Language adapters
export {
  getAdapter,
  getAllAdapters,
  detectLanguage,
  listSupportedLanguages,
  BaseLanguageAdapter
} from './languages/index.js';

// Types
export type {
  Component,
  ComponentVulnerability,
  ComponentResult,
  AnalysisOutput,
  AnalysisSummary,
  AnalyzeOptions,
  SupportedLanguage,
  ReachabilityStatus,
  UsageInfo,
  CodeLocation,
  LanguageAdapter,
  ReachVetInput
} from './types.js';

// Watch mode
export {
  Watcher,
  startWatch,
  type WatchOptions
} from './watch/index.js';

// Incremental cache
export {
  AnalysisCache,
  getGlobalCache,
  resetGlobalCache,
  type CachedParseResult,
  type CacheOptions
} from './cache/index.js';

// Configuration
export {
  loadConfig,
  loadConfigFromFile,
  loadConfigFromPackageJson,
  mergeConfig,
  validateConfig,
  generateSampleConfig,
  findConfigPath,
  type ReachVetConfig
} from './config/index.js';

// API Server
export {
  ReachVetServer,
  startServer,
  type ServerConfig,
  type ApiRequest,
  type ApiResponse
} from './server/index.js';

// Output formatters
export {
  toSarif,
  toJUnitXml,
  toJUnitXmlMultiple,
  toCycloneDX,
  toSPDX,
  generateVEXStatements,
  generateGraph,
  type SarifOutput,
  type JUnitOptions,
  type SBOMOptions,
  type CycloneDXBom,
  type SPDXDocument,
  type VEXStatement,
  type GraphOptions
} from './output/index.js';

// License compliance
export {
  normalizeLicense,
  getLicenseInfo,
  getLicenseCategory,
  isCompatible,
  checkComponent,
  checkLicenseCompliance,
  generateAttribution,
  getKnownLicenses,
  getLicenseCategories,
  createPolicy,
  PREDEFINED_POLICIES,
  PERMISSIVE_POLICY,
  OSI_APPROVED_POLICY,
  NO_AGPL_POLICY,
  COPYLEFT_AWARE_POLICY,
  type LicenseInfo,
  type LicenseCategory,
  type LicensePolicy,
  type PolicyRule,
  type PolicyViolation,
  type LicenseCheckResult,
  type LicenseComplianceReport
} from './license/index.js';
