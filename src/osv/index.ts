/**
 * OSV API Module
 * Provides vulnerability lookup and vulnerable function extraction
 */

export { OSVClient } from './client.js';
export type { OSVClientOptions } from './client.js';

export { OSVCache } from './cache.js';

export type {
  // Query types
  OSVQuery,
  OSVBatchQuery,
  
  // Response types
  OSVQueryResponse,
  OSVBatchResponse,
  OSVVulnerability,
  OSVSeverity,
  OSVAffected,
  OSVRange,
  OSVRangeEvent,
  OSVEcosystemSpecific,
  OSVImport,
  OSVReference,
  OSVCredit,
  
  // ReachVet integration types
  VulnerableFunctionInfo,
  PackageVulnerabilityInfo,
  
  // Cache types
  CacheEntry,
  OSVCacheOptions,
} from './types.js';
