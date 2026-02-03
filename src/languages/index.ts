/**
 * ReachVet - Language Adapters Registry
 */

import type { LanguageAdapter, SupportedLanguage } from '../types.js';
import { javascriptAdapter } from './javascript/index.js';
import { pythonAdapter } from './python/index.js';
import { createGoAdapter } from './go/index.js';
import { createJavaAdapter } from './java/index.js';
import { createRustAdapter } from './rust/index.js';
import { rubyAdapter } from './ruby/index.js';
import { phpAdapter } from './php/index.js';
import { csharpAdapter } from './csharp/index.js';
import { swiftAdapter } from './swift/index.js';
import { kotlinAdapter } from './kotlin/index.js';
import { scalaAdapter } from './scala/index.js';
import { elixirAdapter } from './elixir/index.js';
import { dartAdapter } from './dart/index.js';

// Create adapter instances
const goAdapter = createGoAdapter();
const javaAdapter = createJavaAdapter();
const rustAdapter = createRustAdapter();

// Registry of all language adapters
const adapters = new Map<SupportedLanguage, LanguageAdapter>([
  ['javascript', javascriptAdapter as LanguageAdapter],
  ['typescript', javascriptAdapter as LanguageAdapter],  // Same adapter handles both
  ['python', pythonAdapter as LanguageAdapter],
  ['go', goAdapter as LanguageAdapter],
  ['java', javaAdapter as LanguageAdapter],
  ['rust', rustAdapter as LanguageAdapter],
  ['ruby', rubyAdapter as LanguageAdapter],
  ['php', phpAdapter as LanguageAdapter],
  ['csharp', csharpAdapter as LanguageAdapter],
  ['swift', swiftAdapter as LanguageAdapter],
  ['kotlin', kotlinAdapter as LanguageAdapter],
  ['scala', scalaAdapter as LanguageAdapter],
  ['elixir', elixirAdapter as LanguageAdapter],
  ['dart', dartAdapter as LanguageAdapter],
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
export { javaAdapter } from './java/index.js';
export { rustAdapter } from './rust/index.js';
export { BaseLanguageAdapter } from './base.js';
export { GoLanguageAdapter, createGoAdapter, parseGoModFile } from './go/index.js';
export { JavaLanguageAdapter, createJavaAdapter, parsePomFile, parseGradleFile } from './java/index.js';
export { RustLanguageAdapter, createRustAdapter, parseCargoTomlFile } from './rust/index.js';
export { rubyAdapter } from './ruby/index.js';
export { phpAdapter } from './php/index.js';
export { csharpAdapter } from './csharp/index.js';
export { swiftAdapter } from './swift/index.js';
export { kotlinAdapter } from './kotlin/index.js';
export { scalaAdapter } from './scala/index.js';
export { elixirAdapter } from './elixir/index.js';
export { dartAdapter } from './dart/index.js';
