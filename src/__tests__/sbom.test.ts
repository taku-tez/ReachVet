/**
 * ReachVet SBOM Parser Tests
 * Covers CycloneDX JSON and SPDX JSON formats
 */

import { describe, it, expect } from 'vitest';
import { parseCycloneDX, parseSPDX, parseSBOMString } from '../input/sbom.js';

// ============================================================
// CycloneDX Tests
// ============================================================

describe('CycloneDX Parser', () => {
  it('parses basic CycloneDX 1.5 BOM', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21' },
        { name: 'express', version: '4.18.2', purl: 'pkg:npm/express@4.18.2' }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components).toHaveLength(2);
    expect(components[0].name).toBe('lodash');
    expect(components[0].version).toBe('4.17.21');
    expect(components[0].ecosystem).toBe('npm');
  });

  it('parses components with vulnerabilities', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { 
          name: 'lodash', 
          version: '4.17.20', 
          purl: 'pkg:npm/lodash@4.17.20',
          'bom-ref': 'pkg:npm/lodash@4.17.20'
        }
      ],
      vulnerabilities: [
        {
          id: 'CVE-2021-23337',
          source: { name: 'NVD' },
          ratings: [{ severity: 'high' }],
          affects: [{ ref: 'pkg:npm/lodash@4.17.20' }],
          description: 'Command injection via template()'
        }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components[0].vulnerabilities).toHaveLength(1);
    expect(components[0].vulnerabilities![0].id).toBe('CVE-2021-23337');
    expect(components[0].vulnerabilities![0].severity).toBe('high');
  });

  it('parses CycloneDX 1.4 format', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      components: [
        { type: 'library', name: 'axios', version: '0.21.0' }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('axios');
  });

  it('extracts license information', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        {
          name: 'lodash',
          version: '4.17.21',
          licenses: [
            { license: { id: 'MIT' } }
          ]
        },
        {
          name: 'react',
          version: '18.2.0',
          licenses: [
            { license: { name: 'MIT License' } }
          ]
        }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components[0].license).toBe('MIT');
    expect(components[1].license).toBe('MIT License');
  });

  it('handles multiple vulnerabilities per component', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'log4j', version: '2.14.0', purl: 'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.0' }
      ],
      vulnerabilities: [
        {
          id: 'CVE-2021-44228',
          ratings: [{ severity: 'critical' }],
          affects: [{ ref: 'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.0' }]
        },
        {
          id: 'CVE-2021-45046',
          ratings: [{ severity: 'critical' }],
          affects: [{ ref: 'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.0' }]
        }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components[0].vulnerabilities).toHaveLength(2);
    expect(components[0].vulnerabilities!.map(v => v.id)).toContain('CVE-2021-44228');
    expect(components[0].vulnerabilities!.map(v => v.id)).toContain('CVE-2021-45046');
  });

  it('extracts ecosystem from different purl types', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash@4.17.21' },
        { name: 'requests', version: '2.28.0', purl: 'pkg:pypi/requests@2.28.0' },
        { name: 'log4j', version: '2.14.0', purl: 'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.0' },
        { name: 'rails', version: '7.0.0', purl: 'pkg:gem/rails@7.0.0' },
        { name: 'symfony', version: '6.0.0', purl: 'pkg:composer/symfony/symfony@6.0.0' }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components[0].ecosystem).toBe('npm');
    expect(components[1].ecosystem).toBe('pypi');
    expect(components[2].ecosystem).toBe('maven');
    expect(components[3].ecosystem).toBe('gem');
    expect(components[4].ecosystem).toBe('composer');
  });

  it('handles empty components array', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: []
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components).toHaveLength(0);
  });

  it('handles missing vulnerabilities array', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'lodash', version: '4.17.21' }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components).toHaveLength(1);
    expect(components[0].vulnerabilities).toBeUndefined();
  });

  it('rejects non-CycloneDX format', () => {
    const invalid = { spdxVersion: 'SPDX-2.3' };
    
    expect(() => parseCycloneDX(JSON.stringify(invalid)))
      .toThrow('Not a valid CycloneDX SBOM');
  });

  it('handles vulnerability with unknown severity', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'test', version: '1.0.0', purl: 'pkg:npm/test@1.0.0' }
      ],
      vulnerabilities: [
        {
          id: 'CVE-2024-0001',
          affects: [{ ref: 'pkg:npm/test@1.0.0' }]
        }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components[0].vulnerabilities![0].severity).toBe('unknown');
  });
});

// ============================================================
// SPDX Tests
// ============================================================

describe('SPDX Parser', () => {
  it('parses basic SPDX 2.3 document', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      SPDXID: 'SPDXRef-DOCUMENT',
      name: 'test-sbom',
      packages: [
        {
          name: 'lodash',
          versionInfo: '4.17.21',
          SPDXID: 'SPDXRef-Package-lodash'
        },
        {
          name: 'express',
          versionInfo: '4.18.2',
          SPDXID: 'SPDXRef-Package-express'
        }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    expect(components).toHaveLength(2);
    expect(components[0].name).toBe('lodash');
    expect(components[0].version).toBe('4.17.21');
  });

  it('extracts purl from external references', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        {
          name: 'lodash',
          versionInfo: '4.17.21',
          externalRefs: [
            {
              referenceCategory: 'PACKAGE-MANAGER',
              referenceType: 'purl',
              referenceLocator: 'pkg:npm/lodash@4.17.21'
            }
          ]
        }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    expect(components[0].purl).toBe('pkg:npm/lodash@4.17.21');
    expect(components[0].ecosystem).toBe('npm');
  });

  it('extracts license information', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        {
          name: 'lodash',
          versionInfo: '4.17.21',
          licenseConcluded: 'MIT'
        },
        {
          name: 'react',
          versionInfo: '18.2.0',
          licenseConcluded: '(MIT OR Apache-2.0)'
        }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    expect(components[0].license).toBe('MIT');
    expect(components[1].license).toBe('(MIT OR Apache-2.0)');
  });

  it('handles SPDX 2.2 format', () => {
    const doc = {
      spdxVersion: 'SPDX-2.2',
      packages: [
        { name: 'axios', versionInfo: '0.21.0' }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    expect(components).toHaveLength(1);
  });

  it('handles missing version', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        { name: 'lodash' }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    expect(components[0].version).toBe('unknown');
  });

  it('handles empty packages array', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: []
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    expect(components).toHaveLength(0);
  });

  it('handles missing packages', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3'
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    expect(components).toHaveLength(0);
  });

  it('handles multiple external refs', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        {
          name: 'lodash',
          versionInfo: '4.17.21',
          externalRefs: [
            {
              referenceCategory: 'SECURITY',
              referenceType: 'cpe23Type',
              referenceLocator: 'cpe:2.3:a:lodash:lodash:4.17.21:*:*:*:*:*:*:*'
            },
            {
              referenceCategory: 'PACKAGE-MANAGER',
              referenceType: 'purl',
              referenceLocator: 'pkg:npm/lodash@4.17.21'
            }
          ]
        }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    expect(components[0].purl).toBe('pkg:npm/lodash@4.17.21');
  });

  it('rejects non-SPDX format', () => {
    const invalid = { bomFormat: 'CycloneDX' };
    
    expect(() => parseSPDX(JSON.stringify(invalid)))
      .toThrow('Not a valid SPDX document');
  });
});

// ============================================================
// Auto-detection Tests
// ============================================================

describe('parseSBOMString (auto-detect)', () => {
  it('auto-detects CycloneDX format', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'lodash', version: '4.17.21' }
      ]
    };
    
    const components = parseSBOMString(JSON.stringify(bom));
    
    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('lodash');
  });

  it('auto-detects SPDX format', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        { name: 'express', versionInfo: '4.18.2' }
      ]
    };
    
    const components = parseSBOMString(JSON.stringify(doc));
    
    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('express');
  });

  it('throws on unknown format', () => {
    const unknown = { format: 'custom', deps: [] };
    
    expect(() => parseSBOMString(JSON.stringify(unknown)))
      .toThrow('Unknown SBOM format');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSBOMString('not json'))
      .toThrow();
  });
});

// ============================================================
// Nested Components & Dependencies (CycloneDX)
// ============================================================

describe('CycloneDX Nested Components', () => {
  it('flattens nested components', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        {
          name: 'parent-lib',
          version: '1.0.0',
          components: [
            { name: 'child-lib-a', version: '2.0.0' },
            { name: 'child-lib-b', version: '3.0.0' }
          ]
        }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components).toHaveLength(3);
    expect(components.map(c => c.name)).toContain('parent-lib');
    expect(components.map(c => c.name)).toContain('child-lib-a');
    expect(components.map(c => c.name)).toContain('child-lib-b');
  });

  it('handles deeply nested components', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        {
          name: 'level-1',
          version: '1.0.0',
          components: [
            {
              name: 'level-2',
              version: '2.0.0',
              components: [
                { name: 'level-3', version: '3.0.0' }
              ]
            }
          ]
        }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components).toHaveLength(3);
    expect(components.map(c => c.name)).toEqual(['level-1', 'level-2', 'level-3']);
  });
});

describe('CycloneDX Dependencies', () => {
  it('parses dependency graph', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'app', version: '1.0.0', 'bom-ref': 'pkg:npm/app@1.0.0' },
        { name: 'lodash', version: '4.17.21', 'bom-ref': 'pkg:npm/lodash@4.17.21' }
      ],
      dependencies: [
        { ref: 'pkg:npm/app@1.0.0', dependsOn: ['pkg:npm/lodash@4.17.21'] }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    const app = components.find(c => c.name === 'app') as Component & { dependsOn?: string[] };
    expect(app.dependsOn).toContain('pkg:npm/lodash@4.17.21');
  });

  it('matches vulnerabilities by bom-ref', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'lodash', version: '4.17.20', 'bom-ref': 'comp-lodash-1' }
      ],
      vulnerabilities: [
        {
          id: 'CVE-2021-23337',
          ratings: [{ severity: 'high' }],
          affects: [{ ref: 'comp-lodash-1' }]
        }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components[0].vulnerabilities).toHaveLength(1);
    expect(components[0].vulnerabilities![0].id).toBe('CVE-2021-23337');
  });
});

describe('SPDX Relationships', () => {
  it('parses DEPENDS_ON relationships', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        { name: 'app', versionInfo: '1.0.0', SPDXID: 'SPDXRef-app' },
        { name: 'lodash', versionInfo: '4.17.21', SPDXID: 'SPDXRef-lodash' }
      ],
      relationships: [
        {
          spdxElementId: 'SPDXRef-app',
          relatedSpdxElement: 'SPDXRef-lodash',
          relationshipType: 'DEPENDS_ON'
        }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    const app = components.find(c => c.name === 'app') as Component & { dependsOn?: string[] };
    expect(app.dependsOn).toContain('lodash@4.17.21');
  });

  it('parses DEPENDENCY_OF relationships', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        { name: 'app', versionInfo: '1.0.0', SPDXID: 'SPDXRef-app' },
        { name: 'util', versionInfo: '2.0.0', SPDXID: 'SPDXRef-util' }
      ],
      relationships: [
        {
          spdxElementId: 'SPDXRef-util',
          relatedSpdxElement: 'SPDXRef-app',
          relationshipType: 'DEPENDENCY_OF'
        }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    const app = components.find(c => c.name === 'app') as Component & { dependsOn?: string[] };
    expect(app.dependsOn).toContain('util@2.0.0');
  });

  it('resolves dependencies with purl', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        { 
          name: 'app', 
          versionInfo: '1.0.0', 
          SPDXID: 'SPDXRef-app'
        },
        { 
          name: 'lodash', 
          versionInfo: '4.17.21', 
          SPDXID: 'SPDXRef-lodash',
          externalRefs: [
            { referenceType: 'purl', referenceLocator: 'pkg:npm/lodash@4.17.21' }
          ]
        }
      ],
      relationships: [
        {
          spdxElementId: 'SPDXRef-app',
          relatedSpdxElement: 'SPDXRef-lodash',
          relationshipType: 'DEPENDS_ON'
        }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    const app = components.find(c => c.name === 'app') as Component & { dependsOn?: string[] };
    expect(app.dependsOn).toContain('pkg:npm/lodash@4.17.21');
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe('SBOM Edge Cases', () => {
  it('handles CycloneDX with scoped npm packages', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: '@babel/core', version: '7.20.0', purl: 'pkg:npm/%40babel/core@7.20.0' }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components[0].name).toBe('@babel/core');
    expect(components[0].ecosystem).toBe('npm');
  });

  it('handles SPDX with NOASSERTION license', () => {
    const doc = {
      spdxVersion: 'SPDX-2.3',
      packages: [
        {
          name: 'unknown-pkg',
          versionInfo: '1.0.0',
          licenseConcluded: 'NOASSERTION'
        }
      ]
    };
    
    const components = parseSPDX(JSON.stringify(doc));
    
    expect(components[0].license).toBe('NOASSERTION');
  });

  it('handles vulnerability affecting multiple components', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'app-a', version: '1.0.0', purl: 'pkg:npm/app-a@1.0.0' },
        { name: 'app-b', version: '2.0.0', purl: 'pkg:npm/app-b@2.0.0' }
      ],
      vulnerabilities: [
        {
          id: 'CVE-2024-SHARED',
          ratings: [{ severity: 'medium' }],
          affects: [
            { ref: 'pkg:npm/app-a@1.0.0' },
            { ref: 'pkg:npm/app-b@2.0.0' }
          ]
        }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components[0].vulnerabilities).toHaveLength(1);
    expect(components[1].vulnerabilities).toHaveLength(1);
    expect(components[0].vulnerabilities![0].id).toBe('CVE-2024-SHARED');
    expect(components[1].vulnerabilities![0].id).toBe('CVE-2024-SHARED');
  });

  it('handles purl without version', () => {
    const bom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [
        { name: 'lodash', version: '4.17.21', purl: 'pkg:npm/lodash' }
      ]
    };
    
    const components = parseCycloneDX(JSON.stringify(bom));
    
    expect(components[0].ecosystem).toBe('npm');
  });
});
