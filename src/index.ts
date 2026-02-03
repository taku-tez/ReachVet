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
