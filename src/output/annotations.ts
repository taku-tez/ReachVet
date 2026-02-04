/**
 * GitHub Actions Annotations Output
 * 
 * Generates workflow annotations for findings:
 * - ::error - for vulnerable reachable components
 * - ::warning - for reachable components  
 * - ::notice - for imported components
 */

import type { AnalysisOutput, ComponentResult } from '../types.js';

export interface AnnotationOptions {
  /** Include errors for vulnerable reachable components (default: true) */
  errors?: boolean;
  /** Include warnings for reachable components (default: true) */
  warnings?: boolean;
  /** Include notices for imported components (default: false) */
  notices?: boolean;
  /** Maximum annotations to output (GitHub limit is 10 per step) */
  maxAnnotations?: number;
}

export interface Annotation {
  level: 'error' | 'warning' | 'notice';
  title: string;
  message: string;
  file?: string;
  line?: number;
  endLine?: number;
  col?: number;
  endCol?: number;
}

/**
 * Generate GitHub Actions annotations from analysis output
 */
export function generateAnnotations(
  output: AnalysisOutput,
  options: AnnotationOptions = {}
): Annotation[] {
  const {
    errors = true,
    warnings = true,
    notices = false,
    maxAnnotations = 50,
  } = options;

  const annotations: Annotation[] = [];

  for (const result of output.results) {
    if (annotations.length >= maxAnnotations) break;

    const annotation = resultToAnnotation(result, { errors, warnings, notices });
    if (annotation) {
      annotations.push(annotation);
    }
  }

  return annotations;
}

/**
 * Convert a single component result to an annotation
 */
function resultToAnnotation(
  result: ComponentResult,
  options: { errors: boolean; warnings: boolean; notices: boolean }
): Annotation | null {
  const { name, version, vulnerabilities } = result.component;
  const componentId = `${name}@${version}`;
  const hasVulns = vulnerabilities && vulnerabilities.length > 0;
  const location = result.usage?.locations?.[0];

  if (result.status === 'reachable' && hasVulns) {
    if (!options.errors) return null;

    const vulnIds = vulnerabilities!.map(v => v.id).join(', ');
    const affectedFuncs = vulnerabilities!
      .flatMap(v => v.affectedFunctions || [])
      .filter((v, i, a) => a.indexOf(v) === i);
    
    let message = `${componentId} is vulnerable and reachable. Vulnerabilities: ${vulnIds}`;
    if (affectedFuncs.length > 0) {
      message += `. Affected functions: ${affectedFuncs.slice(0, 5).join(', ')}`;
      if (affectedFuncs.length > 5) {
        message += ` and ${affectedFuncs.length - 5} more`;
      }
    }

    return {
      level: 'error',
      title: 'Vulnerable Dependency Reachable',
      message,
      file: location?.file,
      line: location?.line,
    };
  }

  if (result.status === 'reachable' && !hasVulns) {
    if (!options.warnings) return null;

    const usedMembers = result.usage?.usedMembers?.slice(0, 5).join(', ') || '';
    let message = `${componentId} is reachable in your code`;
    if (usedMembers) {
      message += `. Used: ${usedMembers}`;
    }

    return {
      level: 'warning',
      title: 'Dependency Reachable',
      message,
      file: location?.file,
      line: location?.line,
    };
  }

  if (result.status === 'imported') {
    if (!options.notices) return null;

    return {
      level: 'notice',
      title: 'Dependency Imported',
      message: `${componentId} is imported but specific usage is unclear`,
      file: location?.file,
      line: location?.line,
    };
  }

  return null;
}

/**
 * Format annotation as GitHub Actions command
 */
export function formatAnnotation(annotation: Annotation): string {
  const parts: string[] = [];
  
  if (annotation.file) {
    parts.push(`file=${annotation.file}`);
  }
  if (annotation.line !== undefined) {
    parts.push(`line=${annotation.line}`);
  }
  if (annotation.endLine !== undefined) {
    parts.push(`endLine=${annotation.endLine}`);
  }
  if (annotation.col !== undefined) {
    parts.push(`col=${annotation.col}`);
  }
  if (annotation.endCol !== undefined) {
    parts.push(`endCol=${annotation.endCol}`);
  }
  if (annotation.title) {
    parts.push(`title=${annotation.title}`);
  }

  const params = parts.length > 0 ? ` ${parts.join(',')}` : '';
  return `::${annotation.level}${params}::${annotation.message}`;
}

/**
 * Generate and print all annotations to stdout
 */
export function printAnnotations(
  output: AnalysisOutput,
  options: AnnotationOptions = {}
): void {
  const annotations = generateAnnotations(output, options);
  for (const annotation of annotations) {
    console.log(formatAnnotation(annotation));
  }
}

/**
 * Generate annotations as string array
 */
export function annotationsToStrings(
  output: AnalysisOutput,
  options: AnnotationOptions = {}
): string[] {
  const annotations = generateAnnotations(output, options);
  return annotations.map(formatAnnotation);
}
