# ReachVet 解析精度向上 TODO

## Batch 1: CommonJS Destructuring対応 🔴 HIGH ✅ DONE
対応すべきパターン:
```javascript
const { merge, clone } = require('lodash')      // destructuring ✅
const _ = require('lodash')                      // whole module ✅
const merge = require('lodash').merge           // property access ✅
const merge = require('lodash/merge')           // subpath (既存) ✅
```

Status: ✅ Completed (2026-02-03 19:13)
- parser.ts updated with context-aware require() parsing
- 14 unit tests added and passing

## Batch 2: Dynamic Import警告システム 🟡 MED ✅ DONE
- 検出時にwarningレベルで報告 ✅
- 「静的解析の限界」を明示 ✅
- ReachabilityResult に `warnings` フィールド追加 ✅
- AnalysisWarning型追加 (code, message, location, severity) ✅
- Namespace import警告も追加 ✅

Status: ✅ Completed (2026-02-03 19:15)
- types.ts: AnalysisWarning type, warningsCount in summary
- base.ts: Helper methods accept warnings
- javascript/index.ts: generateWarnings() method
- 22 unit tests passing

## Batch 3: Re-export Chain追跡 🟡 MED ✅ DONE
- `index.ts` からの再エクスポートを追跡 ✅
- 最大depth設定（循環参照対策、default: 5） ✅
- barrel files のフルチェーン解決 ✅
- 循環参照検出 ✅
- 警告: barrel_file, circular_reexport, max_depth_reached ✅

Status: ✅ Completed (2026-02-03 21:11)
- New file: src/languages/javascript/reexport.ts
- resolveReexportChains() - 相対パスimportを追跡
- traceReexports() - 再帰的にre-exportチェーンを解決
- 24 tests passing

## Batch 4: Namespace Import解析 🟡 MED ✅ DONE
- `import * as _` の後の `_.template()` 追跡 ✅
- PropertyAccessExpression 解析 ✅
- ElementAccessExpression 解析 (`_['template']`) ✅
- 使用関数の特定 ✅

Status: ✅ Completed (2026-02-03 21:14)
- New function: findNamespaceUsages() in parser.ts
- Tracks _.merge(), _.template(), _['dynamic'] patterns
- Integrated into analyzeComponent for accurate vulnerability detection
- 31 tests passing

## Batch 5: テストカバレッジ強化
- 各パターンのユニットテスト
- edge case カバー
- 目標: 80%+

Status: ⬜ Not started

---

## Progress Log

### 2026-02-03
- Created TODO
