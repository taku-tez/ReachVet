/**
 * Tests for SBOM Output Generation
 */

import { describe, it, expect } from 'vitest';
import { toCycloneDX, toSPDX, generateVEXStatements } from '../src/output/sbom.js';
import type { AnalysisOutput, ComponentResult } from '../src/types.js';

// Helper to create mock analysis output
function createMockOutput(results: Partial<ComponentResult>[]): AnalysisOutput {
  const fullResults = results.map((r, i) => ({
    component: {
      name: r.component?.name ?? `package-${i}`,
      version: r.component?.version ?? '1.0.0',
      purl: r.component?.purl,
      ecosystem: r.component?.ecosystem ?? 'npm',
      license: r.component?.license,
      vulnerabilities: r.component?.vulnerabilities,
    },
    status: r.status ?? 'reachable',
    usage: r.usage ?? {
      importStyle: 'esm' as const,
      importedAs: r.component?.name ?? `package-${i}`,
      usedMembers: ['default'],
      locations: [{ file: 'src/index.ts', line: 1 }],
    },
    confidence: r.confidence ?? 'high',
    notes: r.notes,
    warnings: r.warnings,
  })) as ComponentResult[];

  return {
    version: '1.0.0',
    timestamp: '2026-02-04T12:00:00.000Z',
    sourceDir: '/project',
    language: 'typescript',
    summary: {
      total: fullResults.length,
      reachable: fullResults.filter(r => r.status === 'reachable').length,
      imported: fullResults.filter(r => r.status === 'imported').length,
      notReachable: fullResults.filter(r => r.status === 'not_reachable').length,
      indirect: fullResults.filter(r => r.status === 'indirect').length,
      unknown: fullResults.filter(r => r.status === 'unknown').length,
      vulnerableReachable: fullResults.filter(r => 
        r.status === 'reachable' && r.component.vulnerabilities?.length
      ).length,
      warningsCount: fullResults.reduce((sum, r) => sum + (r.warnings?.length ?? 0), 0),
    },
    results: fullResults,
  };
}

describe('CycloneDX Output', () => {
  it('generates valid CycloneDX structure', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' } },
    ]);

    const sbom = toCycloneDX(output);

    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBe('1.5');
    expect(sbom.$schema).toContain('cyclonedx.org');
    expect(sbom.serialNumber).toMatch(/^urn:uuid:/);
    expect(sbom.version).toBe(1);
  });

  it('includes metadata with tool info', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' } },
    ]);

    const sbom = toCycloneDX(output);

    expect(sbom.metadata.tools).toHaveLength(1);
    expect(sbom.metadata.tools![0].name).toBe('reachvet');
    expect(sbom.metadata.tools![0].vendor).toBe('ReachVet');
    expect(sbom.metadata.timestamp).toBe(output.timestamp);
  });

  it('includes analysis metadata properties', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' } },
    ]);

    const sbom = toCycloneDX(output);

    const props = sbom.metadata.properties;
    expect(props).toBeDefined();
    expect(props!.find(p => p.name === 'reachvet:language')?.value).toBe('typescript');
    expect(props!.find(p => p.name === 'reachvet:sourceDir')?.value).toBe('/project');
  });

  it('converts components with reachability properties', () => {
    const output = createMockOutput([
      {
        component: { name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21' },
        status: 'reachable',
        confidence: 'high',
        usage: {
          importStyle: 'esm',
          usedMembers: ['merge', 'cloneDeep'],
          locations: [{ file: 'src/utils.ts', line: 5 }],
        },
      },
    ]);

    const sbom = toCycloneDX(output);

    expect(sbom.components).toHaveLength(1);
    const comp = sbom.components[0];
    expect(comp.name).toBe('lodash');
    expect(comp.version).toBe('4.17.21');
    expect(comp.purl).toBe('pkg:npm/lodash@4.17.21');
    expect(comp['bom-ref']).toBe('pkg:npm/lodash@4.17.21');

    // Check properties
    const props = comp.properties!;
    expect(props.find(p => p.name === 'reachvet:status')?.value).toBe('reachable');
    expect(props.find(p => p.name === 'reachvet:confidence')?.value).toBe('high');
    expect(props.find(p => p.name === 'reachvet:usedMembers')?.value).toBe('merge, cloneDeep');
  });

  it('includes evidence with occurrences', () => {
    const output = createMockOutput([
      {
        component: { name: 'lodash', version: '4.17.21' },
        usage: {
          importStyle: 'esm',
          importedAs: '_',
          usedMembers: ['merge'],
          locations: [
            { file: 'src/a.ts', line: 10, column: 5 },
            { file: 'src/b.ts', line: 20 },
          ],
        },
      },
    ]);

    const sbom = toCycloneDX(output, { includeOccurrences: true });

    const comp = sbom.components[0];
    expect(comp.evidence).toBeDefined();
    expect(comp.evidence!.occurrences).toHaveLength(2);
    expect(comp.evidence!.occurrences![0]).toEqual({
      location: 'src/a.ts',
      line: 10,
      offset: 5,
      symbol: '_',
    });
  });

  it('includes vulnerabilities with reachability info', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [
            {
              id: 'CVE-2021-23337',
              severity: 'high',
              affectedFunctions: ['template'],
              description: 'Prototype pollution in template',
            },
          ],
        },
        status: 'reachable',
        usage: { importStyle: 'esm', usedMembers: ['template', 'merge'], locations: [] },
      },
    ]);

    const sbom = toCycloneDX(output);

    expect(sbom.vulnerabilities).toHaveLength(1);
    const vuln = sbom.vulnerabilities![0];
    expect(vuln.id).toBe('CVE-2021-23337');
    expect(vuln.ratings![0].severity).toBe('high');
    expect(vuln.description).toBe('Prototype pollution in template');
    expect(vuln.source?.name).toBe('NVD');
    expect(vuln.source?.url).toContain('nvd.nist.gov');

    // Check reachability properties
    const props = vuln.properties!;
    expect(props.find(p => p.name === 'reachvet:componentStatus')?.value).toBe('reachable');
    expect(props.find(p => p.name === 'reachvet:reachable')?.value).toBe('true');
    expect(props.find(p => p.name === 'reachvet:reachableFunctions')?.value).toBe('template');
  });

  it('excludes unreachable components by default', () => {
    const output = createMockOutput([
      { component: { name: 'used-pkg', version: '1.0.0' }, status: 'reachable' },
      { component: { name: 'unused-pkg', version: '1.0.0' }, status: 'not_reachable' },
    ]);

    const sbom = toCycloneDX(output);

    expect(sbom.components).toHaveLength(1);
    expect(sbom.components[0].name).toBe('used-pkg');
  });

  it('includes unreachable components when option is set', () => {
    const output = createMockOutput([
      { component: { name: 'used-pkg', version: '1.0.0' }, status: 'reachable' },
      { component: { name: 'unused-pkg', version: '1.0.0' }, status: 'not_reachable' },
    ]);

    const sbom = toCycloneDX(output, { includeUnreachable: true });

    expect(sbom.components).toHaveLength(2);
  });

  it('uses custom app name and version', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' } },
    ]);

    const sbom = toCycloneDX(output, {
      appName: 'my-app',
      appVersion: '2.0.0',
    });

    expect(sbom.metadata.component?.name).toBe('my-app');
    expect(sbom.metadata.component?.version).toBe('2.0.0');
  });

  it('includes warnings in component properties', () => {
    const output = createMockOutput([
      {
        component: { name: 'lodash', version: '4.17.21' },
        warnings: [
          { code: 'dynamic_import', message: 'Dynamic import detected', severity: 'warning' },
          { code: 'namespace_import', message: 'Namespace import', severity: 'info' },
        ],
      },
    ]);

    const sbom = toCycloneDX(output);

    const props = sbom.components[0].properties!;
    expect(props.find(p => p.name === 'reachvet:warnings')?.value).toBe('dynamic_import, namespace_import');
  });

  it('handles components with licenses', () => {
    const output = createMockOutput([
      {
        component: { name: 'lodash', version: '4.17.21', license: 'MIT' },
      },
    ]);

    const sbom = toCycloneDX(output);

    expect(sbom.components[0].licenses).toHaveLength(1);
    expect(sbom.components[0].licenses![0].license?.id).toBe('MIT');
  });
});

describe('SPDX Output', () => {
  it('generates valid SPDX structure', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' } },
    ]);

    const sbom = toSPDX(output);

    expect(sbom.spdxVersion).toBe('SPDX-2.3');
    expect(sbom.dataLicense).toBe('CC0-1.0');
    expect(sbom.SPDXID).toBe('SPDXRef-DOCUMENT');
    expect(sbom.documentNamespace).toContain('spdx.org/spdxdocs/reachvet-');
  });

  it('includes creation info with tool', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' } },
    ]);

    const sbom = toSPDX(output);

    expect(sbom.creationInfo.created).toBe(output.timestamp);
    expect(sbom.creationInfo.creators).toContain('Tool: reachvet-1.0.0');
    expect(sbom.creationInfo.comment).toContain('typescript');
  });

  it('includes root package with analysis summary', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' } },
    ]);

    const sbom = toSPDX(output);

    const root = sbom.packages.find(p => p.SPDXID === 'SPDXRef-RootPackage');
    expect(root).toBeDefined();
    expect(root!.comment).toContain('1 components');
    expect(root!.comment).toContain('1 reachable');
  });

  it('converts components to SPDX packages', () => {
    const output = createMockOutput([
      {
        component: { name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21' },
        status: 'reachable',
        confidence: 'high',
      },
    ]);

    const sbom = toSPDX(output);

    // Find component package (not root)
    const pkg = sbom.packages.find(p => p.name === 'lodash');
    expect(pkg).toBeDefined();
    expect(pkg!.versionInfo).toBe('4.17.21');
    expect(pkg!.SPDXID).toBe('SPDXRef-Package-0');
    expect(pkg!.filesAnalyzed).toBe(false);
  });

  it('includes purl in external refs', () => {
    const output = createMockOutput([
      {
        component: { name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21' },
      },
    ]);

    const sbom = toSPDX(output);

    const pkg = sbom.packages.find(p => p.name === 'lodash')!;
    const purlRef = pkg.externalRefs?.find(r => r.referenceType === 'purl');
    expect(purlRef).toBeDefined();
    expect(purlRef!.referenceLocator).toBe('pkg:npm/lodash@4.17.21');
  });

  it('includes vulnerability references', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [
            { id: 'CVE-2021-23337', severity: 'high' },
            { id: 'GHSA-xxxx-yyyy-zzzz', severity: 'medium' },
          ],
        },
        status: 'reachable',
      },
    ]);

    const sbom = toSPDX(output);

    const pkg = sbom.packages.find(p => p.name === 'lodash')!;
    const secRefs = pkg.externalRefs?.filter(r => r.referenceCategory === 'SECURITY');
    expect(secRefs).toHaveLength(2);
    expect(secRefs![0].referenceLocator).toContain('nvd.nist.gov');
    expect(secRefs![1].referenceLocator).toContain('github.com/advisories');
  });

  it('includes reachability annotation', () => {
    const output = createMockOutput([
      {
        component: { name: 'lodash', version: '4.17.21' },
        status: 'reachable',
        confidence: 'high',
        usage: {
          importStyle: 'esm',
          importedAs: '_',
          usedMembers: ['merge', 'cloneDeep'],
          locations: [{ file: 'src/a.ts', line: 10 }],
        },
      },
    ]);

    const sbom = toSPDX(output);

    const pkg = sbom.packages.find(p => p.name === 'lodash')!;
    expect(pkg.annotations).toHaveLength(1);
    
    const annotation = pkg.annotations![0];
    expect(annotation.annotationType).toBe('OTHER');
    expect(annotation.annotator).toBe('Tool: reachvet');
    expect(annotation.comment).toContain('reachvet:status=reachable');
    expect(annotation.comment).toContain('reachvet:confidence=high');
    expect(annotation.comment).toContain('reachvet:usedMembers=merge,cloneDeep');
  });

  it('includes package comment with summary', () => {
    const output = createMockOutput([
      {
        component: { name: 'lodash', version: '4.17.21' },
        status: 'reachable',
        confidence: 'high',
        usage: { importStyle: 'esm', usedMembers: ['merge'], locations: [] },
      },
    ]);

    const sbom = toSPDX(output);

    const pkg = sbom.packages.find(p => p.name === 'lodash')!;
    expect(pkg.comment).toContain('Reachability: reachable');
    expect(pkg.comment).toContain('confidence: high');
    expect(pkg.comment).toContain('Used members: merge');
  });

  it('creates dependency relationships', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' }, status: 'reachable' },
      { component: { name: 'axios', version: '1.0.0' }, status: 'imported' },
    ]);

    const sbom = toSPDX(output);

    // Should have DESCRIBES + DEPENDS_ON relationships
    const describesRel = sbom.relationships.find(r => r.relationshipType === 'DESCRIBES');
    expect(describesRel).toBeDefined();
    expect(describesRel!.spdxElementId).toBe('SPDXRef-DOCUMENT');
    expect(describesRel!.relatedSpdxElement).toBe('SPDXRef-RootPackage');

    const dependsOnRels = sbom.relationships.filter(r => r.relationshipType === 'DEPENDS_ON');
    expect(dependsOnRels).toHaveLength(2);
    expect(dependsOnRels[0].comment).toContain('Reachability:');
  });

  it('excludes unreachable by default', () => {
    const output = createMockOutput([
      { component: { name: 'used', version: '1.0.0' }, status: 'reachable' },
      { component: { name: 'unused', version: '1.0.0' }, status: 'not_reachable' },
    ]);

    const sbom = toSPDX(output);

    // 1 root + 1 component (excluding unreachable)
    expect(sbom.packages).toHaveLength(2);
  });

  it('includes unreachable with option', () => {
    const output = createMockOutput([
      { component: { name: 'used', version: '1.0.0' }, status: 'reachable' },
      { component: { name: 'unused', version: '1.0.0' }, status: 'not_reachable' },
    ]);

    const sbom = toSPDX(output, { includeUnreachable: true });

    // 1 root + 2 components
    expect(sbom.packages).toHaveLength(3);
  });

  it('uses custom app name', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' } },
    ]);

    const sbom = toSPDX(output, { appName: 'my-app' });

    expect(sbom.name).toBe('ReachVet SBOM for my-app');
    const root = sbom.packages.find(p => p.SPDXID === 'SPDXRef-RootPackage');
    expect(root!.name).toBe('my-app');
  });

  it('handles licenses', () => {
    const output = createMockOutput([
      {
        component: { name: 'lodash', version: '4.17.21', license: 'MIT' },
      },
    ]);

    const sbom = toSPDX(output);

    const pkg = sbom.packages.find(p => p.name === 'lodash')!;
    expect(pkg.licenseConcluded).toBe('MIT');
    expect(pkg.licenseDeclared).toBe('MIT');
  });

  it('uses NOASSERTION for missing license', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' } },
    ]);

    const sbom = toSPDX(output);

    const pkg = sbom.packages.find(p => p.name === 'lodash')!;
    expect(pkg.licenseConcluded).toBe('NOASSERTION');
  });
});

describe('VEX Generation', () => {
  it('generates VEX statements for vulnerabilities', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [{ id: 'CVE-2021-23337', severity: 'high' }],
        },
        status: 'reachable',
      },
    ]);

    const vex = generateVEXStatements(output);

    expect(vex).toHaveLength(1);
    expect(vex[0].vulnerability).toBe('CVE-2021-23337');
    expect(vex[0].status).toBe('affected');
  });

  it('marks not_reachable as not_affected', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [{ id: 'CVE-2021-23337', severity: 'high' }],
        },
        status: 'not_reachable',
      },
    ]);

    const vex = generateVEXStatements(output);

    expect(vex[0].status).toBe('not_affected');
    expect(vex[0].justification).toBe('vulnerable_code_not_in_execute_path');
    expect(vex[0].impact).toContain('not imported');
  });

  it('marks imported as under_investigation', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [{ id: 'CVE-2021-23337', severity: 'high' }],
        },
        status: 'imported',
        confidence: 'medium',
      },
    ]);

    const vex = generateVEXStatements(output);

    expect(vex[0].status).toBe('under_investigation');
    expect(vex[0].impact).toContain('could not be determined');
  });

  it('marks reachable but not using vulnerable function as not_affected', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [
            { id: 'CVE-2021-23337', severity: 'high', affectedFunctions: ['template'] },
          ],
        },
        status: 'reachable',
        usage: {
          importStyle: 'esm',
          usedMembers: ['merge', 'cloneDeep'], // Not using template
          locations: [],
        },
      },
    ]);

    const vex = generateVEXStatements(output);

    expect(vex[0].status).toBe('not_affected');
    expect(vex[0].justification).toBe('vulnerable_code_not_present');
    expect(vex[0].impact).toContain('Vulnerable functions (template) are not used');
    expect(vex[0].impact).toContain('merge, cloneDeep');
  });

  it('marks reachable and using vulnerable function as affected', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [
            { id: 'CVE-2021-23337', severity: 'high', affectedFunctions: ['template'] },
          ],
        },
        status: 'reachable',
        usage: {
          importStyle: 'esm',
          usedMembers: ['template', 'merge'], // Using template!
          locations: [],
        },
      },
    ]);

    const vex = generateVEXStatements(output);

    expect(vex[0].status).toBe('affected');
    expect(vex[0].impact).toContain('Vulnerable functions in use: template');
    expect(vex[0].actionStatement).toContain('Upgrade');
  });

  it('skips components without vulnerabilities', () => {
    const output = createMockOutput([
      { component: { name: 'lodash', version: '4.17.21' }, status: 'reachable' },
      { component: { name: 'axios', version: '1.0.0' }, status: 'imported' },
    ]);

    const vex = generateVEXStatements(output);

    expect(vex).toHaveLength(0);
  });

  it('generates multiple VEX statements for multiple vulns', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [
            { id: 'CVE-2021-23337', severity: 'high' },
            { id: 'CVE-2020-12345', severity: 'medium' },
          ],
        },
        status: 'reachable',
      },
    ]);

    const vex = generateVEXStatements(output);

    expect(vex).toHaveLength(2);
    expect(vex.map(v => v.vulnerability)).toEqual(['CVE-2021-23337', 'CVE-2020-12345']);
  });

  it('handles indirect status as affected', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'lodash',
          version: '4.17.20',
          vulnerabilities: [{ id: 'CVE-2021-23337', severity: 'high' }],
        },
        status: 'indirect',
      },
    ]);

    const vex = generateVEXStatements(output);

    expect(vex[0].status).toBe('affected');
  });
});

describe('Edge Cases', () => {
  it('handles empty results', () => {
    const output = createMockOutput([]);

    const cyclonedx = toCycloneDX(output);
    const spdx = toSPDX(output);
    const vex = generateVEXStatements(output);

    expect(cyclonedx.components).toHaveLength(0);
    expect(spdx.packages).toHaveLength(1); // Root only
    expect(vex).toHaveLength(0);
  });

  it('handles components without purl', () => {
    const output = createMockOutput([
      { component: { name: 'my-pkg', version: '1.0.0' } },
    ]);

    const sbom = toCycloneDX(output);

    expect(sbom.components[0]['bom-ref']).toBe('my-pkg@1.0.0');
    expect(sbom.components[0].purl).toBeUndefined();
  });

  it('handles different vulnerability ID formats', () => {
    const output = createMockOutput([
      {
        component: {
          name: 'pkg',
          version: '1.0.0',
          vulnerabilities: [
            { id: 'CVE-2021-1234', severity: 'high' },
            { id: 'GHSA-xxxx-yyyy-zzzz', severity: 'medium' },
            { id: 'PYSEC-2021-1234', severity: 'low' },
            { id: 'RUSTSEC-2021-1234', severity: 'low' },
            { id: 'OSV-2021-1234', severity: 'low' },
          ],
        },
        status: 'reachable',
      },
    ]);

    const sbom = toCycloneDX(output);

    expect(sbom.vulnerabilities).toHaveLength(5);
    
    const sources = sbom.vulnerabilities!.map(v => v.source?.name);
    expect(sources).toContain('NVD');
    expect(sources).toContain('GitHub');
    expect(sources.filter(s => s === 'OSV')).toHaveLength(3);
  });
});
