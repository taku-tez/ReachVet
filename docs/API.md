# ReachVet API Documentation

## Table of Contents

- [Analyzer](#analyzer)
- [Output Types](#output-types)
- [Language Adapters](#language-adapters)
- [OSV Client](#osv-client)
- [EPSS Client](#epss-client)
- [KEV Client](#kev-client)
- [Cache](#cache)
- [License Compliance](#license-compliance)
- [Output Formatters](#output-formatters)

---

## Analyzer

The main class for performing reachability analysis.

```typescript
import { Analyzer } from 'reachvet';

const analyzer = new Analyzer({
  sourceDir: './src',
  language: 'typescript',  // Optional: auto-detected if not specified
  ignorePatterns: ['**/*.test.ts'],
  cache: {
    enabled: true,
    ttlMs: 3600000
  }
});

const output = await analyzer.analyze(components);
```

### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sourceDir` | `string` | required | Path to source directory |
| `language` | `SupportedLanguage` | auto | Force specific language |
| `ignorePatterns` | `string[]` | `[]` | Glob patterns to ignore |
| `cache` | `CacheOptions` | - | Cache configuration |

### Methods

#### `analyze(components: Component[]): Promise<AnalysisOutput>`

Analyze components for reachability.

```typescript
const output = await analyzer.analyze([
  { name: 'lodash', version: '4.17.21', type: 'npm' }
]);
```

---

## Output Types

### AnalysisOutput

```typescript
interface AnalysisOutput {
  version: string;
  timestamp: string;
  sourceDir: string;
  language: SupportedLanguage;
  summary: AnalysisSummary;
  results: ComponentResult[];
  metadata?: AnalysisMetadata;
}
```

### ComponentResult

```typescript
interface ComponentResult {
  component: Component;
  status: ReachabilityStatus;
  usage?: UsageInfo;
  confidence: ConfidenceLevel;
  details?: string[];
  warnings?: AnalysisWarning[];
}
```

### ReachabilityStatus

| Status | Description |
|--------|-------------|
| `reachable` | Imported and actively used |
| `imported` | Imported but usage unclear |
| `not_reachable` | Not imported |
| `indirect` | Used via re-export |
| `unknown` | Could not determine |

---

## Language Adapters

Each language has a dedicated adapter.

```typescript
import { 
  JavaScriptAdapter,
  PythonAdapter,
  GoLanguageAdapter,
  JavaLanguageAdapter,
  RustLanguageAdapter
} from 'reachvet';

const adapter = new JavaScriptAdapter();
const canHandle = await adapter.canHandle('./src');
const results = await adapter.analyze('./src', components);
```

### Available Adapters

- `JavaScriptAdapter` - JS/TS
- `PythonAdapter` - Python
- `GoLanguageAdapter` - Go
- `JavaLanguageAdapter` - Java
- `RustLanguageAdapter` - Rust
- `RubyAdapter` - Ruby
- `PHPAdapter` - PHP
- `CSharpAdapter` - C#
- `SwiftAdapter` - Swift
- `KotlinAdapter` - Kotlin
- `ScalaAdapter` - Scala
- `ElixirAdapter` - Elixir
- `DartAdapter` - Dart
- `PerlAdapter` - Perl
- `HaskellAdapter` - Haskell
- `ClojureAdapter` - Clojure
- `OCamlAdapter` - OCaml

---

## OSV Client

Query the OSV.dev vulnerability database.

```typescript
import { OSVClient } from 'reachvet';

const client = new OSVClient({
  cacheEnabled: true,
  cacheTtlMs: 86400000  // 24 hours
});

// Query single package
const vulns = await client.query('npm', 'lodash', '4.17.20');

// Batch query
const results = await client.batchQuery([
  { ecosystem: 'npm', name: 'lodash', version: '4.17.20' },
  { ecosystem: 'npm', name: 'express', version: '4.18.0' }
]);
```

---

## EPSS Client

Query FIRST.org EPSS (Exploit Prediction Scoring System).

```typescript
import { EPSSClient } from 'reachvet';

const client = new EPSSClient({
  cacheEnabled: true,
  cacheTtlMs: 86400000
});

// Get EPSS score for CVE
const score = await client.getScore('CVE-2021-44228');
// => { cve: 'CVE-2021-44228', epss: 0.97547, percentile: 0.99998 }

// Batch query
const scores = await client.batchQuery([
  'CVE-2021-44228',
  'CVE-2022-22965'
]);
```

---

## KEV Client

Query CISA Known Exploited Vulnerabilities catalog.

```typescript
import { KEVClient } from 'reachvet';

const client = new KEVClient({
  cacheEnabled: true,
  cacheTtlMs: 86400000
});

// Check if CVE is in KEV
const entry = await client.lookup('CVE-2021-44228');

// Get all ransomware-related entries
const ransomware = await client.getRansomwareEntries();

// Get past-due entries
const pastDue = await client.getPastDueEntries();
```

---

## Cache

Incremental analysis cache for watch mode.

```typescript
import { AnalysisCache, getGlobalCache } from 'reachvet';

// Create custom cache
const cache = new AnalysisCache({
  ttlMs: 3600000,
  maxEntries: 10000,
  persistToDisk: true,
  cacheDir: '.reachvet-cache'
});

// Or use global singleton
const globalCache = getGlobalCache();

// Cache operations
cache.set('key', result);
const cached = cache.get('key');
cache.invalidate('key');
cache.clear();
```

---

## License Compliance

Check license compliance across dependencies.

```typescript
import { 
  checkLicenseCompliance,
  PERMISSIVE_POLICY,
  OSI_APPROVED_POLICY,
  NO_AGPL_POLICY,
  generateAttribution
} from 'reachvet';

// Check with built-in policy
const report = checkLicenseCompliance(analysisOutput, PERMISSIVE_POLICY);

// Custom policy
const customPolicy = {
  name: 'my-policy',
  allow: ['MIT', 'Apache-2.0', 'BSD-3-Clause'],
  deny: ['GPL-3.0', 'AGPL-3.0'],
  warn: ['LGPL-3.0']
};

const report = checkLicenseCompliance(analysisOutput, customPolicy);

// Generate attribution
const notice = generateAttribution(analysisOutput);
```

---

## Output Formatters

### SARIF

```typescript
import { toSarif } from 'reachvet';

const sarif = toSarif(analysisOutput, {
  includeNotReachable: false,
  includeImported: true
});
```

### JUnit XML

```typescript
import { toJUnitXml } from 'reachvet';

const junit = toJUnitXml(analysisOutput, {
  includeAll: false,
  suiteName: 'ReachVet Analysis'
});
```

### CSV

```typescript
import { toCSV, toDependenciesCSV, toVulnerabilitiesCSV } from 'reachvet';

const csv = toCSV(analysisOutput, {
  delimiter: ',',
  includeHeader: true,
  columns: ['name', 'version', 'status', 'vulnerabilities']
});
```

### SBOM Generation

```typescript
import { toCycloneDX, toSPDX, toVEX } from 'reachvet';

const cyclonedx = toCycloneDX(analysisOutput);
const spdx = toSPDX(analysisOutput);
const vex = toVEX(analysisOutput);
```

### Graph (DOT/Mermaid)

```typescript
import { toGraphDOT, toGraphMermaid } from 'reachvet';

const dot = toGraphDOT(analysisOutput, { direction: 'TB' });
const mermaid = toGraphMermaid(analysisOutput);
```
