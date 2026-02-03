/**
 * ReachVet - SBOM Parser (CycloneDX / SPDX)
 */

import { readFile } from 'node:fs/promises';
import type { Component, ComponentVulnerability } from '../types.js';

// ============================================================
// CycloneDX Types
// ============================================================

interface CycloneDXComponent {
  type?: string;
  name: string;
  version: string;
  purl?: string;
  licenses?: Array<{ license?: { id?: string; name?: string } }>;
}

interface CycloneDXVulnerability {
  id: string;
  source?: { name?: string };
  ratings?: Array<{ severity?: string }>;
  affects?: Array<{ ref?: string }>;
  description?: string;
}

interface CycloneDXBom {
  bomFormat?: string;
  specVersion?: string;
  components?: CycloneDXComponent[];
  vulnerabilities?: CycloneDXVulnerability[];
}

// ============================================================
// SPDX Types (simplified)
// ============================================================

interface SPDXPackage {
  name: string;
  versionInfo?: string;
  SPDXID?: string;
  externalRefs?: Array<{
    referenceCategory?: string;
    referenceType?: string;
    referenceLocator?: string;
  }>;
  licenseConcluded?: string;
}

interface SPDXDocument {
  spdxVersion?: string;
  packages?: SPDXPackage[];
}

// ============================================================
// Parsers
// ============================================================

/**
 * Parse CycloneDX SBOM
 */
export function parseCycloneDX(content: string): Component[] {
  const bom = JSON.parse(content) as CycloneDXBom;
  
  if (bom.bomFormat !== 'CycloneDX') {
    throw new Error('Not a valid CycloneDX SBOM');
  }

  const components: Component[] = [];
  const vulnMap = new Map<string, ComponentVulnerability[]>();

  // Build vulnerability map by purl/ref
  if (bom.vulnerabilities) {
    for (const vuln of bom.vulnerabilities) {
      const vulnInfo: ComponentVulnerability = {
        id: vuln.id,
        severity: (vuln.ratings?.[0]?.severity?.toLowerCase() as ComponentVulnerability['severity']) ?? 'unknown',
        description: vuln.description
      };

      for (const affect of vuln.affects ?? []) {
        if (affect.ref) {
          const existing = vulnMap.get(affect.ref) ?? [];
          existing.push(vulnInfo);
          vulnMap.set(affect.ref, existing);
        }
      }
    }
  }

  // Parse components
  for (const comp of bom.components ?? []) {
    const component: Component = {
      name: comp.name,
      version: comp.version,
      purl: comp.purl,
      ecosystem: extractEcosystem(comp.purl),
      license: comp.licenses?.[0]?.license?.id ?? comp.licenses?.[0]?.license?.name
    };

    // Attach vulnerabilities if any
    if (comp.purl && vulnMap.has(comp.purl)) {
      component.vulnerabilities = vulnMap.get(comp.purl);
    }

    components.push(component);
  }

  return components;
}

/**
 * Parse SPDX SBOM
 */
export function parseSPDX(content: string): Component[] {
  const doc = JSON.parse(content) as SPDXDocument;
  
  if (!doc.spdxVersion?.startsWith('SPDX-')) {
    throw new Error('Not a valid SPDX document');
  }

  const components: Component[] = [];

  for (const pkg of doc.packages ?? []) {
    // Find purl in external refs
    const purlRef = pkg.externalRefs?.find(
      ref => ref.referenceType === 'purl'
    );

    const component: Component = {
      name: pkg.name,
      version: pkg.versionInfo ?? 'unknown',
      purl: purlRef?.referenceLocator,
      ecosystem: extractEcosystem(purlRef?.referenceLocator),
      license: pkg.licenseConcluded
    };

    components.push(component);
  }

  return components;
}

/**
 * Auto-detect and parse SBOM
 */
export async function parseSBOM(filePath: string): Promise<Component[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseSBOMString(content);
}

/**
 * Auto-detect format and parse
 */
export function parseSBOMString(content: string): Component[] {
  const data = JSON.parse(content);

  // Detect CycloneDX
  if (data.bomFormat === 'CycloneDX') {
    return parseCycloneDX(content);
  }

  // Detect SPDX
  if (data.spdxVersion) {
    return parseSPDX(content);
  }

  throw new Error('Unknown SBOM format. Supported: CycloneDX, SPDX');
}

/**
 * Extract ecosystem from purl
 */
function extractEcosystem(purl?: string): string | undefined {
  if (!purl) return undefined;
  
  // pkg:npm/lodash@4.17.20 -> npm
  const match = purl.match(/^pkg:([^/]+)\//);
  return match?.[1];
}
