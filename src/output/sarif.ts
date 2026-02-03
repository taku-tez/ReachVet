/**
 * ReachVet - SARIF Output Formatter
 * 
 * Generates SARIF 2.1.0 format for GitHub Code Scanning integration.
 * See: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */

import type { AnalysisOutput, ComponentResult, AnalysisWarning, CodeLocation } from '../types.js';

const SARIF_VERSION = '2.1.0';
const SARIF_SCHEMA = 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';
const TOOL_NAME = 'ReachVet';

// ============================================================
// SARIF Types (subset for our needs)
// ============================================================

interface SarifRun {
  tool: SarifTool;
  results: SarifResult[];
  invocations: SarifInvocation[];
}

interface SarifTool {
  driver: SarifToolDriver;
}

interface SarifToolDriver {
  name: string;
  version: string;
  informationUri: string;
  rules: SarifRule[];
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri?: string;
  help?: { text: string; markdown?: string };
  defaultConfiguration: {
    level: 'error' | 'warning' | 'note' | 'none';
  };
  properties?: {
    tags?: string[];
    'security-severity'?: string;
  };
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note' | 'none';
  message: { text: string };
  locations?: SarifLocation[];
  relatedLocations?: SarifLocation[];
  fingerprints?: Record<string, string>;
  properties?: Record<string, unknown>;
}

interface SarifLocation {
  physicalLocation?: {
    artifactLocation: {
      uri: string;
      uriBaseId?: string;
    };
    region?: {
      startLine: number;
      startColumn?: number;
      endLine?: number;
      endColumn?: number;
      snippet?: { text: string };
    };
  };
  message?: { text: string };
}

interface SarifInvocation {
  executionSuccessful: boolean;
  commandLine?: string;
  startTimeUtc?: string;
  endTimeUtc?: string;
  workingDirectory?: { uri: string };
}

interface SarifOutput {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

// ============================================================
// Rule IDs
// ============================================================

const RULES: Record<string, {
  id: string;
  name: string;
  shortDescription: string;
  level: 'error' | 'warning' | 'note' | 'none';
  severity?: string;
  tags: string[];
}> = {
  REACHABLE_VULNERABLE: {
    id: 'RV001',
    name: 'VulnerableReachable',
    shortDescription: 'Vulnerable dependency is reachable in code',
    level: 'error',
    severity: '9.0', // Critical
    tags: ['security', 'supply-chain', 'vulnerability'],
  },
  REACHABLE: {
    id: 'RV002',
    name: 'DependencyReachable',
    shortDescription: 'Dependency is actively used in code',
    level: 'note',
    tags: ['supply-chain', 'dependency'],
  },
  IMPORTED: {
    id: 'RV003',
    name: 'DependencyImported',
    shortDescription: 'Dependency is imported but usage is unclear',
    level: 'note',
    tags: ['supply-chain', 'dependency'],
  },
  DYNAMIC_IMPORT: {
    id: 'RV101',
    name: 'DynamicImportDetected',
    shortDescription: 'Dynamic import detected - static analysis limited',
    level: 'warning',
    tags: ['analysis-limitation'],
  },
  NAMESPACE_IMPORT: {
    id: 'RV102',
    name: 'NamespaceImportDetected',
    shortDescription: 'Namespace import makes usage tracking difficult',
    level: 'note',
    tags: ['analysis-limitation'],
  },
  STAR_IMPORT: {
    id: 'RV103',
    name: 'StarImportDetected',
    shortDescription: 'Star import - all exports imported',
    level: 'note',
    tags: ['analysis-limitation'],
  },
};

// ============================================================
// Converter
// ============================================================

/**
 * Convert ReachVet output to SARIF format
 */
export function toSarif(output: AnalysisOutput): SarifOutput {
  const rules = generateRules();
  const results = generateResults(output);

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: output.version,
            informationUri: 'https://github.com/taku-tez/reachvet',
            rules,
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: true,
            startTimeUtc: output.timestamp,
            workingDirectory: { uri: `file://${output.sourceDir}` },
          },
        ],
      },
    ],
  };
}

/**
 * Generate rule definitions
 */
function generateRules(): SarifRule[] {
  return Object.values(RULES).map((rule) => ({
    id: rule.id,
    name: rule.name,
    shortDescription: { text: rule.shortDescription },
    defaultConfiguration: { level: rule.level },
    properties: {
      tags: rule.tags,
      ...(rule.severity ? { 'security-severity': rule.severity } : {}),
    },
  }));
}

/**
 * Generate SARIF results from analysis output
 */
function generateResults(output: AnalysisOutput): SarifResult[] {
  const results: SarifResult[] = [];

  for (const componentResult of output.results) {
    // Add main result for the component
    const mainResult = componentResultToSarif(componentResult);
    if (mainResult) {
      results.push(mainResult);
    }

    // Add warning results
    if (componentResult.warnings) {
      for (const warning of componentResult.warnings) {
        const warningResult = warningToSarif(componentResult, warning);
        if (warningResult) {
          results.push(warningResult);
        }
      }
    }
  }

  return results;
}

/**
 * Convert a component result to SARIF result
 */
function componentResultToSarif(result: ComponentResult): SarifResult | null {
  const { component, status, usage } = result;
  const hasVuln = component.vulnerabilities && component.vulnerabilities.length > 0;

  // Only report reachable or imported with vulnerabilities
  if (status === 'not_reachable' || status === 'unknown') {
    // Still report if vulnerable (informational)
    if (!hasVuln) {
      return null;
    }
  }

  let ruleId: string;
  let level: 'error' | 'warning' | 'note';
  let message: string;

  if (status === 'reachable' && hasVuln) {
    ruleId = RULES.REACHABLE_VULNERABLE.id;
    level = 'error';
    const vulnIds = component.vulnerabilities!.map((v) => v.id).join(', ');
    message = `Vulnerable dependency ${component.name}@${component.version} is reachable: ${vulnIds}`;
  } else if (status === 'reachable') {
    ruleId = RULES.REACHABLE.id;
    level = 'note';
    const used = usage?.usedMembers?.join(', ') || 'module';
    message = `Dependency ${component.name}@${component.version} is reachable (uses: ${used})`;
  } else if (status === 'imported') {
    ruleId = RULES.IMPORTED.id;
    level = 'note';
    message = `Dependency ${component.name}@${component.version} is imported but specific usage is unclear`;
  } else {
    return null;
  }

  // Build locations from usage
  const locations: SarifLocation[] = [];
  if (usage?.locations) {
    for (const loc of usage.locations) {
      locations.push(codeLocationToSarif(loc));
    }
  }

  return {
    ruleId,
    level,
    message: { text: message },
    locations: locations.length > 0 ? locations : undefined,
    fingerprints: {
      'reachvet/component': `${component.name}@${component.version}`,
    },
    properties: {
      component: component.name,
      version: component.version,
      status,
      ...(hasVuln ? { vulnerabilities: component.vulnerabilities } : {}),
    },
  };
}

/**
 * Convert a warning to SARIF result
 */
function warningToSarif(result: ComponentResult, warning: AnalysisWarning): SarifResult | null {
  let ruleId: string;
  let level: 'warning' | 'note';

  switch (warning.code) {
    case 'dynamic_import':
      ruleId = RULES.DYNAMIC_IMPORT.id;
      level = 'warning';
      break;
    case 'namespace_import':
      ruleId = RULES.NAMESPACE_IMPORT.id;
      level = 'note';
      break;
    case 'star_import':
      ruleId = RULES.STAR_IMPORT.id;
      level = 'note';
      break;
    default:
      // Skip other warnings in SARIF
      return null;
  }

  const locations: SarifLocation[] = [];
  if (warning.location) {
    locations.push(codeLocationToSarif(warning.location));
  }

  return {
    ruleId,
    level,
    message: { text: `${result.component.name}: ${warning.message}` },
    locations: locations.length > 0 ? locations : undefined,
    fingerprints: {
      'reachvet/warning': `${result.component.name}:${warning.code}`,
    },
  };
}

/**
 * Convert CodeLocation to SARIF Location
 */
function codeLocationToSarif(loc: CodeLocation): SarifLocation {
  return {
    physicalLocation: {
      artifactLocation: {
        uri: loc.file,
        uriBaseId: '%SRCROOT%',
      },
      region: {
        startLine: loc.line,
        startColumn: loc.column,
        ...(loc.snippet ? { snippet: { text: loc.snippet } } : {}),
      },
    },
  };
}

// ============================================================
// Exports
// ============================================================

export { SarifOutput, SarifResult, SarifRule };
