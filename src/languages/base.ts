/**
 * ReachVet - Base Language Adapter
 */

import type { LanguageAdapter, SupportedLanguage, Component, ComponentResult } from '../types.js';

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
  protected notReachable(component: Component, notes?: string[]): ComponentResult {
    return {
      component,
      status: 'not_reachable',
      confidence: 'high',
      notes
    };
  }

  /**
   * Create a "reachable" result
   */
  protected reachable(
    component: Component,
    usage: ComponentResult['usage'],
    confidence: ComponentResult['confidence'] = 'high',
    notes?: string[]
  ): ComponentResult {
    return {
      component,
      status: 'reachable',
      usage,
      confidence,
      notes
    };
  }

  /**
   * Create an "imported" result (imported but usage unclear)
   */
  protected imported(
    component: Component,
    usage: ComponentResult['usage'],
    notes?: string[]
  ): ComponentResult {
    return {
      component,
      status: 'imported',
      usage,
      confidence: 'medium',
      notes
    };
  }

  /**
   * Create an "unknown" result
   */
  protected unknown(component: Component, notes?: string[]): ComponentResult {
    return {
      component,
      status: 'unknown',
      confidence: 'low',
      notes
    };
  }
}
