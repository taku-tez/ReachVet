/**
 * ReachVet - SBOM Output Generator
 * 
 * Generates CycloneDX 1.5 and SPDX 2.3 format SBOMs from analysis results.
 * Includes reachability metadata as extensions/annotations.
 */

import type { AnalysisOutput, ComponentResult, ComponentVulnerability, ReachabilityStatus } from '../types.js';

// ============================================================
// CycloneDX Types (1.5)
// ============================================================

interface CycloneDXMetadata {
  timestamp: string;
  tools?: CycloneDXTool[];
  component?: CycloneDXComponent;
  properties?: CycloneDXProperty[];
}

interface CycloneDXTool {
  vendor?: string;
  name: string;
  version: string;
}

interface CycloneDXProperty {
  name: string;
  value: string;
}

interface CycloneDXComponent {
  type: 'library' | 'application' | 'framework' | 'file' | 'device' | 'firmware';
  'bom-ref'?: string;
  name: string;
  version: string;
  purl?: string;
  licenses?: CycloneDXLicense[];
  properties?: CycloneDXProperty[];
  evidence?: CycloneDXEvidence;
}

interface CycloneDXLicense {
  license?: {
    id?: string;
    name?: string;
  };
}

interface CycloneDXEvidence {
  occurrences?: CycloneDXOccurrence[];
  callstack?: CycloneDXCallstack;
}

interface CycloneDXOccurrence {
  location: string;
  line?: number;
  offset?: number;
  symbol?: string;
}

interface CycloneDXCallstack {
  frames: CycloneDXFrame[];
}

interface CycloneDXFrame {
  package?: string;
  module?: string;
  function?: string;
  line?: number;
  column?: number;
  fullFilename?: string;
}

interface CycloneDXVulnerability {
  id: string;
  source?: { name: string; url?: string };
  ratings?: Array<{ severity: string; method?: string }>;
  description?: string;
  affects: Array<{ ref: string }>;
  properties?: CycloneDXProperty[];
}

interface CycloneDXBom {
  $schema: string;
  bomFormat: 'CycloneDX';
  specVersion: '1.5';
  serialNumber: string;
  version: number;
  metadata: CycloneDXMetadata;
  components: CycloneDXComponent[];
  vulnerabilities?: CycloneDXVulnerability[];
}

// ============================================================
// SPDX Types (2.3)
// ============================================================

interface SPDXCreationInfo {
  created: string;
  creators: string[];
  licenseListVersion?: string;
  comment?: string;
}

interface SPDXExternalRef {
  referenceCategory: 'SECURITY' | 'PACKAGE-MANAGER' | 'PERSISTENT-ID' | 'OTHER';
  referenceType: string;
  referenceLocator: string;
  comment?: string;
}

interface SPDXAnnotation {
  annotationDate: string;
  annotationType: 'REVIEW' | 'OTHER';
  annotator: string;
  comment: string;
}

interface SPDXPackage {
  SPDXID: string;
  name: string;
  versionInfo: string;
  downloadLocation: string;
  filesAnalyzed: boolean;
  licenseConcluded?: string;
  licenseDeclared?: string;
  copyrightText?: string;
  externalRefs?: SPDXExternalRef[];
  annotations?: SPDXAnnotation[];
  comment?: string;
}

interface SPDXRelationship {
  spdxElementId: string;
  relatedSpdxElement: string;
  relationshipType: 'DEPENDS_ON' | 'DEPENDENCY_OF' | 'CONTAINS' | 'DESCRIBED_BY' | 'DESCRIBES' | 'GENERATES' | 'OTHER';
  comment?: string;
}

interface SPDXDocument {
  spdxVersion: 'SPDX-2.3';
  dataLicense: 'CC0-1.0';
  SPDXID: 'SPDXRef-DOCUMENT';
  name: string;
  documentNamespace: string;
  creationInfo: SPDXCreationInfo;
  packages: SPDXPackage[];
  relationships: SPDXRelationship[];
}

// ============================================================
// Options
// ============================================================

export interface SBOMOptions {
  /** Include components that are not reachable */
  includeUnreachable?: boolean;
  /** Include detailed usage locations */
  includeOccurrences?: boolean;
  /** Application name for metadata */
  appName?: string;
  /** Application version for metadata */
  appVersion?: string;
  /** Namespace for SPDX document */
  namespace?: string;
}

// ============================================================
// CycloneDX Generator
// ============================================================

/**
 * Generate CycloneDX 1.5 SBOM from analysis output
 */
export function toCycloneDX(output: AnalysisOutput, options: SBOMOptions = {}): CycloneDXBom {
  const {
    includeUnreachable = false,
    includeOccurrences = true,
    appName = 'analyzed-application',
    appVersion = '1.0.0',
  } = options;

  // Filter results based on options
  const results = includeUnreachable
    ? output.results
    : output.results.filter(r => r.status !== 'not_reachable');

  // Generate serial number (UUID format)
  const serialNumber = `urn:uuid:${generateUUID()}`;

  // Build components
  const components: CycloneDXComponent[] = results.map(result => 
    componentResultToCycloneDX(result, includeOccurrences)
  );

  // Collect all vulnerabilities
  const vulnerabilities: CycloneDXVulnerability[] = [];
  for (const result of results) {
    if (result.component.vulnerabilities) {
      for (const vuln of result.component.vulnerabilities) {
        vulnerabilities.push(vulnerabilityToCycloneDX(vuln, result));
      }
    }
  }

  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber,
    version: 1,
    metadata: {
      timestamp: output.timestamp,
      tools: [
        {
          vendor: 'ReachVet',
          name: 'reachvet',
          version: output.version,
        },
      ],
      component: {
        type: 'application',
        name: appName,
        version: appVersion,
      },
      properties: [
        { name: 'reachvet:language', value: output.language },
        { name: 'reachvet:sourceDir', value: output.sourceDir },
        { name: 'reachvet:summary:total', value: String(output.summary.total) },
        { name: 'reachvet:summary:reachable', value: String(output.summary.reachable) },
        { name: 'reachvet:summary:vulnerableReachable', value: String(output.summary.vulnerableReachable) },
      ],
    },
    components,
    ...(vulnerabilities.length > 0 ? { vulnerabilities } : {}),
  };
}

/**
 * Convert ComponentResult to CycloneDX component
 */
function componentResultToCycloneDX(result: ComponentResult, includeOccurrences: boolean): CycloneDXComponent {
  const { component, status, usage, confidence, warnings } = result;
  
  // Generate bom-ref
  const bomRef = component.purl || `${component.name}@${component.version}`;
  
  // Build properties for reachability metadata
  const properties: CycloneDXProperty[] = [
    { name: 'reachvet:status', value: status },
    { name: 'reachvet:confidence', value: confidence },
  ];

  if (usage?.importStyle) {
    properties.push({ name: 'reachvet:importStyle', value: usage.importStyle });
  }

  if (usage?.usedMembers && usage.usedMembers.length > 0) {
    properties.push({ name: 'reachvet:usedMembers', value: usage.usedMembers.join(', ') });
  }

  if (warnings && warnings.length > 0) {
    properties.push({ 
      name: 'reachvet:warnings', 
      value: warnings.map(w => w.code).join(', ') 
    });
  }

  // Build evidence (occurrences)
  let evidence: CycloneDXEvidence | undefined;
  if (includeOccurrences && usage?.locations && usage.locations.length > 0) {
    evidence = {
      occurrences: usage.locations.map(loc => ({
        location: loc.file,
        line: loc.line,
        offset: loc.column,
        symbol: usage.importedAs,
      })),
    };
  }

  const cdxComponent: CycloneDXComponent = {
    type: 'library',
    'bom-ref': bomRef,
    name: component.name,
    version: component.version,
    properties,
  };

  if (component.purl) {
    cdxComponent.purl = component.purl;
  }

  if (component.license) {
    cdxComponent.licenses = [{ license: { id: component.license } }];
  }

  if (evidence) {
    cdxComponent.evidence = evidence;
  }

  return cdxComponent;
}

/**
 * Convert vulnerability to CycloneDX format
 */
function vulnerabilityToCycloneDX(vuln: ComponentVulnerability, result: ComponentResult): CycloneDXVulnerability {
  const bomRef = result.component.purl || `${result.component.name}@${result.component.version}`;
  
  const cdxVuln: CycloneDXVulnerability = {
    id: vuln.id,
    affects: [{ ref: bomRef }],
    properties: [
      { name: 'reachvet:componentStatus', value: result.status },
      { name: 'reachvet:componentConfidence', value: result.confidence },
    ],
  };

  if (vuln.severity) {
    cdxVuln.ratings = [{ severity: vuln.severity, method: 'other' }];
  }

  if (vuln.description) {
    cdxVuln.description = vuln.description;
  }

  // Add source based on ID prefix
  if (vuln.id.startsWith('CVE-')) {
    cdxVuln.source = { name: 'NVD', url: `https://nvd.nist.gov/vuln/detail/${vuln.id}` };
  } else if (vuln.id.startsWith('GHSA-')) {
    cdxVuln.source = { name: 'GitHub', url: `https://github.com/advisories/${vuln.id}` };
  } else if (vuln.id.startsWith('OSV-') || vuln.id.startsWith('PYSEC-') || vuln.id.startsWith('RUSTSEC-')) {
    cdxVuln.source = { name: 'OSV', url: `https://osv.dev/vulnerability/${vuln.id}` };
  }

  // Mark if the vulnerability is reachable
  if (result.status === 'reachable' || result.status === 'imported') {
    cdxVuln.properties!.push({ name: 'reachvet:reachable', value: 'true' });
    
    // Include affected functions if available and used
    if (vuln.affectedFunctions && result.usage?.usedMembers) {
      const reachableFunctions = vuln.affectedFunctions.filter(
        fn => result.usage!.usedMembers!.includes(fn)
      );
      if (reachableFunctions.length > 0) {
        cdxVuln.properties!.push({ 
          name: 'reachvet:reachableFunctions', 
          value: reachableFunctions.join(', ') 
        });
      }
    }
  }

  return cdxVuln;
}

// ============================================================
// SPDX Generator
// ============================================================

/**
 * Generate SPDX 2.3 document from analysis output
 */
export function toSPDX(output: AnalysisOutput, options: SBOMOptions = {}): SPDXDocument {
  const {
    includeUnreachable = false,
    appName = 'analyzed-application',
    namespace = `https://spdx.org/spdxdocs/reachvet-${generateUUID()}`,
  } = options;

  // Filter results based on options
  const results = includeUnreachable
    ? output.results
    : output.results.filter(r => r.status !== 'not_reachable');

  // Build packages
  const packages: SPDXPackage[] = results.map((result, index) =>
    componentResultToSPDX(result, index)
  );

  // Build relationships (all packages are dependencies of the root)
  const relationships: SPDXRelationship[] = [
    {
      spdxElementId: 'SPDXRef-DOCUMENT',
      relatedSpdxElement: 'SPDXRef-RootPackage',
      relationshipType: 'DESCRIBES',
    },
  ];

  // Add root package
  packages.unshift({
    SPDXID: 'SPDXRef-RootPackage',
    name: appName,
    versionInfo: '1.0.0',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    comment: `ReachVet analysis: ${output.summary.total} components, ${output.summary.reachable} reachable, ${output.summary.vulnerableReachable} vulnerable+reachable`,
  });

  // Add dependency relationships
  for (let i = 0; i < results.length; i++) {
    relationships.push({
      spdxElementId: 'SPDXRef-RootPackage',
      relatedSpdxElement: `SPDXRef-Package-${i}`,
      relationshipType: 'DEPENDS_ON',
      comment: `Reachability: ${results[i].status} (${results[i].confidence})`,
    });
  }

  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `ReachVet SBOM for ${appName}`,
    documentNamespace: namespace,
    creationInfo: {
      created: output.timestamp,
      creators: [
        `Tool: reachvet-${output.version}`,
      ],
      comment: `Generated by ReachVet. Language: ${output.language}, Source: ${output.sourceDir}`,
    },
    packages,
    relationships,
  };
}

/**
 * Convert ComponentResult to SPDX package
 */
function componentResultToSPDX(result: ComponentResult, index: number): SPDXPackage {
  const { component, status, usage, confidence, warnings } = result;

  const externalRefs: SPDXExternalRef[] = [];

  // Add purl reference
  if (component.purl) {
    externalRefs.push({
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: component.purl,
    });
  }

  // Add vulnerability references
  if (component.vulnerabilities) {
    for (const vuln of component.vulnerabilities) {
      externalRefs.push({
        referenceCategory: 'SECURITY',
        referenceType: vuln.id.startsWith('CVE-') ? 'cpe23Type' : 'advisory',
        referenceLocator: getVulnerabilityUrl(vuln.id),
        comment: `Severity: ${vuln.severity || 'unknown'}, Reachable: ${status === 'reachable' || status === 'imported'}`,
      });
    }
  }

  // Build annotations for reachability data
  const annotations: SPDXAnnotation[] = [
    {
      annotationDate: new Date().toISOString(),
      annotationType: 'OTHER',
      annotator: 'Tool: reachvet',
      comment: buildReachabilityAnnotation(result),
    },
  ];

  const pkg: SPDXPackage = {
    SPDXID: `SPDXRef-Package-${index}`,
    name: component.name,
    versionInfo: component.version,
    downloadLocation: component.purl ? `pkg:${component.purl}` : 'NOASSERTION',
    filesAnalyzed: false,
    annotations,
  };

  if (component.license) {
    pkg.licenseConcluded = component.license;
    pkg.licenseDeclared = component.license;
  } else {
    pkg.licenseConcluded = 'NOASSERTION';
  }

  if (externalRefs.length > 0) {
    pkg.externalRefs = externalRefs;
  }

  // Add comment with summary
  const commentParts = [`Reachability: ${status} (confidence: ${confidence})`];
  if (usage?.usedMembers && usage.usedMembers.length > 0) {
    commentParts.push(`Used members: ${usage.usedMembers.join(', ')}`);
  }
  if (warnings && warnings.length > 0) {
    commentParts.push(`Warnings: ${warnings.map(w => w.code).join(', ')}`);
  }
  pkg.comment = commentParts.join('. ');

  return pkg;
}

/**
 * Build detailed reachability annotation
 */
function buildReachabilityAnnotation(result: ComponentResult): string {
  const { status, confidence, usage, warnings } = result;
  const parts: string[] = [
    `reachvet:status=${status}`,
    `reachvet:confidence=${confidence}`,
  ];

  if (usage) {
    parts.push(`reachvet:importStyle=${usage.importStyle}`);
    if (usage.importedAs) {
      parts.push(`reachvet:importedAs=${usage.importedAs}`);
    }
    if (usage.usedMembers && usage.usedMembers.length > 0) {
      parts.push(`reachvet:usedMembers=${usage.usedMembers.join(',')}`);
    }
    if (usage.locations && usage.locations.length > 0) {
      const locs = usage.locations.map(l => `${l.file}:${l.line}`).join(';');
      parts.push(`reachvet:locations=${locs}`);
    }
  }

  if (warnings && warnings.length > 0) {
    parts.push(`reachvet:warnings=${warnings.map(w => w.code).join(',')}`);
  }

  return parts.join(' | ');
}

// ============================================================
// VEX (Vulnerability Exploitability eXchange) Support
// ============================================================

export interface VEXStatement {
  vulnerability: string;
  status: 'not_affected' | 'affected' | 'under_investigation' | 'fixed';
  justification?: 
    | 'component_not_present'
    | 'vulnerable_code_not_present'
    | 'vulnerable_code_not_in_execute_path'
    | 'vulnerable_code_cannot_be_controlled_by_adversary'
    | 'inline_mitigations_already_exist';
  impact?: string;
  actionStatement?: string;
}

/**
 * Generate VEX statements from analysis output
 * 
 * VEX helps communicate whether vulnerabilities are actually exploitable
 * based on reachability analysis.
 */
export function generateVEXStatements(output: AnalysisOutput): VEXStatement[] {
  const statements: VEXStatement[] = [];

  for (const result of output.results) {
    if (!result.component.vulnerabilities) continue;

    for (const vuln of result.component.vulnerabilities) {
      const statement: VEXStatement = {
        vulnerability: vuln.id,
        status: reachabilityToVEXStatus(result.status),
      };

      // Add justification based on reachability
      if (result.status === 'not_reachable') {
        statement.justification = 'vulnerable_code_not_in_execute_path';
        statement.impact = `Component ${result.component.name}@${result.component.version} is not imported in the analyzed codebase.`;
      } else if (result.status === 'imported') {
        // Imported but specific usage unclear
        statement.status = 'under_investigation';
        statement.impact = `Component is imported but specific vulnerable function usage could not be determined with ${result.confidence} confidence.`;
      } else if (result.status === 'reachable') {
        statement.status = 'affected';
        
        // Check if specific vulnerable functions are used
        if (vuln.affectedFunctions && result.usage?.usedMembers) {
          const usedVulnFunctions = vuln.affectedFunctions.filter(
            fn => result.usage!.usedMembers!.includes(fn)
          );
          
          if (usedVulnFunctions.length === 0) {
            statement.status = 'not_affected';
            statement.justification = 'vulnerable_code_not_present';
            statement.impact = `Vulnerable functions (${vuln.affectedFunctions.join(', ')}) are not used. Only these functions are used: ${result.usage.usedMembers.join(', ')}`;
          } else {
            statement.impact = `Vulnerable functions in use: ${usedVulnFunctions.join(', ')}`;
            statement.actionStatement = 'Upgrade to fixed version or remove usage of vulnerable functions.';
          }
        } else {
          statement.impact = `Component is actively used in the codebase.`;
          statement.actionStatement = 'Review usage and consider upgrading to fixed version.';
        }
      }

      statements.push(statement);
    }
  }

  return statements;
}

/**
 * Convert reachability status to VEX status
 */
function reachabilityToVEXStatus(status: ReachabilityStatus): VEXStatement['status'] {
  switch (status) {
    case 'not_reachable':
      return 'not_affected';
    case 'reachable':
    case 'indirect':
      return 'affected';
    case 'imported':
    case 'unknown':
      return 'under_investigation';
    default:
      return 'under_investigation';
  }
}

// ============================================================
// Utilities
// ============================================================

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  
  // Set version (4) and variant (10)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Get vulnerability URL based on ID
 */
function getVulnerabilityUrl(id: string): string {
  if (id.startsWith('CVE-')) {
    return `https://nvd.nist.gov/vuln/detail/${id}`;
  } else if (id.startsWith('GHSA-')) {
    return `https://github.com/advisories/${id}`;
  } else if (id.startsWith('OSV-') || id.startsWith('PYSEC-') || id.startsWith('RUSTSEC-')) {
    return `https://osv.dev/vulnerability/${id}`;
  }
  return `https://osv.dev/vulnerability/${id}`;
}

// ============================================================
// Exports
// ============================================================

export type { CycloneDXBom, SPDXDocument };
