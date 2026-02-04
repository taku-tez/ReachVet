# Changelog

All notable changes to ReachVet will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.14] - 2026-02-05

### Added
- **CSV Output** - Export results to CSV for spreadsheets and data analysis
  - `--csv [file]` flag for analyze/check commands
  - Customizable columns, delimiters (comma/semicolon/tab)
  - `toDependenciesCSV()`, `toVulnerabilitiesCSV()` programmatic APIs

## [0.5.13] - 2026-02-05

### Added
- **Vulnerability Fix Suggestions** - `reachvet suggest-fixes` command
  - Auto-fetch fixed versions from OSV
  - Generate upgrade commands for 9+ package managers
  - Risk assessment based on semver (patch/minor/major)
  - Script generation (`--script fix.sh`)

## [0.5.12] - 2026-02-05

### Added
- **Monorepo Detection & Multi-Project Analysis**
  - Detect npm/yarn/pnpm workspaces, Lerna, Rush, Nx, Turborepo
  - Cargo workspace (Rust), Go workspace (go.work)
  - `reachvet monorepo` command with `--parallel` option

## [0.5.11] - 2026-02-05

### Added
- **CISA KEV Integration** - Known Exploited Vulnerabilities catalog
  - `reachvet kev` command for CVE lookup
  - Ransomware and past-due filtering
  - Priority calculation with KEV weighting

## [0.5.10] - 2026-02-05

### Added
- **EPSS Integration** - Exploit Prediction Scoring System
  - `reachvet epss` command for vulnerability prioritization
  - Combined priority score: EPSS + CVSS + Reachability
  - 24-hour cache for EPSS data

## [0.5.9] - 2026-02-05

### Added
- **Dependency Freshness Check** - `reachvet freshness` command
  - Check for outdated dependencies across 9 ecosystems
  - Deprecated package detection
  - Severity levels (current/minor/major/critical)

## [0.5.8] - 2026-02-05

### Added
- **JSON Schema for Configuration**
  - `reachvet schema` command to generate JSON Schema
  - IDE autocomplete support for `.reachvetrc.json`
  - `reachvet init --schema` option

## [0.5.7] - 2026-02-05

### Added
- **Ignore File Support** - `.reachvetignore`
  - gitignore-style patterns
  - Falls back to `.gitignore` if not present
  - `reachvet init --ignore` to generate

## [0.5.6] - 2026-02-05

### Added
- **Shell Completions** - `reachvet completions` command
  - Bash, Zsh, Fish support
  - `--install` flag for setup instructions

## [0.5.5] - 2026-02-05

### Added
- **License Compliance Check**
  - 30+ SPDX licenses with category classification
  - Custom policy support (allow/deny/warn)
  - Built-in policies: permissive-only, osi-approved, no-agpl
  - Attribution/NOTICE file generation

## [0.5.4] - 2026-02-05

### Added
- **SBOM Generation**
  - `--sbom-cyclonedx [file]` - CycloneDX 1.5 output
  - `--sbom-spdx [file]` - SPDX 2.3 output
  - `--vex [file]` - VEX (Vulnerability Exploitability eXchange)

## [0.5.3] - 2026-02-04

### Added
- **JUnit XML Output** - `--junit [file]` for CI/CD integration
  - Jenkins, GitLab CI, Azure DevOps compatible
  - `--junit-all` to include all dependencies

## [0.5.2] - 2026-02-04

### Added
- **Configuration File Support**
  - `.reachvetrc`, `.reachvetrc.json`, `reachvet.config.js`
  - `reachvet init` command to create config
  - `reachvet config` to view/validate

## [0.5.1] - 2026-02-04

### Added
- **Pre-commit Hook Support**
  - `reachvet pre-commit` command
  - `.pre-commit-hooks.yaml` for pre-commit framework
  - `--block-on-reachable` strict mode

## [0.5.0] - 2026-02-04

### Added
- **Precision Analysis**
  - JS/TS: Call graph analysis, workspace detection
  - Python: Dynamic import detection (`__import__`, `importlib`, `exec`)
  - Java: Reflection detection (`Class.forName`, `newInstance`, `invoke`)
  - Rust: Unsafe code detection
  - Go: Blank/dot import warnings

### Changed
- Improved false positive reduction with call graph
- Type-only imports correctly marked as not_reachable
- Internal workspace packages auto-skipped in monorepos

## [0.4.0] - 2026-02-04

### Added
- **Watch Mode** - `reachvet watch` for continuous monitoring
  - File change detection with chokidar
  - Debounce configuration
  - Quiet mode

### Added
- **API Server Mode** - `reachvet serve`
  - REST API endpoints for analysis
  - CORS support, rate limiting
  - API key authentication

## [0.3.0] - 2026-02-03

### Added
- **18 Language Support**
  - Haskell, Clojure, OCaml added
  - Total: JS/TS, Python, Go, Java, Rust, Ruby, PHP, C#, Swift, Kotlin, Scala, Elixir, Dart, Perl, Haskell, Clojure, OCaml

### Added
- **GitHub Actions Integration**
  - `action.yml` for reusable action
  - SARIF output for Code Scanning
  - Annotations support

## [0.2.0] - 2026-02-02

### Added
- **SBOM Input** - CycloneDX and SPDX format support
- **OSV Integration** - Automatic vulnerability lookup
- **SARIF Output** - For GitHub Code Scanning

## [0.1.0] - 2026-01-31

### Added
- Initial release
- Core reachability analysis for JS/TS, Python, Go, Java, Rust
- CLI with analyze/check commands
- JSON output format
