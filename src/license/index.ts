/**
 * ReachVet - License Compliance Module
 * 
 * Provides license detection, compatibility checking, and policy enforcement
 * for dependencies based on SPDX license identifiers.
 */

import type { Component, AnalysisOutput } from '../types.js';

// ============================================================
// License Categories
// ============================================================

/** License categories based on permissions and restrictions */
export type LicenseCategory = 
  | 'permissive'      // MIT, BSD, Apache - minimal restrictions
  | 'weak-copyleft'   // LGPL, MPL - copyleft for modifications
  | 'strong-copyleft' // GPL, AGPL - copyleft for derivatives
  | 'proprietary'     // Commercial/proprietary licenses
  | 'public-domain'   // CC0, Unlicense - no restrictions
  | 'unknown';        // Could not determine

/** License information with SPDX details */
export interface LicenseInfo {
  id: string;              // SPDX identifier
  name: string;            // Full name
  category: LicenseCategory;
  osiApproved: boolean;    // OSI approved
  copyleft: boolean;       // Has copyleft clause
  patentGrant: boolean;    // Includes patent grant
  attribution: boolean;    // Requires attribution
  sameTerms: boolean;      // Requires same terms for derivatives
  networkCopyleft: boolean; // AGPL-style network copyleft
}

// ============================================================
// License Database (common SPDX licenses)
// ============================================================

const LICENSE_DB: Record<string, LicenseInfo> = {
  // Permissive
  'MIT': {
    id: 'MIT',
    name: 'MIT License',
    category: 'permissive',
    osiApproved: true,
    copyleft: false,
    patentGrant: false,
    attribution: true,
    sameTerms: false,
    networkCopyleft: false,
  },
  'ISC': {
    id: 'ISC',
    name: 'ISC License',
    category: 'permissive',
    osiApproved: true,
    copyleft: false,
    patentGrant: false,
    attribution: true,
    sameTerms: false,
    networkCopyleft: false,
  },
  'BSD-2-Clause': {
    id: 'BSD-2-Clause',
    name: 'BSD 2-Clause "Simplified" License',
    category: 'permissive',
    osiApproved: true,
    copyleft: false,
    patentGrant: false,
    attribution: true,
    sameTerms: false,
    networkCopyleft: false,
  },
  'BSD-3-Clause': {
    id: 'BSD-3-Clause',
    name: 'BSD 3-Clause "New" or "Revised" License',
    category: 'permissive',
    osiApproved: true,
    copyleft: false,
    patentGrant: false,
    attribution: true,
    sameTerms: false,
    networkCopyleft: false,
  },
  'Apache-2.0': {
    id: 'Apache-2.0',
    name: 'Apache License 2.0',
    category: 'permissive',
    osiApproved: true,
    copyleft: false,
    patentGrant: true,
    attribution: true,
    sameTerms: false,
    networkCopyleft: false,
  },
  'Zlib': {
    id: 'Zlib',
    name: 'zlib License',
    category: 'permissive',
    osiApproved: true,
    copyleft: false,
    patentGrant: false,
    attribution: false,
    sameTerms: false,
    networkCopyleft: false,
  },
  
  // Weak Copyleft
  'LGPL-2.1': {
    id: 'LGPL-2.1',
    name: 'GNU Lesser General Public License v2.1',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: false,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'LGPL-2.1-only': {
    id: 'LGPL-2.1-only',
    name: 'GNU Lesser General Public License v2.1 only',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: false,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'LGPL-2.1-or-later': {
    id: 'LGPL-2.1-or-later',
    name: 'GNU Lesser General Public License v2.1 or later',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: false,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'LGPL-3.0': {
    id: 'LGPL-3.0',
    name: 'GNU Lesser General Public License v3.0',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'LGPL-3.0-only': {
    id: 'LGPL-3.0-only',
    name: 'GNU Lesser General Public License v3.0 only',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'LGPL-3.0-or-later': {
    id: 'LGPL-3.0-or-later',
    name: 'GNU Lesser General Public License v3.0 or later',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'MPL-2.0': {
    id: 'MPL-2.0',
    name: 'Mozilla Public License 2.0',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'EPL-1.0': {
    id: 'EPL-1.0',
    name: 'Eclipse Public License 1.0',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'EPL-2.0': {
    id: 'EPL-2.0',
    name: 'Eclipse Public License 2.0',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'CDDL-1.0': {
    id: 'CDDL-1.0',
    name: 'Common Development and Distribution License 1.0',
    category: 'weak-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  
  // Strong Copyleft
  'GPL-2.0': {
    id: 'GPL-2.0',
    name: 'GNU General Public License v2.0',
    category: 'strong-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: false,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'GPL-2.0-only': {
    id: 'GPL-2.0-only',
    name: 'GNU General Public License v2.0 only',
    category: 'strong-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: false,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'GPL-2.0-or-later': {
    id: 'GPL-2.0-or-later',
    name: 'GNU General Public License v2.0 or later',
    category: 'strong-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: false,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'GPL-3.0': {
    id: 'GPL-3.0',
    name: 'GNU General Public License v3.0',
    category: 'strong-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'GPL-3.0-only': {
    id: 'GPL-3.0-only',
    name: 'GNU General Public License v3.0 only',
    category: 'strong-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'GPL-3.0-or-later': {
    id: 'GPL-3.0-or-later',
    name: 'GNU General Public License v3.0 or later',
    category: 'strong-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: false,
  },
  'AGPL-3.0': {
    id: 'AGPL-3.0',
    name: 'GNU Affero General Public License v3.0',
    category: 'strong-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: true,
  },
  'AGPL-3.0-only': {
    id: 'AGPL-3.0-only',
    name: 'GNU Affero General Public License v3.0 only',
    category: 'strong-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: true,
  },
  'AGPL-3.0-or-later': {
    id: 'AGPL-3.0-or-later',
    name: 'GNU Affero General Public License v3.0 or later',
    category: 'strong-copyleft',
    osiApproved: true,
    copyleft: true,
    patentGrant: true,
    attribution: true,
    sameTerms: true,
    networkCopyleft: true,
  },
  
  // Public Domain
  'CC0-1.0': {
    id: 'CC0-1.0',
    name: 'Creative Commons Zero v1.0 Universal',
    category: 'public-domain',
    osiApproved: false,
    copyleft: false,
    patentGrant: false,
    attribution: false,
    sameTerms: false,
    networkCopyleft: false,
  },
  'Unlicense': {
    id: 'Unlicense',
    name: 'The Unlicense',
    category: 'public-domain',
    osiApproved: true,
    copyleft: false,
    patentGrant: false,
    attribution: false,
    sameTerms: false,
    networkCopyleft: false,
  },
  'WTFPL': {
    id: 'WTFPL',
    name: 'Do What The F*ck You Want To Public License',
    category: 'public-domain',
    osiApproved: false,
    copyleft: false,
    patentGrant: false,
    attribution: false,
    sameTerms: false,
    networkCopyleft: false,
  },
  '0BSD': {
    id: '0BSD',
    name: 'BSD Zero Clause License',
    category: 'public-domain',
    osiApproved: true,
    copyleft: false,
    patentGrant: false,
    attribution: false,
    sameTerms: false,
    networkCopyleft: false,
  },
};

// License aliases (common variations)
const LICENSE_ALIASES: Record<string, string> = {
  'MIT/X11': 'MIT',
  'X11': 'MIT',
  'Expat': 'MIT',
  'BSD': 'BSD-3-Clause',
  'BSD-2': 'BSD-2-Clause',
  'BSD-3': 'BSD-3-Clause',
  'Apache 2.0': 'Apache-2.0',
  'Apache-2': 'Apache-2.0',
  'Apache': 'Apache-2.0',
  'GPL2': 'GPL-2.0',
  'GPL-2': 'GPL-2.0',
  'GPLv2': 'GPL-2.0',
  'GPL v2': 'GPL-2.0',
  'GPL3': 'GPL-3.0',
  'GPL-3': 'GPL-3.0',
  'GPLv3': 'GPL-3.0',
  'GPL v3': 'GPL-3.0',
  'LGPL2': 'LGPL-2.1',
  'LGPL-2': 'LGPL-2.1',
  'LGPLv2': 'LGPL-2.1',
  'LGPL v2': 'LGPL-2.1',
  'LGPL2.1': 'LGPL-2.1',
  'LGPL3': 'LGPL-3.0',
  'LGPL-3': 'LGPL-3.0',
  'LGPLv3': 'LGPL-3.0',
  'LGPL v3': 'LGPL-3.0',
  'AGPL': 'AGPL-3.0',
  'AGPL3': 'AGPL-3.0',
  'AGPLv3': 'AGPL-3.0',
  'MPL': 'MPL-2.0',
  'MPL 2.0': 'MPL-2.0',
  'Mozilla': 'MPL-2.0',
  'EPL': 'EPL-2.0',
  'Eclipse': 'EPL-2.0',
  'CC0': 'CC0-1.0',
  'Public Domain': 'Unlicense',
};

// ============================================================
// Policy Types
// ============================================================

/** License policy rule */
export interface PolicyRule {
  /** Rule type */
  type: 'allow' | 'deny' | 'warn';
  /** SPDX license IDs (supports wildcards) */
  licenses?: string[];
  /** License categories */
  categories?: LicenseCategory[];
  /** Reason for the rule */
  reason?: string;
}

/** License policy configuration */
export interface LicensePolicy {
  /** Policy name */
  name: string;
  /** Default action for unlisted licenses */
  defaultAction: 'allow' | 'deny' | 'warn';
  /** Policy rules (evaluated in order) */
  rules: PolicyRule[];
}

/** Policy violation */
export interface PolicyViolation {
  component: string;
  version: string;
  license: string;
  rule: PolicyRule;
  severity: 'error' | 'warning';
}

/** License check result for a component */
export interface LicenseCheckResult {
  component: Component;
  license: string | undefined;
  licenseInfo: LicenseInfo | null;
  violation: PolicyViolation | null;
  status: 'pass' | 'warn' | 'fail' | 'unknown';
}

/** Overall license compliance report */
export interface LicenseComplianceReport {
  timestamp: string;
  policy: string;
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failures: number;
    unknown: number;
  };
  byCategory: Record<LicenseCategory, number>;
  results: LicenseCheckResult[];
  violations: PolicyViolation[];
}

// ============================================================
// Predefined Policies
// ============================================================

/** Permissive-only policy (no copyleft) */
export const PERMISSIVE_POLICY: LicensePolicy = {
  name: 'permissive-only',
  defaultAction: 'deny',
  rules: [
    {
      type: 'allow',
      categories: ['permissive', 'public-domain'],
      reason: 'Permissive and public domain licenses are allowed',
    },
    {
      type: 'deny',
      categories: ['weak-copyleft', 'strong-copyleft'],
      reason: 'Copyleft licenses are not allowed',
    },
  ],
};

/** OSI-approved policy */
export const OSI_APPROVED_POLICY: LicensePolicy = {
  name: 'osi-approved',
  defaultAction: 'warn',
  rules: [
    {
      type: 'allow',
      licenses: Object.entries(LICENSE_DB)
        .filter(([_, info]) => info.osiApproved)
        .map(([id]) => id),
      reason: 'OSI-approved licenses are allowed',
    },
  ],
};

/** No AGPL policy (common for SaaS) */
export const NO_AGPL_POLICY: LicensePolicy = {
  name: 'no-agpl',
  defaultAction: 'allow',
  rules: [
    {
      type: 'deny',
      licenses: ['AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later'],
      reason: 'AGPL licenses require source disclosure for network use',
    },
  ],
};

/** Copyleft-aware policy (warn on copyleft) */
export const COPYLEFT_AWARE_POLICY: LicensePolicy = {
  name: 'copyleft-aware',
  defaultAction: 'allow',
  rules: [
    {
      type: 'deny',
      categories: ['strong-copyleft'],
      reason: 'Strong copyleft licenses require same terms for derivatives',
    },
    {
      type: 'warn',
      categories: ['weak-copyleft'],
      reason: 'Weak copyleft licenses require same terms for modifications',
    },
  ],
};

// ============================================================
// License Functions
// ============================================================

/**
 * Normalize license identifier to SPDX format
 */
export function normalizeLicense(license: string): string {
  const trimmed = license.trim();
  
  // Check aliases first
  const aliased = LICENSE_ALIASES[trimmed];
  if (aliased) return aliased;
  
  // Try case-insensitive match
  const upper = trimmed.toUpperCase();
  for (const [alias, spdx] of Object.entries(LICENSE_ALIASES)) {
    if (alias.toUpperCase() === upper) return spdx;
  }
  
  // Check if it's already a valid SPDX ID
  if (LICENSE_DB[trimmed]) return trimmed;
  
  // Try case-insensitive SPDX match
  for (const id of Object.keys(LICENSE_DB)) {
    if (id.toUpperCase() === upper) return id;
  }
  
  return trimmed;
}

/**
 * Get license information by SPDX identifier
 */
export function getLicenseInfo(license: string): LicenseInfo | null {
  const normalized = normalizeLicense(license);
  return LICENSE_DB[normalized] ?? null;
}

/**
 * Get license category
 */
export function getLicenseCategory(license: string): LicenseCategory {
  const info = getLicenseInfo(license);
  return info?.category ?? 'unknown';
}

/**
 * Check if license is compatible with another
 * 
 * Compatibility is determined by whether code under licenseA
 * can be combined with code under licenseB.
 */
export function isCompatible(licenseA: string, licenseB: string): boolean {
  const infoA = getLicenseInfo(licenseA);
  const infoB = getLicenseInfo(licenseB);
  
  if (!infoA || !infoB) return true; // Unknown = assume compatible
  
  // Public domain is compatible with everything
  if (infoA.category === 'public-domain' || infoB.category === 'public-domain') {
    return true;
  }
  
  // Permissive is compatible with everything
  if (infoA.category === 'permissive' && infoB.category === 'permissive') {
    return true;
  }
  
  // Strong copyleft requires everything to be under same terms
  if (infoA.category === 'strong-copyleft') {
    // GPL is only compatible with GPL-compatible licenses
    return infoB.category !== 'strong-copyleft' || infoA.id === infoB.id;
  }
  
  if (infoB.category === 'strong-copyleft') {
    // At this point infoA is not public-domain (checked above) or strong-copyleft
    // Only permissive is compatible
    return infoA.category === 'permissive';
  }
  
  // Weak copyleft + permissive = OK
  return true;
}

/**
 * Check component against a policy rule
 */
function checkRule(license: string, info: LicenseInfo | null, rule: PolicyRule): boolean {
  // Check specific licenses
  if (rule.licenses) {
    const normalized = normalizeLicense(license);
    if (rule.licenses.some(l => {
      if (l.endsWith('*')) {
        return normalized.startsWith(l.slice(0, -1));
      }
      return normalizeLicense(l) === normalized;
    })) {
      return true;
    }
  }
  
  // Check categories
  if (rule.categories && info) {
    if (rule.categories.includes(info.category)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check a single component against a policy
 */
export function checkComponent(component: Component, policy: LicensePolicy): LicenseCheckResult {
  const license = component.license;
  
  // No license specified
  if (!license) {
    return {
      component,
      license: undefined,
      licenseInfo: null,
      violation: null,
      status: 'unknown',
    };
  }
  
  const normalized = normalizeLicense(license);
  const info = getLicenseInfo(normalized);
  
  // Check rules in order
  for (const rule of policy.rules) {
    if (checkRule(normalized, info, rule)) {
      if (rule.type === 'allow') {
        return {
          component,
          license: normalized,
          licenseInfo: info,
          violation: null,
          status: 'pass',
        };
      } else if (rule.type === 'warn') {
        return {
          component,
          license: normalized,
          licenseInfo: info,
          violation: {
            component: component.name,
            version: component.version,
            license: normalized,
            rule,
            severity: 'warning',
          },
          status: 'warn',
        };
      } else { // deny
        return {
          component,
          license: normalized,
          licenseInfo: info,
          violation: {
            component: component.name,
            version: component.version,
            license: normalized,
            rule,
            severity: 'error',
          },
          status: 'fail',
        };
      }
    }
  }
  
  // Apply default action
  if (policy.defaultAction === 'allow') {
    return {
      component,
      license: normalized,
      licenseInfo: info,
      violation: null,
      status: 'pass',
    };
  } else if (policy.defaultAction === 'warn') {
    return {
      component,
      license: normalized,
      licenseInfo: info,
      violation: {
        component: component.name,
        version: component.version,
        license: normalized,
        rule: { type: 'warn', reason: 'License not explicitly allowed' },
        severity: 'warning',
      },
      status: 'warn',
    };
  } else {
    return {
      component,
      license: normalized,
      licenseInfo: info,
      violation: {
        component: component.name,
        version: component.version,
        license: normalized,
        rule: { type: 'deny', reason: 'License not explicitly allowed' },
        severity: 'error',
      },
      status: 'fail',
    };
  }
}

/**
 * Check all components in analysis output against a policy
 */
export function checkLicenseCompliance(
  output: AnalysisOutput,
  policy: LicensePolicy = COPYLEFT_AWARE_POLICY
): LicenseComplianceReport {
  const results: LicenseCheckResult[] = [];
  const violations: PolicyViolation[] = [];
  const byCategory: Record<LicenseCategory, number> = {
    'permissive': 0,
    'weak-copyleft': 0,
    'strong-copyleft': 0,
    'proprietary': 0,
    'public-domain': 0,
    'unknown': 0,
  };
  
  let passed = 0;
  let warnings = 0;
  let failures = 0;
  let unknown = 0;
  
  for (const result of output.results) {
    const checkResult = checkComponent(result.component, policy);
    results.push(checkResult);
    
    // Count by category
    const category = checkResult.licenseInfo?.category ?? 'unknown';
    byCategory[category]++;
    
    // Count by status
    switch (checkResult.status) {
      case 'pass':
        passed++;
        break;
      case 'warn':
        warnings++;
        if (checkResult.violation) violations.push(checkResult.violation);
        break;
      case 'fail':
        failures++;
        if (checkResult.violation) violations.push(checkResult.violation);
        break;
      case 'unknown':
        unknown++;
        break;
    }
  }
  
  return {
    timestamp: new Date().toISOString(),
    policy: policy.name,
    summary: {
      total: output.results.length,
      passed,
      warnings,
      failures,
      unknown,
    },
    byCategory,
    results,
    violations,
  };
}

/**
 * Generate license attribution notice
 */
export function generateAttribution(output: AnalysisOutput): string {
  const lines: string[] = [
    '# Third-Party License Attribution',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Dependencies',
    '',
  ];
  
  // Group by license
  const byLicense = new Map<string, Array<{ name: string; version: string }>>();
  
  for (const result of output.results) {
    const license = result.component.license || 'Unknown';
    const normalized = normalizeLicense(license);
    
    if (!byLicense.has(normalized)) {
      byLicense.set(normalized, []);
    }
    byLicense.get(normalized)!.push({
      name: result.component.name,
      version: result.component.version,
    });
  }
  
  // Sort licenses alphabetically
  const sortedLicenses = Array.from(byLicense.keys()).sort();
  
  for (const license of sortedLicenses) {
    const components = byLicense.get(license)!;
    const info = getLicenseInfo(license);
    
    lines.push(`### ${info?.name || license}`);
    lines.push('');
    lines.push(`SPDX ID: ${license}`);
    if (info) {
      lines.push(`Category: ${info.category}`);
      lines.push(`OSI Approved: ${info.osiApproved ? 'Yes' : 'No'}`);
    }
    lines.push('');
    lines.push('**Packages:**');
    for (const comp of components.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- ${comp.name}@${comp.version}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Get all known SPDX license IDs
 */
export function getKnownLicenses(): string[] {
  return Object.keys(LICENSE_DB);
}

/**
 * Get all license categories
 */
export function getLicenseCategories(): LicenseCategory[] {
  return ['permissive', 'weak-copyleft', 'strong-copyleft', 'proprietary', 'public-domain', 'unknown'];
}

/**
 * Create a custom policy
 */
export function createPolicy(
  name: string,
  defaultAction: 'allow' | 'deny' | 'warn',
  rules: PolicyRule[]
): LicensePolicy {
  return { name, defaultAction, rules };
}

// ============================================================
// Exports
// ============================================================

export const PREDEFINED_POLICIES = {
  permissive: PERMISSIVE_POLICY,
  osiApproved: OSI_APPROVED_POLICY,
  noAgpl: NO_AGPL_POLICY,
  copyleftAware: COPYLEFT_AWARE_POLICY,
};
