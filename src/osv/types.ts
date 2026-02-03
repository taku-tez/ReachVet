/**
 * OSV API Type Definitions
 * https://osv.dev/docs/
 */

// ============================================================
// OSV Query Types
// ============================================================

export interface OSVQuery {
  package?: {
    name: string;
    ecosystem: string;
  };
  version?: string;
  commit?: string;
}

export interface OSVBatchQuery {
  queries: OSVQuery[];
}

// ============================================================
// OSV Response Types
// ============================================================

export interface OSVVulnerability {
  id: string;                    // GHSA-xxxx, CVE-xxxx
  summary?: string;
  details?: string;
  modified: string;
  published?: string;
  withdrawn?: string;
  aliases?: string[];            // Other IDs (e.g., CVE from GHSA)
  related?: string[];
  severity?: OSVSeverity[];
  affected?: OSVAffected[];
  references?: OSVReference[];
  credits?: OSVCredit[];
  database_specific?: Record<string, unknown>;
}

export interface OSVSeverity {
  type: 'CVSS_V2' | 'CVSS_V3' | 'CVSS_V4';
  score: string;                 // CVSS vector string
}

export interface OSVAffected {
  package?: {
    ecosystem: string;
    name: string;
    purl?: string;
  };
  ranges?: OSVRange[];
  versions?: string[];
  ecosystem_specific?: OSVEcosystemSpecific;
  database_specific?: Record<string, unknown>;
}

export interface OSVRange {
  type: 'SEMVER' | 'ECOSYSTEM' | 'GIT';
  repo?: string;
  events: OSVRangeEvent[];
}

export interface OSVRangeEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
  limit?: string;
}

/**
 * Ecosystem-specific data - contains vulnerable functions!
 * This is the key field for ReachVet
 */
export interface OSVEcosystemSpecific {
  imports?: OSVImport[];         // Vulnerable modules/functions
  severity?: string;
  [key: string]: unknown;
}

/**
 * Import-level vulnerability info
 */
export interface OSVImport {
  path?: string;                 // Module path (e.g., 'lodash/template')
  symbols?: string[];            // Vulnerable functions (e.g., ['template'])
}

export interface OSVReference {
  type: 'ADVISORY' | 'ARTICLE' | 'REPORT' | 'FIX' | 'PACKAGE' | 'EVIDENCE' | 'WEB';
  url: string;
}

export interface OSVCredit {
  name: string;
  contact?: string[];
  type?: string;
}

// ============================================================
// Query Response Types
// ============================================================

export interface OSVQueryResponse {
  vulns?: OSVVulnerability[];
  next_page_token?: string;
}

export interface OSVBatchResponse {
  results: OSVQueryResponse[];
}

// ============================================================
// ReachVet Integration Types
// ============================================================

export interface VulnerableFunctionInfo {
  vulnId: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  functions: string[];           // Vulnerable function names
  paths: string[];               // Vulnerable module paths
  fixedVersion?: string;
  description?: string;
}

export interface PackageVulnerabilityInfo {
  packageName: string;
  ecosystem: string;
  version: string;
  vulnerabilities: VulnerableFunctionInfo[];
}

// ============================================================
// Cache Types
// ============================================================

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface OSVCacheOptions {
  enabled: boolean;
  directory: string;
  ttlSeconds: number;            // Default: 3600 (1 hour)
}
