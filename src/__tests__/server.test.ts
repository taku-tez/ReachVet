/**
 * ReachVet API Server Tests
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { ReachVetServer, startServer, type ServerConfig } from '../server/index.js';
import * as http from 'http';

// Helper to make HTTP requests
async function request(
  port: number,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf-8');
          let body: unknown;
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = rawBody;
          }
          resolve({ status: res.statusCode || 0, body, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

// Use different port ranges for each test group to avoid conflicts
const BASE_PORT = 14000;
let portCounter = 0;

function getNextPort(): number {
  return BASE_PORT + (portCounter++);
}

describe('ReachVetServer', () => {
  describe('Server Lifecycle', () => {
    it('should start and stop server', async () => {
      const port = getNextPort();
      const server = new ReachVetServer({ port, host: '127.0.0.1' });
      
      let listeningEmitted = false;
      server.on('listening', () => {
        listeningEmitted = true;
      });

      await server.start();
      expect(listeningEmitted).toBe(true);

      // Server should respond
      const response = await request(port, '/');
      expect(response.status).toBe(200);

      await server.stop();
    });

    it('should use startServer helper', async () => {
      const port = getNextPort();
      const server = await startServer({ port });
      
      const response = await request(port, '/health');
      expect(response.status).toBe(200);
      expect((response.body as { status: string }).status).toBe('ok');
      
      await server.stop();
    });
  });

  describe('Health & Info Endpoints', () => {
    let server: ReachVetServer;
    let port: number;

    beforeAll(async () => {
      port = getNextPort();
      server = await startServer({ port, rateLimit: undefined });
    });

    afterAll(async () => {
      await server.stop();
    });

    it('GET / should return health status', async () => {
      const response = await request(port, '/');
      expect(response.status).toBe(200);
      expect((response.body as { status: string }).status).toBe('ok');
      expect((response.body as { version: string }).version).toBe('0.5.0');
    });

    it('GET /health should return health status', async () => {
      const response = await request(port, '/health');
      expect(response.status).toBe(200);
      expect((response.body as { status: string }).status).toBe('ok');
    });

    it('GET /info should return server info', async () => {
      const response = await request(port, '/info');
      expect(response.status).toBe(200);
      
      const body = response.body as { name: string; version: string; endpoints: string[] };
      expect(body.name).toBe('ReachVet API');
      expect(body.version).toBe('0.5.0');
      expect(body.endpoints).toContain('POST /analyze       - Analyze project');
    });

    it('GET /languages should return supported languages', async () => {
      const response = await request(port, '/languages');
      expect(response.status).toBe(200);
      
      const body = response.body as { languages: string[] };
      expect(body.languages).toContain('javascript');
      expect(body.languages).toContain('python');
      expect(body.languages).toContain('rust');
      expect(body.languages.length).toBe(18);
    });
  });

  describe('CORS Support', () => {
    it('should handle OPTIONS preflight with CORS enabled', async () => {
      const port = getNextPort();
      const server = await startServer({ port, cors: true });
      
      const response = await request(port, '/analyze', { method: 'OPTIONS' });
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
      
      await server.stop();
    });

    it('should include CORS headers in responses', async () => {
      const port = getNextPort();
      const server = await startServer({ port, cors: true });
      
      const response = await request(port, '/');
      expect(response.headers['access-control-allow-origin']).toBe('*');
      
      await server.stop();
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const port = getNextPort();
      const server = await startServer({
        port,
        rateLimit: { windowMs: 60000, maxRequests: 3 },
      });

      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const response = await request(port, '/');
        expect(response.status).toBe(200);
      }

      // 4th request should be rate limited
      const response = await request(port, '/');
      expect(response.status).toBe(429);
      expect((response.body as { error: string }).error).toBe('Too many requests');
      
      await server.stop();
    });
  });

  describe('API Key Authentication', () => {
    it('should reject requests without API key when required', async () => {
      const port = getNextPort();
      const server = await startServer({
        port,
        apiKey: 'test-secret-key',
        rateLimit: undefined,
      });

      const response = await request(port, '/');
      expect(response.status).toBe(401);
      expect((response.body as { error: string }).error).toBe('Unauthorized');
      
      await server.stop();
    });

    it('should accept requests with correct API key', async () => {
      const port = getNextPort();
      const server = await startServer({
        port,
        apiKey: 'test-secret-key',
        rateLimit: undefined,
      });

      const response = await request(port, '/', {
        headers: { Authorization: 'Bearer test-secret-key' },
      });
      expect(response.status).toBe(200);
      
      await server.stop();
    });

    it('should reject requests with incorrect API key', async () => {
      const port = getNextPort();
      const server = await startServer({
        port,
        apiKey: 'test-secret-key',
        rateLimit: undefined,
      });

      const response = await request(port, '/', {
        headers: { Authorization: 'Bearer wrong-key' },
      });
      expect(response.status).toBe(401);
      
      await server.stop();
    });
  });

  describe('Analysis Endpoint', () => {
    let server: ReachVetServer;
    let port: number;

    beforeAll(async () => {
      port = getNextPort();
      server = await startServer({ port, rateLimit: undefined });
    });

    afterAll(async () => {
      await server.stop();
    });

    it('POST /analyze should require body', async () => {
      const response = await request(port, '/analyze', { method: 'POST' });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toBe('Request body required');
    });

    it('POST /analyze should require projectPath or sbom', async () => {
      const response = await request(port, '/analyze', {
        method: 'POST',
        body: { language: 'javascript' },
      });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toContain('projectPath');
    });

    it('POST /analyze should reject virtual content (not yet supported)', async () => {
      const response = await request(port, '/analyze', {
        method: 'POST',
        body: { content: { 'index.js': "const x = require('lodash');" } },
      });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toContain('Virtual project analysis not yet supported');
    });
  });

  describe('Check Endpoint', () => {
    let server: ReachVetServer;
    let port: number;

    beforeAll(async () => {
      port = getNextPort();
      server = await startServer({ port, rateLimit: undefined });
    });

    afterAll(async () => {
      await server.stop();
    });

    it('POST /check should require packageName', async () => {
      const response = await request(port, '/check', {
        method: 'POST',
        body: {},
      });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toBe('packageName required');
    });

    it('POST /check should accept valid request', async () => {
      const response = await request(port, '/check', {
        method: 'POST',
        body: {
          packageName: 'lodash',
          codeSnippet: "const _ = require('lodash'); _.merge({}, {});",
          language: 'javascript',
        },
      });
      expect(response.status).toBe(200);
      const body = response.body as { packageName: string; isImported: boolean };
      expect(body.packageName).toBe('lodash');
      expect(body.isImported).toBe(true);
    });
  });

  describe('OSV Endpoints', () => {
    let server: ReachVetServer;
    let port: number;

    beforeAll(async () => {
      port = getNextPort();
      server = await startServer({ port, rateLimit: undefined, osvCache: false });
    });

    afterAll(async () => {
      await server.stop();
    });

    it('POST /osv/query should require package info', async () => {
      const response = await request(port, '/osv/query', {
        method: 'POST',
        body: {},
      });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toContain('package.name and package.ecosystem required');
    });

    it('POST /osv/query should require version', async () => {
      const response = await request(port, '/osv/query', {
        method: 'POST',
        body: {
          package: { name: 'lodash', ecosystem: 'npm' },
        },
      });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toBe('version required');
    });

    it('POST /osv/query should accept valid request with version', async () => {
      const response = await request(port, '/osv/query', {
        method: 'POST',
        body: {
          package: { name: 'lodash', ecosystem: 'npm' },
          version: '4.17.21',
        },
      });
      // May return vulns or empty array, or 500 if OSV is down
      // Just check it doesn't crash with bad request
      expect([200, 500]).toContain(response.status);
    });

    it('POST /osv/batch should require queries array', async () => {
      const response = await request(port, '/osv/batch', {
        method: 'POST',
        body: {},
      });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toBe('queries array required');
    });

    it('POST /osv/batch should limit to 100 queries', async () => {
      const queries = Array.from({ length: 101 }, (_, i) => ({
        package: { name: `pkg-${i}`, ecosystem: 'npm' },
        version: '1.0.0',
      }));
      
      const response = await request(port, '/osv/batch', {
        method: 'POST',
        body: { queries },
      });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toBe('Maximum 100 queries per batch');
    });

    it('POST /osv/batch should require version in each query', async () => {
      const queries = [
        { package: { name: 'lodash', ecosystem: 'npm' } }, // missing version
      ];
      
      const response = await request(port, '/osv/batch', {
        method: 'POST',
        body: { queries },
      });
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toContain('requires package.name, package.ecosystem, and version');
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for unknown paths', async () => {
      const port = getNextPort();
      const server = await startServer({ port, rateLimit: undefined });
      
      const response = await request(port, '/unknown/endpoint');
      expect(response.status).toBe(404);
      expect((response.body as { error: string }).error).toBe('Not found');
      
      await server.stop();
    });
  });

  describe('Response Headers', () => {
    let server: ReachVetServer;
    let port: number;

    beforeAll(async () => {
      port = getNextPort();
      server = await startServer({ port, rateLimit: undefined });
    });

    afterAll(async () => {
      await server.stop();
    });

    it('should include X-Response-Time header', async () => {
      const response = await request(port, '/');
      expect(response.headers['x-response-time']).toMatch(/^\d+ms$/);
    });

    it('should include Content-Type header', async () => {
      const response = await request(port, '/');
      expect(response.headers['content-type']).toContain('application/json');
    });
  });

  describe('Server Stats', () => {
    it('should track request count', async () => {
      const port = getNextPort();
      const server = await startServer({ port, rateLimit: undefined });
      
      // Make some requests
      await request(port, '/');
      await request(port, '/info');
      await request(port, '/languages');

      const stats = server.getStats();
      expect(stats.requests).toBe(3);
      expect(stats.uptime).toBeGreaterThan(0);
      expect(stats.port).toBe(port);
      
      await server.stop();
    });
  });

  describe('Event Emitter', () => {
    it('should emit request events', async () => {
      const port = getNextPort();
      const server = new ReachVetServer({ port, rateLimit: undefined });
      
      const requestEvents: { status: number; path: string }[] = [];
      server.on('request', (event) => {
        requestEvents.push(event);
      });

      await server.start();
      await request(port, '/');
      await request(port, '/info');

      expect(requestEvents.length).toBe(2);
      expect(requestEvents[0].status).toBe(200);
      expect(requestEvents[1].path).toBe('/info');
      
      await server.stop();
    });
  });
});

describe('ReachVetServer Edge Cases', () => {
  it('should handle large request bodies up to limit', async () => {
    const port = getNextPort();
    const server = await startServer({ port, rateLimit: undefined });

    // 1MB body should be accepted
    const largeBody = { data: 'x'.repeat(1024 * 1024) };
    const response = await request(port, '/analyze', {
      method: 'POST',
      body: largeBody,
    });
    // Will fail validation but should not crash
    expect(response.status).toBe(400);
    
    await server.stop();
  });

  it('should handle concurrent requests', async () => {
    const port = getNextPort();
    const server = await startServer({ port, rateLimit: undefined });

    const promises = Array.from({ length: 10 }, () => request(port, '/'));
    const responses = await Promise.all(promises);

    expect(responses.every((r) => r.status === 200)).toBe(true);
    
    await server.stop();
  });

  it('should handle malformed JSON gracefully', async () => {
    const port = getNextPort();
    const server = await startServer({ port, rateLimit: undefined });

    const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/analyze',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            try {
              resolve({ status: res.statusCode || 0, body: JSON.parse(body) });
            } catch {
              resolve({ status: res.statusCode || 0, body });
            }
          });
        }
      );
      req.on('error', reject);
      req.write('{ invalid json');
      req.end();
    });

    // Should handle non-JSON gracefully
    expect(response.status).toBe(400);
    
    await server.stop();
  });

  it('should stop gracefully even if no requests were made', async () => {
    const port = getNextPort();
    const server = new ReachVetServer({ port });
    await server.start();
    await server.stop();
    // Should not throw
  });

  it('should handle stop called multiple times', async () => {
    const port = getNextPort();
    const server = new ReachVetServer({ port });
    await server.start();
    await server.stop();
    await server.stop(); // Second stop should be no-op
    // Should not throw
  });
});
