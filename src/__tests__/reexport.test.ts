/**
 * ReachVet Re-export Chain Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveReexportChains } from '../languages/javascript/reexport.js';
import { parseSource } from '../languages/javascript/parser.js';

describe('resolveReexportChains', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-reexport-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resolves simple re-export', async () => {
    // Create barrel file
    await writeFile(
      join(tempDir, 'utils.ts'),
      `export { merge } from 'lodash';`
    );

    // Create main file
    const mainFile = join(tempDir, 'main.ts');
    await writeFile(
      mainFile,
      `import { merge } from './utils';`
    );

    const content = await import('node:fs/promises').then(fs => fs.readFile(mainFile, 'utf-8'));
    const imports = parseSource(content, mainFile);
    const result = await resolveReexportChains(mainFile, imports);

    expect(result.chains.size).toBeGreaterThan(0);
    const lodashChains = [...result.chains.values()].flat().filter(c => c.originalModule === 'lodash');
    expect(lodashChains.length).toBeGreaterThan(0);
  });

  it('handles external imports (no re-export)', async () => {
    const mainFile = join(tempDir, 'main.ts');
    await writeFile(
      mainFile,
      `import { merge } from 'lodash';`
    );

    const content = await import('node:fs/promises').then(fs => fs.readFile(mainFile, 'utf-8'));
    const imports = parseSource(content, mainFile);
    const result = await resolveReexportChains(mainFile, imports);

    // External imports are not re-exports
    expect(result.chains.size).toBe(0);
  });

  it('generates barrel file warning', async () => {
    // Create barrel file
    await writeFile(
      join(tempDir, 'index.ts'),
      `export { template } from 'lodash';`
    );

    // Create main file
    const mainFile = join(tempDir, 'app.ts');
    await writeFile(
      mainFile,
      `import { template } from './index';`
    );

    const content = await import('node:fs/promises').then(fs => fs.readFile(mainFile, 'utf-8'));
    const imports = parseSource(content, mainFile);
    const result = await resolveReexportChains(mainFile, imports);

    const barrelWarnings = result.warnings.filter(w => w.code === 'barrel_file');
    expect(barrelWarnings.length).toBeGreaterThan(0);
  });

  it('handles nested re-exports', async () => {
    // Level 1
    await writeFile(
      join(tempDir, 'lodash-utils.ts'),
      `export { merge } from 'lodash';`
    );

    // Level 2
    await writeFile(
      join(tempDir, 'utils.ts'),
      `export { merge } from './lodash-utils';`
    );

    // Main file
    const mainFile = join(tempDir, 'main.ts');
    await writeFile(
      mainFile,
      `import { merge } from './utils';`
    );

    const content = await import('node:fs/promises').then(fs => fs.readFile(mainFile, 'utf-8'));
    const imports = parseSource(content, mainFile);
    const result = await resolveReexportChains(mainFile, imports);

    const lodashChains = [...result.chains.values()].flat().filter(c => c.originalModule === 'lodash');
    expect(lodashChains.length).toBeGreaterThan(0);
    expect(lodashChains[0].depth).toBeGreaterThanOrEqual(2);
  });

  it('respects max depth', async () => {
    // Create a deep chain of re-exports
    for (let i = 0; i < 7; i++) {
      const next = i < 6 ? `./level${i + 1}` : 'lodash';
      await writeFile(
        join(tempDir, `level${i}.ts`),
        `export { merge } from '${next}';`
      );
    }

    const mainFile = join(tempDir, 'main.ts');
    await writeFile(
      mainFile,
      `import { merge } from './level0';`
    );

    const content = await import('node:fs/promises').then(fs => fs.readFile(mainFile, 'utf-8'));
    const imports = parseSource(content, mainFile);
    const result = await resolveReexportChains(mainFile, imports, 3); // Max depth 3

    const maxDepthWarnings = result.warnings.filter(w => w.code === 'max_depth_reached');
    expect(maxDepthWarnings.length).toBeGreaterThan(0);
  });
});
