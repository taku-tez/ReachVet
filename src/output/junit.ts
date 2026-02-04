/**
 * JUnit XML output format for CI/CD integration
 * Compatible with Jenkins, GitLab CI, Azure DevOps, CircleCI, etc.
 */

import type { AnalysisOutput, ComponentResult, AnalysisWarning } from '../types.js';

export interface JUnitOptions {
  /** Test suite name (default: 'ReachVet Analysis') */
  suiteName?: string;
  /** Include warnings as test cases */
  includeWarnings?: boolean;
  /** Include all dependencies (not just vulnerable/reachable) */
  includeAll?: boolean;
  /** Pretty print XML */
  pretty?: boolean;
}

interface TestCase {
  name: string;
  classname: string;
  time: number;
  failure?: {
    message: string;
    type: string;
    content: string;
  };
  skipped?: {
    message: string;
  };
}

interface TestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  timestamp: string;
  testcases: TestCase[];
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format duration in seconds
 */
function formatTime(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * Create test case from component result
 */
function createComponentTestCase(result: ComponentResult, analysisTime: number): TestCase {
  const { component, status, usage } = result;
  const classname = `reachvet.dependencies.${component.ecosystem || 'unknown'}`;
  const name = `${component.name}@${component.version || 'unknown'}`;
  
  const testCase: TestCase = {
    name,
    classname,
    time: analysisTime / 1000
  };
  
  const hasVuln = component.vulnerabilities && component.vulnerabilities.length > 0;
  const isReachable = status === 'reachable' || status === 'imported';
  
  if (hasVuln && isReachable) {
    // Vulnerable and reachable - failure
    const vulns = component.vulnerabilities!;
    testCase.failure = {
      type: 'VulnerableReachable',
      message: `${vulns.length} vulnerability(ies) in reachable dependency`,
      content: vulns.map(v => 
        `ID: ${v.id}\n` +
        `Severity: ${v.severity || 'unknown'}\n` +
        (v.affectedFunctions ? `Affected: ${v.affectedFunctions.join(', ')}\n` : '') +
        (usage?.usedMembers ? `Used: ${usage.usedMembers.join(', ')}` : '')
      ).join('\n\n')
    };
  } else if (hasVuln) {
    // Has vulnerabilities but not reachable - skipped (informational)
    const vulns = component.vulnerabilities!;
    testCase.skipped = {
      message: `${vulns.length} vulnerability(ies) found but not reachable (status: ${status})`
    };
  }
  
  return testCase;
}

/**
 * Create test case from warning
 */
function createWarningTestCase(warning: AnalysisWarning, componentName: string): TestCase {
  const classname = `reachvet.warnings.${warning.code}`;
  const name = `${componentName}: ${warning.message}`;
  
  const testCase: TestCase = {
    name,
    classname,
    time: 0
  };
  
  if (warning.severity === 'warning') {
    testCase.skipped = {
      message: warning.location ? `${warning.location.file}:${warning.location.line}` : ''
    };
  }
  
  return testCase;
}

/**
 * Convert AnalysisOutput to JUnit XML format
 */
export function toJUnitXml(output: AnalysisOutput, options: JUnitOptions = {}): string {
  const {
    suiteName = 'ReachVet Analysis',
    includeWarnings = true,
    includeAll = false,
    pretty = true
  } = options;
  
  const testcases: TestCase[] = [];
  const analysisTime = output.metadata?.analysisDurationMs || 0;
  const perDepTime = output.results.length > 0 
    ? analysisTime / output.results.length 
    : 0;
  
  // Add component test cases
  for (const result of output.results) {
    const hasVuln = result.component.vulnerabilities && result.component.vulnerabilities.length > 0;
    const isReachable = result.status === 'reachable' || result.status === 'imported';
    
    if (includeAll || hasVuln || isReachable) {
      testcases.push(createComponentTestCase(result, perDepTime));
    }
    
    // Add warning test cases for this component
    if (includeWarnings && result.warnings) {
      for (const warning of result.warnings) {
        testcases.push(createWarningTestCase(warning, result.component.name));
      }
    }
  }
  
  // Calculate totals
  const failures = testcases.filter(tc => tc.failure).length;
  const skipped = testcases.filter(tc => tc.skipped && !tc.failure).length;
  
  const suite: TestSuite = {
    name: suiteName,
    tests: testcases.length,
    failures,
    errors: 0,
    skipped,
    time: analysisTime / 1000,
    timestamp: new Date().toISOString(),
    testcases
  };
  
  return renderJUnitXml(suite, pretty);
}

/**
 * Render TestSuite to XML string
 */
function renderJUnitXml(suite: TestSuite, pretty: boolean): string {
  const indent = pretty ? '  ' : '';
  const nl = pretty ? '\n' : '';
  
  let xml = '<?xml version="1.0" encoding="UTF-8"?>' + nl;
  
  xml += `<testsuites tests="${suite.tests}" failures="${suite.failures}" errors="${suite.errors}" time="${formatTime(suite.time * 1000)}">` + nl;
  
  xml += `${indent}<testsuite name="${escapeXml(suite.name)}" tests="${suite.tests}" failures="${suite.failures}" errors="${suite.errors}" skipped="${suite.skipped}" time="${formatTime(suite.time * 1000)}" timestamp="${suite.timestamp}">` + nl;
  
  for (const tc of suite.testcases) {
    xml += `${indent}${indent}<testcase name="${escapeXml(tc.name)}" classname="${escapeXml(tc.classname)}" time="${formatTime(tc.time * 1000)}">` + nl;
    
    if (tc.failure) {
      xml += `${indent}${indent}${indent}<failure type="${escapeXml(tc.failure.type)}" message="${escapeXml(tc.failure.message)}">` + nl;
      xml += escapeXml(tc.failure.content) + nl;
      xml += `${indent}${indent}${indent}</failure>` + nl;
    }
    
    if (tc.skipped) {
      xml += `${indent}${indent}${indent}<skipped message="${escapeXml(tc.skipped.message)}"/>` + nl;
    }
    
    xml += `${indent}${indent}</testcase>` + nl;
  }
  
  xml += `${indent}</testsuite>` + nl;
  xml += '</testsuites>' + nl;
  
  return xml;
}

/**
 * Convert multiple AnalysisOutputs to JUnit XML format
 * Useful for multi-project/monorepo analysis
 */
export function toJUnitXmlMultiple(
  results: Array<{ name: string; output: AnalysisOutput }>,
  options: JUnitOptions = {}
): string {
  const { pretty = true, includeWarnings = true, includeAll = false } = options;
  
  const indent = pretty ? '  ' : '';
  const nl = pretty ? '\n' : '';
  
  let totalTests = 0;
  let totalFailures = 0;
  let totalErrors = 0;
  let totalTime = 0;
  
  const suites: string[] = [];
  
  for (const { name, output } of results) {
    const testcases: TestCase[] = [];
    const analysisTime = output.metadata?.analysisDurationMs || 0;
    const perDepTime = output.results.length > 0 
      ? analysisTime / output.results.length 
      : 0;
    
    for (const result of output.results) {
      const hasVuln = result.component.vulnerabilities && result.component.vulnerabilities.length > 0;
      const isReachable = result.status === 'reachable' || result.status === 'imported';
      
      if (includeAll || hasVuln || isReachable) {
        testcases.push(createComponentTestCase(result, perDepTime));
      }
      
      if (includeWarnings && result.warnings) {
        for (const warning of result.warnings) {
          testcases.push(createWarningTestCase(warning, result.component.name));
        }
      }
    }
    
    const failures = testcases.filter(tc => tc.failure).length;
    const skipped = testcases.filter(tc => tc.skipped && !tc.failure).length;
    
    totalTests += testcases.length;
    totalFailures += failures;
    totalTime += analysisTime;
    
    let suiteXml = `${indent}<testsuite name="${escapeXml(name)}" tests="${testcases.length}" failures="${failures}" errors="0" skipped="${skipped}" time="${formatTime(analysisTime)}" timestamp="${new Date().toISOString()}">` + nl;
    
    for (const tc of testcases) {
      suiteXml += `${indent}${indent}<testcase name="${escapeXml(tc.name)}" classname="${escapeXml(tc.classname)}" time="${formatTime(tc.time * 1000)}">` + nl;
      
      if (tc.failure) {
        suiteXml += `${indent}${indent}${indent}<failure type="${escapeXml(tc.failure.type)}" message="${escapeXml(tc.failure.message)}">` + nl;
        suiteXml += escapeXml(tc.failure.content) + nl;
        suiteXml += `${indent}${indent}${indent}</failure>` + nl;
      }
      
      if (tc.skipped) {
        suiteXml += `${indent}${indent}${indent}<skipped message="${escapeXml(tc.skipped.message)}"/>` + nl;
      }
      
      suiteXml += `${indent}${indent}</testcase>` + nl;
    }
    
    suiteXml += `${indent}</testsuite>`;
    suites.push(suiteXml);
  }
  
  let xml = '<?xml version="1.0" encoding="UTF-8"?>' + nl;
  xml += `<testsuites tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" time="${formatTime(totalTime)}">` + nl;
  xml += suites.join(nl) + nl;
  xml += '</testsuites>' + nl;
  
  return xml;
}
