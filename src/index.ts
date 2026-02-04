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
  // JSON Schema
  generateConfigSchema,
  formatSchema,
  generateSchemaFile,
  generateConfigWithSchema,
  SUPPORTED_LANGUAGES,
  OUTPUT_FORMATS,
  FAIL_ON_OPTIONS,
  type ReachVetConfig,
  type JSONSchemaType
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

// Shell completions
export {
  generateCompletions,
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
  getSupportedShells,
  getInstallInstructions,
  type ShellType
} from './completions/index.js';

// Ignore file support
export {
  loadIgnoreConfig,
  shouldIgnore,
  filterIgnored,
  getIgnoreStats,
  createEmptyConfig,
  addPatterns,
  mergeConfigs,
  parseIgnoreFile,
  parseIgnoreLine,
  generateSampleIgnoreFile,
  DEFAULT_IGNORE_FILES,
  type IgnoreConfig,
  type IgnorePattern
} from './ignore/index.js';

// Dependency freshness check
export {
  checkFreshness,
  formatFreshnessResult,
  formatFreshnessReport,
  toFreshnessJson,
  parseVersion,
  compareVersions,
  calculateVersionsBehind,
  determineSeverity,
  DEFAULT_REGISTRIES,
  type VersionInfo,
  type FreshnessResult,
  type FreshnessReport,
  type FreshnessOptions
} from './freshness/index.js';

// EPSS (Exploit Prediction Scoring System) integration
export {
  EPSSClient,
  EPSSCache,
  calculatePriority,
  priorityFromEPSS,
  extractCVEs,
  createEPSSReport,
  formatEPSSReport,
  toEPSSJson,
  queryEPSSWithCache,
  getEPSSClient,
  getEPSSCache,
  type EPSSScore,
  type EPSSBatchResult,
  type EPSSCacheOptions,
  type PriorityScore,
  type EPSSQueryOptions,
  type EPSSReport
} from './epss/index.js';

// KEV (Known Exploited Vulnerabilities) integration
export {
  KEVClient,
  KEVCache,
  getKEVClient,
  getKEVCache,
  fetchKEVWithCache,
  createKEVReport,
  formatKEVReport,
  toKEVJson,
  calculateKEVPriority,
  extractCVEsFromText,
  KEV_CATALOG_URL,
  type KEVEntry,
  type KEVCatalog,
  type KEVLookupResult,
  type KEVReportEntry,
  type KEVReport,
  type KEVPriorityScore
} from './kev/index.js';

// Monorepo detection and multi-project analysis
export {
  detectMonorepo,
  discoverProjects,
  analyzeMonorepo,
  formatMonorepoReport,
  toMonorepoJson,
  formatMonorepoMarkdown,
  type MonorepoType,
  type MonorepoInfo,
  type ProjectInfo,
  type MonorepoAnalysisOptions,
  type ProjectAnalysisResult,
  type MonorepoAnalysisResult,
  type MonorepoSummary,
  type SharedDependency,
  type VulnerabilitySummary
} from './monorepo/index.js';

// Vulnerability fix suggestions
export {
  suggestFixes,
  generateFixSuggestion,
  formatFixReport,
  toFixJson,
  generateFixScript,
  extractFixedVersion,
  getHighestFixedVersion,
  parseVersion as parseFixVersion,
  compareVersions as compareFixVersions,
  getVersionBumpType,
  calculateRisk,
  type VulnerablePackage,
  type FixSuggestion,
  type VulnerabilityFix,
  type FixReport,
  type UnfixablePackage,
  type FixOptions
} from './fixes/index.js';
