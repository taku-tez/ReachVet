# ReachVet CLI Reference

Complete command-line interface documentation.

## Commands Overview

| Command | Description |
|---------|-------------|
| `analyze` | Analyze components (JSON output) |
| `check` | Analyze components (human-readable) |
| `watch` | Watch mode with auto re-analysis |
| `serve` | Start HTTP API server |
| `pre-commit` | Git pre-commit hook |
| `monorepo` | Monorepo detection & analysis |
| `freshness` | Check dependency freshness |
| `suggest-fixes` | Get fix suggestions |
| `epss` | Query EPSS scores |
| `kev` | Query CISA KEV catalog |
| `init` | Create configuration file |
| `config` | View/validate configuration |
| `schema` | Generate JSON Schema |
| `completions` | Generate shell completions |
| `languages` | List supported languages |
| `detect` | Auto-detect project language |

---

## analyze

Analyze components and output JSON.

```bash
reachvet analyze -s <source-dir> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-s, --source <dir>` | Source directory (required) |
| `-c, --components <file>` | Component list JSON |
| `--sbom <file>` | SBOM file (CycloneDX/SPDX) |
| `--stdin` | Read components from stdin |
| `-l, --language <lang>` | Force language detection |
| `--osv` | Fetch vulnerabilities from OSV.dev |
| `--pretty` | Pretty-print JSON output |
| `-v, --verbose` | Show progress |

### Output Options

| Option | Description |
|--------|-------------|
| `--sarif <file>` | Output SARIF format |
| `--junit <file>` | Output JUnit XML |
| `--csv <file>` | Output CSV format |
| `--csv-vulns-only` | Only vulnerable dependencies in CSV |
| `--sbom-cyclonedx <file>` | Generate CycloneDX SBOM |
| `--sbom-spdx <file>` | Generate SPDX SBOM |
| `--vex <file>` | Generate VEX document |
| `--annotations` | Output GitHub Actions annotations |
| `--graph <file>` | Output dependency graph (DOT) |
| `--graph-mermaid` | Output Mermaid diagram |

### Examples

```bash
# Basic analysis with SBOM
reachvet analyze -s ./src --sbom bom.json

# With OSV vulnerability lookup
reachvet analyze -s ./src --sbom bom.json --osv

# Multiple output formats
reachvet analyze -s ./src --sbom bom.json \
  --sarif results.sarif \
  --junit results.xml \
  --csv results.csv

# Pipe from stdin
cat components.json | reachvet analyze -s ./src --stdin

# Pretty JSON output
reachvet analyze -s ./src -c deps.json --pretty
```

---

## check

Human-readable analysis output.

```bash
reachvet check -s <source-dir> [options]
```

### Examples

```bash
# Basic check
reachvet check -s ./src --sbom bom.json

# Verbose output
reachvet check -s ./src -c deps.json -v
```

### Sample Output

```
📦 ReachVet Analysis Results
============================

Source: ./src
Language: typescript
Components: 15

✅ lodash@4.17.21 - reachable
   Used: merge, cloneDeep
   Location: src/utils.ts:5

⚠️  express@4.18.0 - reachable [VULNERABLE]
   CVE-2024-1234 (High)
   Location: src/server.ts:1

✅ axios@1.6.0 - imported
   Usage unclear (namespace import)

❌ moment@2.29.0 - not_reachable
   Not imported anywhere

Summary:
  Reachable: 8
  Imported: 2
  Not Reachable: 5
  Vulnerable & Reachable: 1 ⚠️
```

---

## watch

Watch mode for continuous monitoring.

```bash
reachvet watch -s <source-dir> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--debounce <ms>` | Debounce delay (default: 500) |
| `--quiet` | Minimal output |
| `--ignore <patterns>` | Additional ignore patterns |

### Examples

```bash
# Basic watch
reachvet watch -s ./src --sbom bom.json

# With OSV and quiet mode
reachvet watch -s ./src --sbom bom.json --osv --quiet

# Custom debounce
reachvet watch -s ./src -c deps.json --debounce 1000

# Ignore test files
reachvet watch -s ./src --sbom bom.json --ignore "**/*.test.ts"
```

---

## serve

Start HTTP API server.

```bash
reachvet serve [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-p, --port <port>` | Port number (default: 3000) |
| `--host <host>` | Host to bind (default: localhost) |
| `--api-key <key>` | API key for authentication |
| `--rate-limit <n>` | Requests per minute |
| `--cors` / `--no-cors` | Enable/disable CORS |

### Examples

```bash
# Basic server
reachvet serve --port 8080

# With authentication
reachvet serve --port 3000 --api-key "secret-key"

# Production settings
reachvet serve --port 8080 --rate-limit 100 --cors
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/info` | Server info |
| GET | `/languages` | Supported languages |
| POST | `/analyze` | Full analysis |
| POST | `/check` | Quick check |
| POST | `/osv/query` | OSV lookup |

---

## pre-commit

Git pre-commit hook integration.

```bash
reachvet pre-commit [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--sbom <file>` | SBOM file |
| `--osv` | Fetch OSV data |
| `--block-on-reachable` | Block if any dependency reachable |
| `--skip-no-staged` | Skip if no relevant files staged |
| `--no-color` | Disable colored output |

### Examples

```bash
# Basic pre-commit check
reachvet pre-commit --sbom bom.json

# Strict mode
reachvet pre-commit --sbom bom.json --block-on-reachable

# With OSV
reachvet pre-commit --sbom bom.json --osv
```

### Git Hook Setup

```bash
# .git/hooks/pre-commit
#!/bin/sh
reachvet pre-commit --sbom bom.json
```

---

## monorepo

Monorepo detection and multi-project analysis.

```bash
reachvet monorepo [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--detect` | Detection only |
| `--list` | List projects |
| `--parallel` | Parallel analysis |
| `--concurrency <n>` | Parallel workers |
| `--json` | JSON output |
| `--markdown` | Markdown output |

### Examples

```bash
# Detect monorepo type
reachvet monorepo --detect

# List all projects
reachvet monorepo --list

# Analyze all projects
reachvet monorepo --sbom bom.json

# Parallel analysis
reachvet monorepo --sbom bom.json --parallel --concurrency 4
```

---

## freshness

Check dependency freshness.

```bash
reachvet freshness [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--outdated-only` | Show only outdated |
| `--ecosystem <name>` | Filter by ecosystem |
| `--severity <level>` | Filter by severity |
| `--json` | JSON output |

### Examples

```bash
# Check all dependencies
reachvet freshness --sbom bom.json

# Only outdated
reachvet freshness --sbom bom.json --outdated-only

# Filter by ecosystem
reachvet freshness --sbom bom.json --ecosystem npm
```

---

## suggest-fixes

Get fix suggestions for vulnerabilities.

```bash
reachvet suggest-fixes [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--json` | JSON output |
| `--script <file>` | Generate fix script |

### Examples

```bash
# Get suggestions
reachvet suggest-fixes --sbom bom.json

# Generate fix script
reachvet suggest-fixes --sbom bom.json --script fix.sh
```

---

## epss

Query EPSS (Exploit Prediction Scoring System).

```bash
reachvet epss [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--cve <ids...>` | CVE IDs to query |
| `--sbom <file>` | Query from SBOM |
| `--no-cache` | Disable cache |
| `--json` | JSON output |

### Examples

```bash
# Query specific CVEs
reachvet epss --cve CVE-2021-44228 CVE-2022-22965

# From SBOM
reachvet epss --sbom bom.json --json
```

---

## kev

Query CISA Known Exploited Vulnerabilities.

```bash
reachvet kev [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--cve <ids...>` | CVE IDs to check |
| `--catalog-info` | Show catalog info |
| `--ransomware` | List ransomware entries |
| `--past-due` | List past-due entries |
| `--json` | JSON output |

### Examples

```bash
# Check CVEs
reachvet kev --cve CVE-2021-44228

# Catalog info
reachvet kev --catalog-info

# Ransomware entries
reachvet kev --ransomware
```

---

## init

Create configuration file.

```bash
reachvet init [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--format <type>` | Format: json, js, cjs |
| `--schema` | Include JSON Schema reference |
| `--ignore` | Create .reachvetignore |
| `--ignore-only` | Only create ignore file |

### Examples

```bash
# Create JSON config
reachvet init

# Create JS config
reachvet init --format js

# With schema reference
reachvet init --schema

# Create ignore file
reachvet init --ignore
```

---

## completions

Generate shell completions.

```bash
reachvet completions <shell> [options]
```

### Shells

- `bash`
- `zsh`
- `fish`

### Examples

```bash
# Bash
source <(reachvet completions bash)

# Zsh
reachvet completions zsh > ~/.zsh/completions/_reachvet

# Fish
reachvet completions fish > ~/.config/fish/completions/reachvet.fish

# Show install instructions
reachvet completions bash --install
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error |
| 2 | Vulnerable dependencies reachable |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REACHVET_CONFIG` | Config file path |
| `REACHVET_CACHE_DIR` | Cache directory |
| `NO_COLOR` | Disable colored output |
| `REACHVET_API_KEY` | Default API key for serve |
