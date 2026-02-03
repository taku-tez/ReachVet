/**
 * ReachVet - Language Adapters Registry
 */

import type { LanguageAdapter, SupportedLanguage } from '../types.js';
import { javascriptAdapter } from './javascript/index.js';

// Registry of all language adapters
const adapters: Map<SupportedLanguage, LanguageAdapter> = new Map([
  ['javascript', javascriptAdapter],
  ['typescript', javascriptAdapter],  // Same adapter handles both
]);

/**
 * Get adapter for a specific language
 */
export function getAdapter(language: SupportedLanguage): LanguageAdapter | undefined {
  return adapters.get(language);
}

/**
 * Get all registered adapters
 */
export function getAllAdapters(): LanguageAdapter[] {
  // De-duplicate (JS and TS share the same adapter)
  return [...new Set(adapters.values())];
}

/**
 * Auto-detect language from source directory
 */
export async function detectLanguage(sourceDir: string): Promise<SupportedLanguage | null> {
  for (const adapter of getAllAdapters()) {
    if (await adapter.canHandle(sourceDir)) {
      return adapter.language;
    }
  }
  return null;
}

/**
 * List supported languages
 */
export function listSupportedLanguages(): SupportedLanguage[] {
  return [...adapters.keys()];
}

// Export adapters
export { javascriptAdapter } from './javascript/index.js';
export { BaseLanguageAdapter } from './base.js';
