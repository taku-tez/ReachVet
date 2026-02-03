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
  'bom-ref'?: string;
  licenses?: Array<{ license?: { id?: string; name?: string } }>;
  components?: CycloneDXComponent[]; // Nested components
}

interface CycloneDXVulnerability {
  id: string;
  source?: { name?: string };
  ratings?: Array<{ severity?: string }>;
  affects?: Array<{ ref?: string }>;
  description?: string;
}

interface CycloneDXDependency {
  ref: string;
  dependsOn?: string[];
}

interface CycloneDXBom {
  bomFormat?: string;
  specVersion?: string;
  components?: CycloneDXComponent[];
  vulnerabilities?: CycloneDXVulnerability[];
  dependencies?: CycloneDXDependency[];
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

interface SPDXRelationship {
  spdxElementId: string;
  relatedSpdxElement: string;
  relationshipType: string;
}

interface SPDXDocument {
  spdxVersion?: string;
  packages?: SPDXPackage[];
  relationships?: SPDXRelationship[];
}

// ============================================================
// Parsers
// ============================================================

/**
 * Flatten nested CycloneDX components recursively
 */
function flattenCycloneDXComponents(components: CycloneDXComponent[]): CycloneDXComponent[] {
  const result: CycloneDXComponent[] = [];
  
  for (const comp of components) {
    result.push(comp);
    
    // Recursively flatten nested components
    if (comp.components && comp.components.length > 0) {
      result.push(...flattenCycloneDXComponents(comp.components));
    }
  }
  
  return result;
}

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

  // Build vulnerability map by purl/ref (supports both purl and bom-ref)
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

  // Build dependency map if present
  const dependencyMap = new Map<string, string[]>();
  if (bom.dependencies) {
    for (const dep of bom.dependencies) {
      dependencyMap.set(dep.ref, dep.dependsOn ?? []);
    }
  }

  // Flatten and parse components (handles nested components)
  const flatComponents = flattenCycloneDXComponents(bom.components ?? []);
  
  for (const comp of flatComponents) {
    const component: Component = {
      name: comp.name,
      version: comp.version,
      purl: comp.purl,
      ecosystem: extractEcosystem(comp.purl),
      license: comp.licenses?.[0]?.license?.id ?? comp.licenses?.[0]?.license?.name
    };

    // Attach vulnerabilities by purl
    if (comp.purl && vulnMap.has(comp.purl)) {
      component.vulnerabilities = vulnMap.get(comp.purl);
    }
    
    // Also check bom-ref for vulnerability matching
    if (comp['bom-ref'] && vulnMap.has(comp['bom-ref']) && !component.vulnerabilities) {
      component.vulnerabilities = vulnMap.get(comp['bom-ref']);
    }

    // Attach dependencies if present (as metadata for future use)
    const bomRef = comp['bom-ref'] ?? comp.purl;
    if (bomRef && dependencyMap.has(bomRef)) {
      // Store in component for downstream analysis
      (component as Component & { dependsOn?: string[] }).dependsOn = dependencyMap.get(bomRef);
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

  // Build SPDXID -> package index
  const packageBySpdxId = new Map<string, SPDXPackage>();
  for (const pkg of doc.packages ?? []) {
    if (pkg.SPDXID) {
      packageBySpdxId.set(pkg.SPDXID, pkg);
    }
  }

  // Build dependency map from relationships (DEPENDS_ON, DEPENDENCY_OF)
  const dependencyMap = new Map<string, string[]>();
  if (doc.relationships) {
    for (const rel of doc.relationships) {
      if (rel.relationshipType === 'DEPENDS_ON') {
        // A DEPENDS_ON B means A depends on B
        const deps = dependencyMap.get(rel.spdxElementId) ?? [];
        deps.push(rel.relatedSpdxElement);
        dependencyMap.set(rel.spdxElementId, deps);
      } else if (rel.relationshipType === 'DEPENDENCY_OF') {
        // A DEPENDENCY_OF B means B depends on A
        const deps = dependencyMap.get(rel.relatedSpdxElement) ?? [];
        deps.push(rel.spdxElementId);
        dependencyMap.set(rel.relatedSpdxElement, deps);
      }
    }
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

    // Attach dependencies if present
    if (pkg.SPDXID && dependencyMap.has(pkg.SPDXID)) {
      const depSpdxIds = dependencyMap.get(pkg.SPDXID)!;
      // Resolve SPDXID to package names/purls for downstream use
      const resolvedDeps = depSpdxIds
        .map(id => {
          const depPkg = packageBySpdxId.get(id);
          if (depPkg) {
            const depPurl = depPkg.externalRefs?.find(r => r.referenceType === 'purl')?.referenceLocator;
            return depPurl ?? `${depPkg.name}@${depPkg.versionInfo ?? 'unknown'}`;
          }
          return id;
        });
      (component as Component & { dependsOn?: string[] }).dependsOn = resolvedDeps;
    }

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
