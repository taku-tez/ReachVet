# Contributing to ReachVet

Thank you for your interest in contributing to ReachVet! This guide will help you get started.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Adding a New Language](#adding-a-new-language)
- [Testing](#testing)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)

---

## Development Setup

### Prerequisites

- Node.js 18+ 
- npm 9+
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/taku-tez/ReachVet.git
cd ReachVet

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run in development mode
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build TypeScript |
| `npm test` | Run tests |
| `npm run test:watch` | Watch mode tests |
| `npm run test:coverage` | Coverage report |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix lint issues |
| `npm run typecheck` | TypeScript check |
| `npm run dev` | Development mode |

---

## Project Structure

```
ReachVet/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── index.ts            # Library exports
│   ├── types.ts            # Type definitions
│   ├── core/
│   │   └── analyzer.ts     # Main analyzer
│   ├── languages/
│   │   ├── base.ts         # Base adapter
│   │   ├── index.ts        # Language registry
│   │   ├── javascript/     # JS/TS adapter
│   │   ├── python/         # Python adapter
│   │   ├── go/             # Go adapter
│   │   └── ...             # Other languages
│   ├── input/
│   │   ├── sbom.ts         # SBOM parsing
│   │   └── simple.ts       # Simple JSON
│   ├── output/
│   │   ├── sarif.ts        # SARIF output
│   │   ├── junit.ts        # JUnit XML
│   │   ├── csv.ts          # CSV output
│   │   └── ...
│   ├── osv/                # OSV.dev client
│   ├── epss/               # EPSS client
│   ├── kev/                # KEV client
│   ├── cache/              # Caching
│   └── watch/              # Watch mode
├── tests/                  # Integration tests
├── src/__tests__/          # Unit tests
├── docs/                   # Documentation
└── action.yml              # GitHub Action
```

---

## Adding a New Language

> **Note:** Language support is feature-complete (18 languages). New languages may not be accepted unless there's significant demand.

### 1. Create Adapter Directory

```bash
mkdir -p src/languages/newlang
```

### 2. Implement Parser

Create `src/languages/newlang/parser.ts`:

```typescript
import type { CodeLocation } from '../../types.js';

export interface NewLangImportInfo {
  // Import path or module name
  path: string;
  // Imported items
  items: string[];
  // Is wildcard import
  isWildcard?: boolean;
  // Location in source
  location: CodeLocation;
}

/**
 * Parse source code and extract imports
 */
export function parseNewLangSource(
  source: string, 
  file: string
): NewLangImportInfo[] {
  const imports: NewLangImportInfo[] = [];
  // Implement parsing logic
  return imports;
}

/**
 * Find usages of an import in source code
 */
export function findUsages(
  source: string,
  importPath: string
): string[] {
  const usages: string[] = [];
  // Implement usage detection
  return usages;
}
```

### 3. Implement Adapter

Create `src/languages/newlang/index.ts`:

```typescript
import { BaseLanguageAdapter } from '../base.js';
import { parseNewLangSource, findUsages } from './parser.js';
import type { 
  Component, 
  ComponentResult, 
  SupportedLanguage 
} from '../../types.js';

export class NewLangAdapter extends BaseLanguageAdapter {
  readonly language: SupportedLanguage = 'newlang';
  readonly fileExtensions = ['.ext'];

  async canHandle(sourceDir: string): Promise<boolean> {
    // Check for language-specific files
    // e.g., package.json, Cargo.toml, go.mod
    return false;
  }

  async analyze(
    sourceDir: string, 
    components: Component[]
  ): Promise<ComponentResult[]> {
    // Implement analysis
    return [];
  }
}

export * from './parser.js';
```

### 4. Register Adapter

Edit `src/languages/index.ts`:

```typescript
import { NewLangAdapter } from './newlang/index.js';

export const adapters = {
  // ... existing adapters
  newlang: NewLangAdapter,
};
```

### 5. Add to Types

Edit `src/types.ts`:

```typescript
export type SupportedLanguage = 
  | 'javascript'
  | 'python'
  // ... 
  | 'newlang';
```

### 6. Write Tests

Create `tests/newlang-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseNewLangSource } from '../src/languages/newlang/parser.js';

describe('NewLang Parser', () => {
  it('should parse basic imports', () => {
    const source = `import foo`;
    const imports = parseNewLangSource(source, 'test.ext');
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe('foo');
  });

  // Add more tests...
});
```

Create `tests/newlang-adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { NewLangAdapter } from '../src/languages/newlang/index.js';

describe('NewLang Adapter', () => {
  it('should detect language', async () => {
    // Test canHandle()
  });

  it('should analyze components', async () => {
    // Test analyze()
  });
});
```

### 7. Update Documentation

- Add to `README.md` language table
- Add to `docs/CLI.md` languages section

---

## Testing

### Running Tests

```bash
# All tests
npm test

# Specific file
npm test -- tests/javascript-parser.test.ts

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Writing Tests

We use [Vitest](https://vitest.dev/) for testing.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Feature', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should do something', async () => {
    await writeFile(join(tmpDir, 'test.js'), 'import foo from "foo"');
    // Test logic
    expect(result).toBe(expected);
  });
});
```

### Test Coverage

Aim for:
- **80%+** overall coverage
- **90%+** for core modules (analyzer, parsers)
- **100%** for critical paths (vulnerability detection)

---

## Code Style

### TypeScript

- Use strict mode
- Prefer `const` over `let`
- Use explicit return types for public APIs
- Document public APIs with JSDoc

```typescript
/**
 * Analyze components for reachability
 * @param sourceDir - Path to source directory
 * @param components - Components to analyze
 * @returns Analysis results
 */
export async function analyze(
  sourceDir: string,
  components: Component[]
): Promise<ComponentResult[]> {
  // Implementation
}
```

### Imports

```typescript
// Node built-ins first
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// External packages
import { glob } from 'glob';

// Internal imports
import { BaseLanguageAdapter } from '../base.js';
import type { Component } from '../../types.js';
```

### ESLint

```bash
# Check
npm run lint

# Fix
npm run lint:fix
```

---

## Pull Request Process

### 1. Fork & Branch

```bash
# Fork on GitHub, then:
git clone https://github.com/YOUR_USERNAME/ReachVet.git
cd ReachVet
git checkout -b feature/my-feature
```

### 2. Make Changes

- Write code
- Add tests
- Update documentation

### 3. Test

```bash
npm test
npm run lint
npm run typecheck
```

### 4. Commit

Use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat(parser): add support for X"
git commit -m "fix(osv): handle rate limiting"
git commit -m "docs: update API documentation"
git commit -m "test(java): add reflection tests"
```

### 5. Push & PR

```bash
git push origin feature/my-feature
```

Then open a Pull Request on GitHub.

### PR Checklist

- [ ] Tests pass (`npm test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Types check (`npm run typecheck`)
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (if applicable)

---

## Questions?

- Open an [issue](https://github.com/taku-tez/ReachVet/issues)
- Check existing issues and PRs

Thank you for contributing! 🎉
