/**
 * JUnit XML output format for CI/CD integration
 * Compatible with Jenkins, GitLab CI, Azure DevOps, CircleCI, etc.
 */

import type { ReachabilityResult, DependencyInfo, VulnerableFunction, AnalysisWarning } from '../types.js';

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
 * Create test case from dependency
 */
function createDependencyTestCase(dep: DependencyInfo, analysisTime: number): TestCase {
  const classname = `reachvet.dependencies.${dep.ecosystem || 'unknown'}`;
  const name = `${dep.name}@${dep.version || 'unknown'}`;
  
  const testCase: TestCase = {
    name,
    classname,
    time: analysisTime / 1000
  };
  
  if (dep.vulnerableFunctions && dep.vulnerableFunctions.length > 0) {
    const reachable = dep.vulnerableFunctions.filter(vf => vf.isReachable);
    if (reachable.length > 0) {
      // Vulnerable and reachable - failure
      testCase.failure = {
        type: 'VulnerableReachable',
        message: `${reachable.length} vulnerable function(s) reachable`,
        content: reachable.map(vf => 
          `Function: ${vf.functionName}\n` +
          `CVE: ${vf.cveId || 'N/A'}\n` +
          `Severity: ${vf.severity || 'unknown'}\n` +
          `Location: ${vf.location || 'N/A'}`
        ).join('\n\n')
      };
    } else {
      // Has vulnerable functions but not reachable - skipped
      testCase.skipped = {
        message: `${dep.vulnerableFunctions.length} vulnerable function(s) found but not reachable`
      };
    }
  }
  
  return testCase;
}

/**
 * Create test case from warning
 */
function createWarningTestCase(warning: AnalysisWarning): TestCase {
  const classname = `reachvet.warnings.${warning.code}`;
  const name = warning.message;
  
  const testCase: TestCase = {
    name,
    classname,
    time: 0
  };
  
  if (warning.severity === 'error') {
    testCase.failure = {
      type: warning.code,
      message: warning.message,
      content: warning.location ? `Location: ${warning.location.file}:${warning.location.line}` : ''
    };
  } else if (warning.severity === 'warning') {
    testCase.skipped = {
      message: warning.location ? `${warning.location.file}:${warning.location.line}` : ''
    };
  }
  
  return testCase;
}

/**
 * Convert ReachabilityResult to JUnit XML format
 */
export function toJUnitXml(result: ReachabilityResult, options: JUnitOptions = {}): string {
  const {
    suiteName = 'ReachVet Analysis',
    includeWarnings = true,
    includeAll = false,
    pretty = true
  } = options;
  
  const testcases: TestCase[] = [];
  const analysisTime = result.summary.analysisTimeMs || 0;
  const perDepTime = result.dependencies.length > 0 
    ? analysisTime / result.dependencies.length 
    : 0;
  
  // Add dependency test cases
  for (const dep of result.dependencies) {
    const hasIssues = dep.vulnerableFunctions && dep.vulnerableFunctions.length > 0;
    
    if (includeAll || hasIssues || dep.isReachable) {
      testcases.push(createDependencyTestCase(dep, perDepTime));
    }
  }
  
  // Add warning test cases
  if (includeWarnings && result.warnings) {
    for (const warning of result.warnings) {
      testcases.push(createWarningTestCase(warning));
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
 * Convert multiple ReachabilityResults to JUnit XML format
 * Useful for multi-project/monorepo analysis
 */
export function toJUnitXmlMultiple(
  results: Array<{ name: string; result: ReachabilityResult }>,
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
  
  for (const { name, result } of results) {
    const testcases: TestCase[] = [];
    const analysisTime = result.summary.analysisTimeMs || 0;
    const perDepTime = result.dependencies.length > 0 
      ? analysisTime / result.dependencies.length 
      : 0;
    
    for (const dep of result.dependencies) {
      const hasIssues = dep.vulnerableFunctions && dep.vulnerableFunctions.length > 0;
      
      if (includeAll || hasIssues || dep.isReachable) {
        testcases.push(createDependencyTestCase(dep, perDepTime));
      }
    }
    
    if (includeWarnings && result.warnings) {
      for (const warning of result.warnings) {
        testcases.push(createWarningTestCase(warning));
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
