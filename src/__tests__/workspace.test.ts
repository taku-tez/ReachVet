/**
 * ReachVet - Workspace Detection Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectWorkspace, isInternalPackage } from '../languages/javascript/workspace.js';

describe('detectWorkspace', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-workspace-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('npm workspaces', () => {
    it('should detect npm workspaces', async () => {
      await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'monorepo',
        workspaces: ['packages/*']
      }));
      
      await mkdir(join(tmpDir, 'packages', 'core'), { recursive: true });
      await writeFile(join(tmpDir, 'packages', 'core', 'package.json'), JSON.stringify({
        name: '@monorepo/core'
      }));
      
      await mkdir(join(tmpDir, 'packages', 'utils'), { recursive: true });
      await writeFile(join(tmpDir, 'packages', 'utils', 'package.json'), JSON.stringify({
        name: '@monorepo/utils'
      }));

      const result = await detectWorkspace(tmpDir);
      
      expect(result).not.toBeNull();
      expect(result?.type).toBe('npm');
      expect(result?.packages).toContain('@monorepo/core');
      expect(result?.packages).toContain('@monorepo/utils');
    });
  });

  describe('yarn workspaces', () => {
    it('should detect yarn workspaces with yarn.lock', async () => {
      await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'monorepo',
        workspaces: ['packages/*']
      }));
      await writeFile(join(tmpDir, 'yarn.lock'), '');
      
      await mkdir(join(tmpDir, 'packages', 'app'), { recursive: true });
      await writeFile(join(tmpDir, 'packages', 'app', 'package.json'), JSON.stringify({
        name: '@monorepo/app'
      }));

      const result = await detectWorkspace(tmpDir);
      
      expect(result).not.toBeNull();
      expect(result?.type).toBe('yarn');
    });
  });

  describe('nested detection', () => {
    it('should detect workspace from nested directory', async () => {
      await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'monorepo',
        workspaces: ['packages/*']
      }));
      
      await mkdir(join(tmpDir, 'packages', 'app', 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'packages', 'app', 'package.json'), JSON.stringify({
        name: '@monorepo/app'
      }));

      // Detect from nested src directory
      const result = await detectWorkspace(join(tmpDir, 'packages', 'app', 'src'));
      
      expect(result).not.toBeNull();
      expect(result?.packages).toContain('@monorepo/app');
    });
  });

  describe('no workspace', () => {
    it('should return null for non-workspace project', async () => {
      await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'regular-project'
      }));

      const result = await detectWorkspace(tmpDir);
      
      expect(result).toBeNull();
    });
  });
});

describe('isInternalPackage', () => {
  it('should identify internal packages', () => {
    const workspace = {
      root: '/monorepo',
      type: 'npm' as const,
      packages: ['@monorepo/core', '@monorepo/utils'],
      packageDirs: new Map()
    };
    
    expect(isInternalPackage('@monorepo/core', workspace)).toBe(true);
    expect(isInternalPackage('lodash', workspace)).toBe(false);
  });

  it('should return false when no workspace', () => {
    expect(isInternalPackage('@monorepo/core', null)).toBe(false);
  });
});
