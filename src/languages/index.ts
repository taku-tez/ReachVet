/**
 * ReachVet - Language Adapters Registry
 */

import type { LanguageAdapter, SupportedLanguage } from '../types.js';
import { javascriptAdapter } from './javascript/index.js';
import { pythonAdapter } from './python/index.js';
import { createGoAdapter } from './go/index.js';

// Create Go adapter instance
const goAdapter = createGoAdapter();

// Registry of all language adapters
const adapters = new Map<SupportedLanguage, LanguageAdapter>([
  ['javascript', javascriptAdapter as LanguageAdapter],
  ['typescript', javascriptAdapter as LanguageAdapter],  // Same adapter handles both
  ['python', pythonAdapter as LanguageAdapter],
  ['go', goAdapter as LanguageAdapter],
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
export { pythonAdapter } from './python/index.js';
export { goAdapter } from './go/index.js';
export { BaseLanguageAdapter } from './base.js';
export { GoLanguageAdapter, createGoAdapter, parseGoModFile } from './go/index.js';
