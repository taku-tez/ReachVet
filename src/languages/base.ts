/**
 * ReachVet - Base Language Adapter
 */

import type { LanguageAdapter, SupportedLanguage, Component, ComponentResult, AnalysisWarning } from '../types.js';

/**
 * Abstract base class for language adapters
 */
export abstract class BaseLanguageAdapter implements LanguageAdapter {
  abstract language: SupportedLanguage;
  abstract fileExtensions: string[];

  abstract analyze(sourceDir: string, components: Component[]): Promise<ComponentResult[]>;
  abstract canHandle(sourceDir: string): Promise<boolean>;

  /**
   * Create a "not reachable" result
   */
  protected notReachable(component: Component, notes?: string[], warnings?: AnalysisWarning[]): ComponentResult {
    return {
      component,
      status: 'not_reachable',
      confidence: 'high',
      notes,
      warnings: warnings?.length ? warnings : undefined
    };
  }

  /**
   * Create a "reachable" result
   */
  protected reachable(
    component: Component,
    usage: ComponentResult['usage'],
    confidence: ComponentResult['confidence'] = 'high',
    notes?: string[],
    warnings?: AnalysisWarning[]
  ): ComponentResult {
    return {
      component,
      status: 'reachable',
      usage,
      confidence,
      notes,
      warnings: warnings?.length ? warnings : undefined
    };
  }

  /**
   * Create an "imported" result (imported but usage unclear)
   */
  protected imported(
    component: Component,
    usage: ComponentResult['usage'],
    notes?: string[],
    warnings?: AnalysisWarning[]
  ): ComponentResult {
    return {
      component,
      status: 'imported',
      usage,
      confidence: 'medium',
      notes,
      warnings: warnings?.length ? warnings : undefined
    };
  }

  /**
   * Create an "unknown" result
   */
  protected unknown(component: Component, notes?: string[], warnings?: AnalysisWarning[]): ComponentResult {
    return {
      component,
      status: 'unknown',
      confidence: 'low',
      notes,
      warnings: warnings?.length ? warnings : undefined
    };
  }
}
