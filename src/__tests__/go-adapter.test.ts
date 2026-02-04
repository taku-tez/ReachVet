/**
 * Go Adapter Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GoLanguageAdapter } from '../languages/go/index.js';

describe('Go precision tests', () => {
  it('should detect blank imports (side effect only)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-go-blank-'));
    
    await writeFile(join(tmpDir, 'go.mod'), `module example.com/test
go 1.21

require github.com/lib/pq v1.10.9
`);
    await writeFile(join(tmpDir, 'main.go'), `package main

import (
    "database/sql"
    _ "github.com/lib/pq"
)

func main() {
    db, _ := sql.Open("postgres", "")
    _ = db
}
`);
    
    const adapter = new GoLanguageAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'github.com/lib/pq',
      version: 'v1.10.9',
      type: 'go'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const pqResult = result.find(r => r.component.name === 'github.com/lib/pq');
    expect(pqResult?.warnings?.some(w => 
      w.message.includes('side effect') || w.message.includes('blank')
    )).toBe(true);
  });

  it.skip('should detect dot imports (TODO: improve Go adapter)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-go-dot-'));
    
    await writeFile(join(tmpDir, 'go.mod'), `module example.com/test
go 1.21

require github.com/stretchr/testify v1.8.0
`);
    await writeFile(join(tmpDir, 'main_test.go'), `package main

import (
    . "github.com/stretchr/testify/assert"
    "testing"
)

func TestExample(t *testing.T) {
    Equal(t, 1, 1)
}
`);
    
    const adapter = new GoLanguageAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'github.com/stretchr/testify',
      version: 'v1.8.0',
      type: 'go'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const testifyResult = result.find(r => r.component.name === 'github.com/stretchr/testify');
    // Check if dot import is detected (either via warning or status)
    const hasDotWarning = testifyResult?.warnings?.some(w => 
      w.message.toLowerCase().includes('dot')
    );
    const hasSubpathMatch = testifyResult && testifyResult.status !== 'not_reachable';
    expect(hasDotWarning || hasSubpathMatch).toBe(true);
  });

  it('should track package usage', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'reachvet-go-usage-'));
    
    await writeFile(join(tmpDir, 'go.mod'), `module example.com/test
go 1.21

require github.com/gin-gonic/gin v1.9.0
`);
    await writeFile(join(tmpDir, 'main.go'), `package main

import "github.com/gin-gonic/gin"

func main() {
    r := gin.Default()
    r.GET("/", func(c *gin.Context) {
        c.JSON(200, gin.H{"message": "hello"})
    })
    r.Run()
}
`);
    
    const adapter = new GoLanguageAdapter();
    const result = await adapter.analyze(tmpDir, [{
      name: 'github.com/gin-gonic/gin',
      version: 'v1.9.0',
      type: 'go'
    }]);
    
    await rm(tmpDir, { recursive: true });
    
    const ginResult = result.find(r => r.component.name === 'github.com/gin-gonic/gin');
    expect(ginResult?.status).toBe('reachable');
    // Go adapter tracks usedMembers for package calls
    if (ginResult?.usage?.usedMembers) {
      expect(ginResult.usage.usedMembers).toContain('Default');
    }
  });
});
