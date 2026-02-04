# ReachVet 🎯

[![CI](https://github.com/taku-tez/ReachVet/actions/workflows/ci.yml/badge.svg)](https://github.com/taku-tez/ReachVet/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/reachvet.svg)](https://www.npmjs.com/package/reachvet)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Supply Chain Reachability Analyzer**

ReachVet checks if your dependencies are actually used in your code. Given a list of components (from SBOM or simple JSON), it analyzes your source code to determine which are imported and used.

## Why?

When a vulnerability is found in a dependency, the first question is: **"Is this actually reachable in our code?"**

A CVE in `lodash.template()` doesn't matter if you only use `lodash.merge()`.

ReachVet helps you prioritize: focus on vulnerabilities that are actually reachable.

## Features

- 📦 **SBOM Integration** - Accepts CycloneDX, SPDX, or simple JSON
- 🔍 **Deep Analysis** - Tracks imports, named exports, and usage
- 🎯 **Vulnerability Matching** - Checks if affected functions are used
- 📊 **JSON Output** - Easy integration with CI/CD and other tools
- 🧩 **Multi-Language** - Supports 15 languages (JS/TS, Python, Go, Java, Rust, Ruby, PHP, C#, Swift, Kotlin, Scala, Elixir, Dart, Perl)

## Installation

```bash
npm install -g reachvet
```

## Usage

### Basic Usage

```bash
# Analyze with component list
reachvet analyze -s ./src -c components.json

# Analyze with SBOM
reachvet analyze -s ./src --sbom bom.json

# Pipe from other tools
securify sbom export | reachvet analyze -s ./src --stdin

# Human-readable output
reachvet check -s ./src -c components.json
```

### Watch Mode

Monitor your source files for changes and automatically re-analyze:

```bash
# Basic watch mode
reachvet watch -s ./src -c components.json

# Watch with SBOM input
reachvet watch -s ./src --sbom bom.json

# Quiet mode (summary only)
reachvet watch -s ./src -c components.json --quiet

# With OSV vulnerability lookup
reachvet watch -s ./src -c components.json --osv

# Custom debounce delay (ms)
reachvet watch -s ./src -c components.json --debounce 1000

# Ignore additional patterns
reachvet watch -s ./src -c components.json --ignore "**/*.test.ts" "**/fixtures/**"
```

Watch mode features:
- 🔄 Auto re-analysis on file changes
- ⏱️ Configurable debounce delay
- 🔇 Quiet mode for minimal output
- 🚨 Vulnerability highlighting
- 🎯 Smart file filtering (only relevant source files)

Press `Ctrl+C` to stop watching.

### Input Formats

**Simple JSON:**
```json
[
  { "name": "lodash", "version": "4.17.20" },
  { "name": "express", "version": "4.18.0" }
]
```

**With vulnerability info:**
```json
[
  {
    "name": "lodash",
    "version": "4.17.20",
    "vulnerabilities": [
      {
        "id": "CVE-2021-23337",
        "severity": "high",
        "affectedFunctions": ["template"]
      }
    ]
  }
]
```

**CycloneDX / SPDX** - Standard SBOM formats are auto-detected.

### Output

```json
{
  "version": "0.1.0",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "sourceDir": "./src",
  "language": "javascript",
  "summary": {
    "total": 10,
    "reachable": 3,
    "imported": 2,
    "notReachable": 5,
    "unknown": 0,
    "vulnerableReachable": 1
  },
  "results": [
    {
      "component": {
        "name": "lodash",
        "version": "4.17.20",
        "vulnerabilities": [...]
      },
      "status": "reachable",
      "usage": {
        "importStyle": "esm",
        "usedMembers": ["merge", "cloneDeep"],
        "locations": [
          { "file": "src/utils.ts", "line": 5 }
        ]
      },
      "confidence": "high",
      "notes": ["Imported in 1 location(s)"]
    }
  ]
}
```

### Status Levels

| Status | Description |
|--------|-------------|
| `reachable` | Component is imported and used |
| `imported` | Imported but specific usage unclear |
| `not_reachable` | Not imported anywhere |
| `indirect` | Used via re-export (transitive) |
| `unknown` | Could not determine |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (or reachable but no vulnerabilities) |
| 1 | Error |
| 2 | Vulnerable components are reachable |

## CLI Reference

```bash
# Analyze (JSON output)
reachvet analyze -s <source-dir> -c <components.json> [options]
reachvet analyze -s <source-dir> --sbom <bom.json>
reachvet analyze -s <source-dir> --stdin

# Check (human-readable output)
reachvet check -s <source-dir> -c <components.json>

# Utilities
reachvet languages              # List supported languages
reachvet detect <dir>           # Auto-detect language
```

### Options

| Option | Description |
|--------|-------------|
| `-s, --source <dir>` | Source directory (required) |
| `-c, --components <file>` | Component list JSON |
| `--sbom <file>` | SBOM file (CycloneDX/SPDX) |
| `--stdin` | Read from stdin |
| `-l, --language <lang>` | Force language |
| `-v, --verbose` | Show progress |
| `--pretty` | Pretty print JSON |

## Programmatic Usage

```typescript
import { Analyzer, parseSimpleJson } from 'reachvet';

const components = await parseSimpleJson('components.json');

const analyzer = new Analyzer({
  sourceDir: './src',
  language: 'typescript'
});

const output = await analyzer.analyze(components);

// Check results
for (const result of output.results) {
  if (result.status === 'reachable' && result.component.vulnerabilities?.length) {
    console.log(`⚠️ ${result.component.name} is vulnerable AND reachable!`);
  }
}
```

## Supported Languages

| Language | Status | Import Styles |
|----------|--------|---------------|
| JavaScript | ✅ | ESM, CommonJS, Dynamic |
| TypeScript | ✅ | ESM, CommonJS, Dynamic |
| Python | ✅ | import, from...import |
| Go | ✅ | import |
| Java | ✅ | import |
| Rust | ✅ | use, extern crate |
| Ruby | ✅ | require, require_relative |
| PHP | ✅ | use, require, include |
| C# | ✅ | using |
| Swift | ✅ | import |
| Kotlin | ✅ | import |
| Scala | ✅ | import |
| Elixir | ✅ | import, alias, use, require |
| Dart | ✅ | import |
| Perl | ✅ | use, require |

## Integration Examples

### With Securify

```bash
# Export SBOM from Securify, check reachability
securify sbom export --format cyclonedx | reachvet analyze -s ./src --stdin
```

### GitHub Actions (Recommended)

Use ReachVet as a GitHub Action:

```yaml
- name: ReachVet Analysis
  uses: taku-tez/ReachVet@v1
  with:
    source: './src'
    sbom: 'bom.json'
    osv: 'true'                    # Fetch vulnerability data from OSV.dev
    sarif-file: 'reachvet.sarif'   # For GitHub Code Scanning
    fail-on-vulnerable: 'true'
```

**Full Example:**

```yaml
name: Security Scan
on: [push, pull_request]

jobs:
  reachability:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate SBOM
        run: npx @cyclonedx/cyclonedx-npm --output-file bom.json

      - name: ReachVet Analysis
        id: reachvet
        uses: taku-tez/ReachVet@v1
        with:
          source: '.'
          sbom: 'bom.json'
          osv: 'true'
          sarif-file: 'reachvet.sarif'
          annotate: 'true'

      - name: Upload SARIF to GitHub
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: reachvet.sarif

      - name: Check Results
        run: |
          echo "Total: ${{ steps.reachvet.outputs.total }}"
          echo "Reachable: ${{ steps.reachvet.outputs.reachable }}"
          echo "Vulnerable & Reachable: ${{ steps.reachvet.outputs.vulnerable-reachable }}"
```

**Action Inputs:**

| Input | Description | Default |
|-------|-------------|---------|
| `source` | Source directory | `.` |
| `sbom` | SBOM file path | - |
| `components` | Component list JSON | - |
| `language` | Force language | auto-detect |
| `osv` | Fetch OSV.dev data | `true` |
| `fail-on-vulnerable` | Fail if vulnerable reachable | `true` |
| `fail-on-reachable` | Fail if any reachable | `false` |
| `sarif-file` | SARIF output path | - |
| `annotate` | Create annotations | `true` |

**Action Outputs:**

| Output | Description |
|--------|-------------|
| `total` | Total components |
| `reachable` | Reachable count |
| `imported` | Imported but unclear |
| `not-reachable` | Not reachable count |
| `vulnerable-reachable` | Vulnerable & reachable |
| `sarif-file` | Generated SARIF path |

### CLI with Annotations

Generate GitHub Actions workflow annotations from CLI:

```bash
# Output annotations + JSON
reachvet analyze -s ./src --sbom bom.json --annotations

# Include notices for imported deps
reachvet analyze -s ./src --sbom bom.json --annotations --annotations-notices
```

### Basic CI/CD

```yaml
- name: Check vulnerable dependencies
  run: |
    reachvet analyze -s ./src --sbom bom.json
    if [ $? -eq 2 ]; then
      echo "⚠️ Vulnerable reachable dependencies found!"
      exit 1
    fi
```

### With jq

```bash
# Get only reachable vulnerabilities
reachvet analyze -s ./src -c components.json | \
  jq '.results[] | select(.status == "reachable" and .component.vulnerabilities)'
```

## How It Works

1. **Parse Input** - Read component list from JSON/SBOM
2. **Scan Source** - Find all JS/TS files (excluding node_modules, dist, etc.)
3. **Extract Imports** - Use TypeScript compiler API to parse AST
4. **Match Components** - Map npm package names to import statements
5. **Analyze Usage** - Check which exports are actually used
6. **Report** - Output JSON with reachability status

## Limitations

- **Static analysis only** - Dynamic imports with variables can't be resolved
- **No call graph** - Doesn't trace function calls after import
- **Single project** - Doesn't analyze monorepo dependencies

## Contributing

Adding a new language:

1. Create adapter in `src/languages/<lang>/`
2. Implement `LanguageAdapter` interface
3. Register in `src/languages/index.ts`

## License

MIT
