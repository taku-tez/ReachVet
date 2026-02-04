/**
 * ReachVet - CSV Output Formatter
 *
 * Exports analysis results in CSV format for use with spreadsheets,
 * data analysis tools, and CI/CD pipelines.
 */

import type { ComponentResult, AnalysisWarning, ComponentVulnerability, UsageInfo, CodeLocation } from '../types.js';

/**
 * Options for CSV generation
 */
export interface CSVOptions {
  /** Include header row (default: true) */
  includeHeader?: boolean;
  /** Delimiter character (default: ',') */
  delimiter?: ',' | ';' | '\t';
  /** Quote character (default: '"') */
  quote?: '"' | "'";
  /** Line ending (default: '\n') */
  lineEnding?: '\n' | '\r\n';
  /** Include all dependencies, not just vulnerable ones (default: false) */
  includeAll?: boolean;
  /** Include warnings in output (default: true) */
  includeWarnings?: boolean;
  /** Columns to include (default: all) */
  columns?: CSVColumn[];
}

/**
 * Available CSV columns
 */
export type CSVColumn =
  | 'package'
  | 'version'
  | 'ecosystem'
  | 'reachable'
  | 'vulnerability_id'
  | 'vulnerability_severity'
  | 'vulnerability_summary'
  | 'cvss'
  | 'epss'
  | 'kev'
  | 'fixed_version'
  | 'import_location'
  | 'used_functions';

/**
 * Default columns for CSV output
 */
export const DEFAULT_COLUMNS: CSVColumn[] = [
  'package',
  'version',
  'ecosystem',
  'reachable',
  'vulnerability_id',
  'vulnerability_severity',
  'cvss',
  'fixed_version',
  'import_location',
];

/**
 * Full columns including all available fields
 */
export const ALL_COLUMNS: CSVColumn[] = [
  'package',
  'version',
  'ecosystem',
  'reachable',
  'vulnerability_id',
  'vulnerability_severity',
  'vulnerability_summary',
  'cvss',
  'epss',
  'kev',
  'fixed_version',
  'import_location',
  'used_functions',
];

/**
 * Column headers for CSV output
 */
const COLUMN_HEADERS: Record<CSVColumn, string> = {
  package: 'Package',
  version: 'Version',
  ecosystem: 'Ecosystem',
  reachable: 'Reachable',
  vulnerability_id: 'Vulnerability ID',
  vulnerability_severity: 'Severity',
  vulnerability_summary: 'Summary',
  cvss: 'CVSS',
  epss: 'EPSS',
  kev: 'KEV',
  fixed_version: 'Fixed Version',
  import_location: 'Import Location',
  used_functions: 'Used Functions',
};

/**
 * Represents a row in the CSV output
 */
export interface CSVRow {
  package: string;
  version: string;
  ecosystem: string;
  reachable: string;
  vulnerability_id: string;
  vulnerability_severity: string;
  vulnerability_summary: string;
  cvss: string;
  epss: string;
  kev: string;
  fixed_version: string;
  import_location: string;
  used_functions: string;
}

/**
 * Escape a value for CSV output
 */
function escapeCSVValue(value: string, quote: string, delimiter: string): string {
  // If value contains quote, delimiter, or newline, wrap in quotes and escape inner quotes
  if (value.includes(quote) || value.includes(delimiter) || value.includes('\n') || value.includes('\r')) {
    return `${quote}${value.replace(new RegExp(quote, 'g'), quote + quote)}${quote}`;
  }
  return value;
}

/**
 * Format a row as CSV
 */
function formatRow(values: string[], options: Required<CSVOptions>): string {
  return values
    .map(v => escapeCSVValue(v, options.quote, options.delimiter))
    .join(options.delimiter);
}

/**
 * Extract import location from usage info
 */
function getImportLocation(usage?: UsageInfo): string {
  if (!usage || !usage.locations || usage.locations.length === 0) {
    return '';
  }
  return usage.locations
    .map((loc: CodeLocation) => `${loc.file}:${loc.line || 0}`)
    .join('; ');
}

/**
 * Extract used functions from usage info
 */
function getUsedFunctions(usage?: UsageInfo): string {
  if (!usage || !usage.usedMembers || usage.usedMembers.length === 0) {
    return '';
  }
  return usage.usedMembers.join('; ');
}

/**
 * Extract fixed version from vulnerability data
 */
function getFixedVersion(vuln: ComponentVulnerability): string {
  if (vuln.fixedVersion) {
    return vuln.fixedVersion;
  }
  return '';
}

/**
 * Get severity from vulnerability
 */
function getSeverity(vuln: ComponentVulnerability & { cvss?: number }): string {
  if (vuln.severity) return vuln.severity.toUpperCase();
  if (vuln.cvss !== undefined) {
    if (vuln.cvss >= 9.0) return 'CRITICAL';
    if (vuln.cvss >= 7.0) return 'HIGH';
    if (vuln.cvss >= 4.0) return 'MEDIUM';
    return 'LOW';
  }
  return 'UNKNOWN';
}

/**
 * Check if result is reachable
 */
function isReachable(result: ComponentResult): boolean {
  return result.status === 'reachable' || result.status === 'imported';
}

/**
 * Convert analysis result to CSV rows
 */
function resultToRows(result: ComponentResult, options: Required<CSVOptions>): CSVRow[] {
  const rows: CSVRow[] = [];
  const component = result.component;
  const vulns = component.vulnerabilities || [];

  // If no vulnerabilities, add a single row for the component (if includeAll)
  if (vulns.length === 0) {
    if (options.includeAll) {
      rows.push({
        package: component.name,
        version: component.version || '',
        ecosystem: component.ecosystem || '',
        reachable: isReachable(result) ? 'Yes' : 'No',
        vulnerability_id: '',
        vulnerability_severity: '',
        vulnerability_summary: '',
        cvss: '',
        epss: '',
        kev: '',
        fixed_version: '',
        import_location: getImportLocation(result.usage),
        used_functions: getUsedFunctions(result.usage),
      });
    }
    return rows;
  }

  // Add a row for each vulnerability
  for (const vuln of vulns) {
    const extVuln = vuln as ComponentVulnerability & { cvss?: number; epss?: number; kev?: boolean; summary?: string };
    rows.push({
      package: component.name,
      version: component.version || '',
      ecosystem: component.ecosystem || '',
      reachable: isReachable(result) ? 'Yes' : 'No',
      vulnerability_id: vuln.id,
      vulnerability_severity: getSeverity(extVuln),
      vulnerability_summary: extVuln.summary || vuln.description || '',
      cvss: extVuln.cvss !== undefined ? extVuln.cvss.toString() : '',
      epss: extVuln.epss !== undefined ? extVuln.epss.toString() : '',
      kev: extVuln.kev ? 'Yes' : 'No',
      fixed_version: getFixedVersion(vuln),
      import_location: getImportLocation(result.usage),
      used_functions: getUsedFunctions(result.usage),
    });
  }

  return rows;
}

/**
 * Convert warnings to CSV rows
 */
function warningsToRows(warnings: AnalysisWarning[]): CSVRow[] {
  return warnings.map(warning => ({
    package: warning.location?.file || '',
    version: '',
    ecosystem: '',
    reachable: '',
    vulnerability_id: warning.code,
    vulnerability_severity: warning.severity?.toUpperCase() || 'WARNING',
    vulnerability_summary: warning.message,
    cvss: '',
    epss: '',
    kev: '',
    fixed_version: '',
    import_location: warning.location ? `${warning.location.file}:${warning.location.line || 0}` : '',
    used_functions: '',
  }));
}

/**
 * Convert analysis results to CSV format
 */
export function toCSV(
  results: ComponentResult[],
  options: CSVOptions = {}
): string {
  const opts: Required<CSVOptions> = {
    includeHeader: options.includeHeader ?? true,
    delimiter: options.delimiter ?? ',',
    quote: options.quote ?? '"',
    lineEnding: options.lineEnding ?? '\n',
    includeAll: options.includeAll ?? false,
    includeWarnings: options.includeWarnings ?? true,
    columns: options.columns ?? DEFAULT_COLUMNS,
  };

  const lines: string[] = [];

  // Add header row
  if (opts.includeHeader) {
    const headers = opts.columns.map(col => COLUMN_HEADERS[col]);
    lines.push(formatRow(headers, opts));
  }

  // Convert results to rows
  const allRows: CSVRow[] = [];
  for (const result of results) {
    allRows.push(...resultToRows(result, opts));
  }

  // Add warning rows if requested
  if (opts.includeWarnings) {
    const allWarnings: AnalysisWarning[] = results
      .filter(r => r.warnings && r.warnings.length > 0)
      .flatMap(r => r.warnings || []);
    allRows.push(...warningsToRows(allWarnings));
  }

  // Format rows
  for (const row of allRows) {
    const values = opts.columns.map(col => row[col] || '');
    lines.push(formatRow(values, opts));
  }

  return lines.join(opts.lineEnding);
}

/**
 * Convert multiple project results to CSV (for monorepo analysis)
 */
export function toCSVMultiple(
  projectResults: Array<{ project: string; results: ComponentResult[] }>,
  options: CSVOptions = {}
): string {
  const opts: Required<CSVOptions> = {
    includeHeader: options.includeHeader ?? true,
    delimiter: options.delimiter ?? ',',
    quote: options.quote ?? '"',
    lineEnding: options.lineEnding ?? '\n',
    includeAll: options.includeAll ?? false,
    includeWarnings: options.includeWarnings ?? true,
    columns: options.columns ?? DEFAULT_COLUMNS,
  };

  const lines: string[] = [];

  // Add header row with project column
  if (opts.includeHeader) {
    const headers = ['Project', ...opts.columns.map(col => COLUMN_HEADERS[col])];
    lines.push(formatRow(headers, opts));
  }

  // Convert results to rows
  for (const { project, results } of projectResults) {
    for (const result of results) {
      const rows = resultToRows(result, opts);
      for (const row of rows) {
        const values = [project, ...opts.columns.map(col => row[col] || '')];
        lines.push(formatRow(values, opts));
      }
    }

    // Add warnings
    if (opts.includeWarnings) {
      const warnings: AnalysisWarning[] = results
        .filter(r => r.warnings && r.warnings.length > 0)
        .flatMap(r => r.warnings || []);
      const warningRows = warningsToRows(warnings);
      for (const row of warningRows) {
        const values = [project, ...opts.columns.map(col => row[col] || '')];
        lines.push(formatRow(values, opts));
      }
    }
  }

  return lines.join(opts.lineEnding);
}

/**
 * Generate dependencies-only CSV (no vulnerability info)
 */
export function toDependenciesCSV(
  results: ComponentResult[],
  options: CSVOptions = {}
): string {
  const depsColumns: CSVColumn[] = ['package', 'version', 'ecosystem', 'reachable', 'import_location', 'used_functions'];

  return toCSV(results, {
    ...options,
    columns: depsColumns,
    includeAll: true,
    includeWarnings: false,
  });
}

/**
 * Generate vulnerabilities-only CSV
 */
export function toVulnerabilitiesCSV(
  results: ComponentResult[],
  options: CSVOptions = {}
): string {
  const vulnColumns: CSVColumn[] = [
    'package',
    'version',
    'vulnerability_id',
    'vulnerability_severity',
    'cvss',
    'epss',
    'kev',
    'fixed_version',
    'reachable',
    'vulnerability_summary',
  ];

  // Filter to only vulnerable results
  const vulnerableResults = results.filter(
    r => r.component.vulnerabilities && r.component.vulnerabilities.length > 0
  );

  return toCSV(vulnerableResults, {
    ...options,
    columns: vulnColumns,
    includeAll: false,
    includeWarnings: false,
  });
}

/**
 * Parse CSV back to a simple array of objects
 */
export function parseCSV(csv: string, options: { delimiter?: string; hasHeader?: boolean } = {}): Record<string, string>[] {
  const delimiter = options.delimiter ?? ',';
  const hasHeader = options.hasHeader ?? true;
  const lines = csv.split(/\r?\n/).filter(line => line.trim() !== '');

  if (lines.length === 0) return [];

  const headers = hasHeader
    ? parseCSVLine(lines[0], delimiter)
    : Array.from({ length: parseCSVLine(lines[0], delimiter).length }, (_, i) => `col${i}`);

  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map(line => {
    const values = parseCSVLine(line, delimiter);
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = values[i] || '';
    });
    return obj;
  });
}

/**
 * Parse a single CSV line
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // End of quoted section
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        values.push(current);
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  values.push(current);
  return values;
}

/**
 * Format CSV options for CLI help
 */
export function getCSVHelpText(): string {
  return `
CSV Output Options:
  --csv [file]           Output results in CSV format (stdout or file)
  --csv-delimiter <char> CSV delimiter: comma (default), semicolon, tab
  --csv-all              Include all dependencies, not just vulnerable
  --csv-vulns-only       Include only vulnerability rows (no deps without vulns)
  --csv-deps-only        Include only dependency info (no vulnerability columns)
  --csv-no-header        Omit header row
  --csv-full             Include all available columns (including EPSS, KEV)

Available columns: ${ALL_COLUMNS.join(', ')}
Default columns: ${DEFAULT_COLUMNS.join(', ')}
`.trim();
}
