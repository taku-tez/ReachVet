/**
 * Tests for License Compliance Module
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeLicense,
  getLicenseInfo,
  getLicenseCategory,
  isCompatible,
  checkComponent,
  checkLicenseCompliance,
  generateAttribution,
  getKnownLicenses,
  createPolicy,
  PERMISSIVE_POLICY,
  OSI_APPROVED_POLICY,
  NO_AGPL_POLICY,
  COPYLEFT_AWARE_POLICY,
  type LicensePolicy,
} from '../src/license/index.js';
import type { Component, AnalysisOutput, ComponentResult } from '../src/types.js';

// Helper to create mock component
function createComponent(overrides: Partial<Component> = {}): Component {
  return {
    name: 'test-package',
    version: '1.0.0',
    ...overrides,
  };
}

// Helper to create mock analysis output
function createOutput(components: Component[]): AnalysisOutput {
  const results: ComponentResult[] = components.map(c => ({
    component: c,
    status: 'reachable',
    confidence: 'high',
  }));
  
  return {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    sourceDir: '/test',
    language: 'javascript',
    summary: {
      total: components.length,
      reachable: components.length,
      imported: 0,
      notReachable: 0,
      indirect: 0,
      unknown: 0,
      vulnerableReachable: 0,
      warningsCount: 0,
    },
    results,
  };
}

describe('License Normalization', () => {
  it('should normalize common aliases', () => {
    expect(normalizeLicense('Apache 2.0')).toBe('Apache-2.0');
    expect(normalizeLicense('MIT/X11')).toBe('MIT');
    expect(normalizeLicense('GPLv3')).toBe('GPL-3.0');
    expect(normalizeLicense('LGPL v2')).toBe('LGPL-2.1');
    expect(normalizeLicense('BSD')).toBe('BSD-3-Clause');
  });

  it('should handle case-insensitive matching', () => {
    expect(normalizeLicense('mit')).toBe('MIT');
    expect(normalizeLicense('APACHE-2.0')).toBe('Apache-2.0');
    expect(normalizeLicense('Gpl-3.0')).toBe('GPL-3.0');
  });

  it('should preserve unknown licenses', () => {
    expect(normalizeLicense('Custom-License')).toBe('Custom-License');
    expect(normalizeLicense('Proprietary')).toBe('Proprietary');
  });

  it('should trim whitespace', () => {
    expect(normalizeLicense('  MIT  ')).toBe('MIT');
  });
});

describe('License Info', () => {
  it('should return info for known licenses', () => {
    const mit = getLicenseInfo('MIT');
    expect(mit).not.toBeNull();
    expect(mit!.category).toBe('permissive');
    expect(mit!.osiApproved).toBe(true);
    expect(mit!.copyleft).toBe(false);
  });

  it('should return info for GPL licenses', () => {
    const gpl3 = getLicenseInfo('GPL-3.0');
    expect(gpl3).not.toBeNull();
    expect(gpl3!.category).toBe('strong-copyleft');
    expect(gpl3!.copyleft).toBe(true);
    expect(gpl3!.patentGrant).toBe(true);
  });

  it('should return info for AGPL', () => {
    const agpl = getLicenseInfo('AGPL-3.0');
    expect(agpl).not.toBeNull();
    expect(agpl!.networkCopyleft).toBe(true);
  });

  it('should return null for unknown licenses', () => {
    expect(getLicenseInfo('Unknown-License')).toBeNull();
  });

  it('should work with aliases', () => {
    const info = getLicenseInfo('Apache 2.0');
    expect(info).not.toBeNull();
    expect(info!.id).toBe('Apache-2.0');
  });
});

describe('License Category', () => {
  it('should categorize permissive licenses', () => {
    expect(getLicenseCategory('MIT')).toBe('permissive');
    expect(getLicenseCategory('ISC')).toBe('permissive');
    expect(getLicenseCategory('BSD-3-Clause')).toBe('permissive');
    expect(getLicenseCategory('Apache-2.0')).toBe('permissive');
  });

  it('should categorize weak copyleft', () => {
    expect(getLicenseCategory('LGPL-2.1')).toBe('weak-copyleft');
    expect(getLicenseCategory('LGPL-3.0')).toBe('weak-copyleft');
    expect(getLicenseCategory('MPL-2.0')).toBe('weak-copyleft');
  });

  it('should categorize strong copyleft', () => {
    expect(getLicenseCategory('GPL-2.0')).toBe('strong-copyleft');
    expect(getLicenseCategory('GPL-3.0')).toBe('strong-copyleft');
    expect(getLicenseCategory('AGPL-3.0')).toBe('strong-copyleft');
  });

  it('should categorize public domain', () => {
    expect(getLicenseCategory('CC0-1.0')).toBe('public-domain');
    expect(getLicenseCategory('Unlicense')).toBe('public-domain');
    expect(getLicenseCategory('0BSD')).toBe('public-domain');
  });

  it('should return unknown for unrecognized licenses', () => {
    expect(getLicenseCategory('Some-Unknown-License')).toBe('unknown');
  });
});

describe('License Compatibility', () => {
  it('should allow permissive + permissive', () => {
    expect(isCompatible('MIT', 'Apache-2.0')).toBe(true);
    expect(isCompatible('BSD-3-Clause', 'ISC')).toBe(true);
  });

  it('should allow public domain with anything', () => {
    expect(isCompatible('CC0-1.0', 'GPL-3.0')).toBe(true);
    expect(isCompatible('GPL-3.0', 'Unlicense')).toBe(true);
  });

  it('should allow permissive with copyleft', () => {
    expect(isCompatible('MIT', 'GPL-3.0')).toBe(true);
    expect(isCompatible('Apache-2.0', 'LGPL-3.0')).toBe(true);
  });

  it('should handle unknown licenses gracefully', () => {
    expect(isCompatible('Unknown', 'MIT')).toBe(true);
    expect(isCompatible('MIT', 'Unknown')).toBe(true);
  });
});

describe('Policy Checking - Component', () => {
  it('should pass permissive license with permissive policy', () => {
    const component = createComponent({ license: 'MIT' });
    const result = checkComponent(component, PERMISSIVE_POLICY);
    
    expect(result.status).toBe('pass');
    expect(result.violation).toBeNull();
    expect(result.licenseInfo?.category).toBe('permissive');
  });

  it('should fail copyleft with permissive policy', () => {
    const component = createComponent({ license: 'GPL-3.0' });
    const result = checkComponent(component, PERMISSIVE_POLICY);
    
    expect(result.status).toBe('fail');
    expect(result.violation).not.toBeNull();
    expect(result.violation!.severity).toBe('error');
  });

  it('should warn on copyleft with copyleft-aware policy', () => {
    const component = createComponent({ license: 'LGPL-3.0' });
    const result = checkComponent(component, COPYLEFT_AWARE_POLICY);
    
    expect(result.status).toBe('warn');
    expect(result.violation).not.toBeNull();
    expect(result.violation!.severity).toBe('warning');
  });

  it('should deny AGPL with no-agpl policy', () => {
    const component = createComponent({ license: 'AGPL-3.0' });
    const result = checkComponent(component, NO_AGPL_POLICY);
    
    expect(result.status).toBe('fail');
    expect(result.violation!.rule.reason).toContain('network use');
  });

  it('should handle missing license', () => {
    const component = createComponent({ license: undefined });
    const result = checkComponent(component, PERMISSIVE_POLICY);
    
    expect(result.status).toBe('unknown');
    expect(result.license).toBeUndefined();
  });

  it('should handle unknown license with default action', () => {
    const component = createComponent({ license: 'Custom-Proprietary' });
    
    const denyResult = checkComponent(component, PERMISSIVE_POLICY);
    expect(denyResult.status).toBe('fail');
    
    const warnResult = checkComponent(component, OSI_APPROVED_POLICY);
    expect(warnResult.status).toBe('warn');
    
    const allowResult = checkComponent(component, NO_AGPL_POLICY);
    expect(allowResult.status).toBe('pass');
  });
});

describe('Policy Checking - Compliance Report', () => {
  it('should generate compliance report', () => {
    const components = [
      createComponent({ name: 'pkg-a', license: 'MIT' }),
      createComponent({ name: 'pkg-b', license: 'Apache-2.0' }),
      createComponent({ name: 'pkg-c', license: 'GPL-3.0' }),
    ];
    const output = createOutput(components);
    
    const report = checkLicenseCompliance(output, PERMISSIVE_POLICY);
    
    expect(report.summary.total).toBe(3);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failures).toBe(1);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].component).toBe('pkg-c');
  });

  it('should count by category', () => {
    const components = [
      createComponent({ name: 'a', license: 'MIT' }),
      createComponent({ name: 'b', license: 'ISC' }),
      createComponent({ name: 'c', license: 'LGPL-3.0' }),
      createComponent({ name: 'd', license: 'CC0-1.0' }),
    ];
    const output = createOutput(components);
    
    const report = checkLicenseCompliance(output);
    
    expect(report.byCategory.permissive).toBe(2);
    expect(report.byCategory['weak-copyleft']).toBe(1);
    expect(report.byCategory['public-domain']).toBe(1);
  });

  it('should use default policy if not specified', () => {
    const components = [createComponent({ license: 'MIT' })];
    const output = createOutput(components);
    
    const report = checkLicenseCompliance(output);
    
    expect(report.policy).toBe('copyleft-aware');
  });

  it('should track unknown licenses', () => {
    const components = [
      createComponent({ name: 'known', license: 'MIT' }),
      createComponent({ name: 'no-license' }),
    ];
    const output = createOutput(components);
    
    const report = checkLicenseCompliance(output);
    
    expect(report.summary.unknown).toBe(1);
  });
});

describe('Custom Policy', () => {
  it('should create custom policy', () => {
    const policy = createPolicy('my-policy', 'deny', [
      { type: 'allow', licenses: ['MIT', 'ISC', 'BSD-3-Clause'] },
      { type: 'warn', categories: ['weak-copyleft'] },
    ]);
    
    expect(policy.name).toBe('my-policy');
    expect(policy.defaultAction).toBe('deny');
    expect(policy.rules).toHaveLength(2);
  });

  it('should work with custom policy', () => {
    const policy = createPolicy('strict', 'deny', [
      { type: 'allow', licenses: ['MIT'], reason: 'Only MIT allowed' },
    ]);
    
    const mitResult = checkComponent(createComponent({ license: 'MIT' }), policy);
    expect(mitResult.status).toBe('pass');
    
    const apacheResult = checkComponent(createComponent({ license: 'Apache-2.0' }), policy);
    expect(apacheResult.status).toBe('fail');
  });

  it('should support wildcard licenses', () => {
    const policy = createPolicy('allow-gpl', 'deny', [
      { type: 'allow', licenses: ['GPL-*'] },
    ]);
    
    const gpl2 = checkComponent(createComponent({ license: 'GPL-2.0' }), policy);
    expect(gpl2.status).toBe('pass');
    
    const gpl3 = checkComponent(createComponent({ license: 'GPL-3.0' }), policy);
    expect(gpl3.status).toBe('pass');
    
    const mit = checkComponent(createComponent({ license: 'MIT' }), policy);
    expect(mit.status).toBe('fail');
  });
});

describe('Attribution Generation', () => {
  it('should generate attribution notice', () => {
    const components = [
      createComponent({ name: 'lodash', version: '4.17.21', license: 'MIT' }),
      createComponent({ name: 'express', version: '4.18.0', license: 'MIT' }),
      createComponent({ name: 'winston', version: '3.0.0', license: 'MIT' }),
      createComponent({ name: 'react', version: '18.0.0', license: 'MIT' }),
    ];
    const output = createOutput(components);
    
    const attribution = generateAttribution(output);
    
    expect(attribution).toContain('# Third-Party License Attribution');
    expect(attribution).toContain('MIT License');
    expect(attribution).toContain('lodash@4.17.21');
    expect(attribution).toContain('express@4.18.0');
  });

  it('should group by license', () => {
    const components = [
      createComponent({ name: 'mit-pkg', license: 'MIT' }),
      createComponent({ name: 'apache-pkg', license: 'Apache-2.0' }),
      createComponent({ name: 'another-mit', license: 'MIT' }),
    ];
    const output = createOutput(components);
    
    const attribution = generateAttribution(output);
    
    // MIT should appear once as a section
    const mitMatches = attribution.match(/### MIT License/g);
    expect(mitMatches).toHaveLength(1);
    
    // Both MIT packages should be under the same section
    const mitSection = attribution.split('### MIT License')[1].split('###')[0];
    expect(mitSection).toContain('mit-pkg');
    expect(mitSection).toContain('another-mit');
  });

  it('should handle unknown licenses', () => {
    const components = [
      createComponent({ name: 'unknown-pkg', license: 'Custom-License' }),
    ];
    const output = createOutput(components);
    
    const attribution = generateAttribution(output);
    
    expect(attribution).toContain('Custom-License');
    expect(attribution).toContain('unknown-pkg');
  });

  it('should handle missing licenses', () => {
    const components = [
      createComponent({ name: 'no-license-pkg' }),
    ];
    const output = createOutput(components);
    
    const attribution = generateAttribution(output);
    
    expect(attribution).toContain('Unknown');
    expect(attribution).toContain('no-license-pkg');
  });
});

describe('Known Licenses', () => {
  it('should return list of known licenses', () => {
    const licenses = getKnownLicenses();
    
    expect(licenses).toContain('MIT');
    expect(licenses).toContain('Apache-2.0');
    expect(licenses).toContain('GPL-3.0');
    expect(licenses).toContain('LGPL-3.0');
    expect(licenses.length).toBeGreaterThan(20);
  });
});

describe('Predefined Policies', () => {
  it('should have permissive policy', () => {
    expect(PERMISSIVE_POLICY.name).toBe('permissive-only');
    expect(PERMISSIVE_POLICY.defaultAction).toBe('deny');
  });

  it('should have OSI approved policy', () => {
    expect(OSI_APPROVED_POLICY.name).toBe('osi-approved');
    expect(OSI_APPROVED_POLICY.defaultAction).toBe('warn');
  });

  it('should have no-AGPL policy', () => {
    expect(NO_AGPL_POLICY.name).toBe('no-agpl');
    expect(NO_AGPL_POLICY.defaultAction).toBe('allow');
  });

  it('should have copyleft-aware policy', () => {
    expect(COPYLEFT_AWARE_POLICY.name).toBe('copyleft-aware');
    expect(COPYLEFT_AWARE_POLICY.defaultAction).toBe('allow');
  });
});

describe('Edge Cases', () => {
  it('should handle empty output', () => {
    const output = createOutput([]);
    const report = checkLicenseCompliance(output);
    
    expect(report.summary.total).toBe(0);
    expect(report.summary.passed).toBe(0);
    expect(report.violations).toHaveLength(0);
  });

  it('should normalize before checking', () => {
    const component = createComponent({ license: 'Apache 2.0' });
    const result = checkComponent(component, PERMISSIVE_POLICY);
    
    expect(result.license).toBe('Apache-2.0');
    expect(result.status).toBe('pass');
  });

  it('should handle SPDX expressions (basic)', () => {
    // Note: Full SPDX expression parsing not implemented
    // This tests that unknown expressions are handled gracefully
    const component = createComponent({ license: 'MIT OR Apache-2.0' });
    const result = checkComponent(component, PERMISSIVE_POLICY);
    
    // Will be treated as unknown since expression parsing not implemented
    expect(result.status).toBe('fail'); // Default deny
  });
});
