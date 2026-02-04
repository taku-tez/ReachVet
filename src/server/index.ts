/**
 * ReachVet API Server
 * 
 * Lightweight HTTP server for programmatic access to ReachVet analysis.
 * Designed for CI/CD integration and tool interoperability.
 */

import * as http from 'http';
import * as url from 'url';
import { EventEmitter } from 'events';
import { Analyzer } from '../core/analyzer.js';
import { OSVClient, OSVCache } from '../osv/index.js';
import { toSarif } from '../output/sarif.js';
import { getAdapter, detectLanguage, parseJsSource } from '../languages/index.js';
import { parseSBOM } from '../input/index.js';
import type { AnalysisOutput, SupportedLanguage, Component } from '../types.js';

export interface ServerConfig {
  port: number;
  host: string;
  cors?: boolean;
  apiKey?: string;
  rateLimit?: {
    windowMs: number;
    maxRequests: number;
  };
  osvCache?: boolean;
  cacheTtl?: number;
}

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: http.IncomingHttpHeaders;
}

export interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const DEFAULT_CONFIG: ServerConfig = {
  port: 3000,
  host: '127.0.0.1',
  cors: true,
  rateLimit: {
    windowMs: 60000,
    maxRequests: 100,
  },
  osvCache: true,
  cacheTtl: 3600000, // 1 hour
};

export class ReachVetServer extends EventEmitter {
  private server: http.Server | null = null;
  private config: ServerConfig;
  private osvClient: OSVClient;
  private osvCacheInstance: OSVCache | null = null;
  private rateLimitMap: Map<string, RateLimitEntry> = new Map();
  private requestCount = 0;
  private startTime: number = 0;

  constructor(config: Partial<ServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.osvClient = new OSVClient();
    
    if (this.config.osvCache) {
      this.osvCacheInstance = new OSVCache(undefined, this.config.cacheTtl);
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        await this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.startTime = Date.now();
        this.emit('listening', { port: this.config.port, host: this.config.host });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.emit('closed');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.requestCount++;
    const startMs = Date.now();
    
    try {
      // Parse request
      const parsedUrl = url.parse(req.url || '/', true);
      const path = parsedUrl.pathname || '/';
      const query = parsedUrl.query as Record<string, string>;
      
      // Read body for POST/PUT
      let body: unknown = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        body = await this.readBody(req);
      }
      
      const apiRequest: ApiRequest = {
        method: req.method || 'GET',
        path,
        query,
        body,
        headers: req.headers,
      };

      // CORS preflight
      if (this.config.cors && req.method === 'OPTIONS') {
        this.sendResponse(res, { status: 204, body: null }, startMs);
        return;
      }

      // Rate limiting
      if (this.config.rateLimit) {
        const clientIp = this.getClientIp(req);
        if (!this.checkRateLimit(clientIp)) {
          this.sendResponse(res, {
            status: 429,
            body: { error: 'Too many requests', retryAfter: this.getRateLimitReset(clientIp) },
          }, startMs);
          return;
        }
      }

      // API key auth
      if (this.config.apiKey) {
        const authHeader = req.headers.authorization;
        const providedKey = authHeader?.replace('Bearer ', '');
        if (providedKey !== this.config.apiKey) {
          this.sendResponse(res, { status: 401, body: { error: 'Unauthorized' } }, startMs);
          return;
        }
      }

      // Route request
      const response = await this.route(apiRequest);
      this.sendResponse(res, response, startMs);
      
    } catch (err) {
      const error = err as Error;
      this.emit('error', error);
      this.sendResponse(res, {
        status: 500,
        body: { error: 'Internal server error', message: error.message },
      }, startMs);
    }
  }

  private async route(req: ApiRequest): Promise<ApiResponse> {
    const { method, path } = req;

    // Health & info endpoints
    if (path === '/' || path === '/health') {
      return { status: 200, body: { status: 'ok', version: '0.5.0' } };
    }

    if (path === '/info') {
      return {
        status: 200,
        body: {
          name: 'ReachVet API',
          version: '0.5.0',
          uptime: Date.now() - this.startTime,
          requestCount: this.requestCount,
          endpoints: [
            'GET  /              - Health check',
            'GET  /info          - Server info',
            'POST /analyze       - Analyze project',
            'POST /check         - Check dependency',
            'POST /osv/query     - Query OSV database',
            'POST /osv/batch     - Batch OSV query',
            'GET  /languages     - List supported languages',
          ],
        },
      };
    }

    // Analysis endpoint
    if (method === 'POST' && path === '/analyze') {
      return await this.handleAnalyze(req);
    }

    // Check endpoint
    if (method === 'POST' && path === '/check') {
      return await this.handleCheck(req);
    }

    // OSV endpoints
    if (method === 'POST' && path === '/osv/query') {
      return await this.handleOsvQuery(req);
    }

    if (method === 'POST' && path === '/osv/batch') {
      return await this.handleOsvBatch(req);
    }

    // Languages endpoint
    if (method === 'GET' && path === '/languages') {
      return {
        status: 200,
        body: {
          languages: [
            'javascript', 'typescript', 'python', 'go', 'java', 'rust',
            'ruby', 'php', 'csharp', 'swift', 'kotlin', 'scala',
            'elixir', 'dart', 'perl', 'haskell', 'clojure', 'ocaml',
          ],
        },
      };
    }

    return { status: 404, body: { error: 'Not found' } };
  }

  private async handleAnalyze(req: ApiRequest): Promise<ApiResponse> {
    const body = req.body as {
      projectPath?: string;
      language?: SupportedLanguage;
      sbom?: string;
      components?: Component[];
      content?: Record<string, string>;
      format?: 'json' | 'sarif';
      osv?: boolean;
    };

    if (!body) {
      return { status: 400, body: { error: 'Request body required' } };
    }

    // Virtual project from content
    if (body.content) {
      // For virtual projects, we'd need to implement in-memory analysis
      // For now, require projectPath or sbom
      return { status: 400, body: { error: 'Virtual project analysis not yet supported. Provide projectPath or sbom.' } };
    }

    if (!body.projectPath && !body.sbom && !body.components) {
      return { status: 400, body: { error: 'projectPath, sbom, or components required' } };
    }

    try {
      // Parse components from SBOM or use provided
      let components: Component[] = body.components || [];
      
      if (body.sbom) {
        try {
          components = await parseSBOM(body.sbom);
        } catch (sbomErr) {
          return { status: 400, body: { error: 'Failed to parse SBOM', message: (sbomErr as Error).message } };
        }
      }

      if (components.length === 0) {
        return { status: 400, body: { error: 'No components to analyze. Provide sbom or components.' } };
      }

      // Run analysis
      const analyzer = new Analyzer({
        sourceDir: body.projectPath || '.',
        language: body.language,
        osvLookup: body.osv ?? false,
      });

      const result = await analyzer.analyze(components);

      // Format conversion
      if (body.format === 'sarif') {
        const sarif = toSarif(result);
        return { status: 200, body: sarif };
      }

      // Default: JSON format
      return { status: 200, body: result };
    } catch (err) {
      const error = err as Error;
      return { status: 400, body: { error: 'Analysis failed', message: error.message } };
    }
  }

  private async handleCheck(req: ApiRequest): Promise<ApiResponse> {
    const body = req.body as {
      packageName: string;
      ecosystem?: string;
      version?: string;
      vulnerability?: {
        id: string;
        functions?: string[];
      };
      codeSnippet?: string;
      language?: SupportedLanguage;
    };

    if (!body?.packageName) {
      return { status: 400, body: { error: 'packageName required' } };
    }

    try {
      // Quick check: analyze codeSnippet for package usage
      const language = body.language || 'javascript';
      
      // For now, only JavaScript/TypeScript is supported for quick check
      if (language !== 'javascript' && language !== 'typescript') {
        return { status: 400, body: { error: `Quick check only supports JavaScript/TypeScript, got: ${language}` } };
      }

      // If code snippet provided, analyze it directly
      let result: {
        packageName: string;
        isImported: boolean;
        isReachable: boolean;
        usedFunctions: string[];
        vulnerableFunctionsReached: string[];
        codeLocations: Array<{ line: number; column?: number }>;
      };

      if (body.codeSnippet) {
        // Parse the code snippet using JavaScript parser
        const imports = parseJsSource(body.codeSnippet, 'snippet.ts');
        
        // Check if package is imported
        const isImported = imports.some(imp => 
          imp.moduleName === body.packageName ||
          imp.moduleName.startsWith(`${body.packageName}/`)
        );

        // Find function usages
        const usedFunctions: string[] = [];
        const codeLocations: Array<{ line: number; column?: number }> = [];

        for (const imp of imports) {
          if (imp.moduleName === body.packageName || imp.moduleName.startsWith(`${body.packageName}/`)) {
            // Add named imports
            usedFunctions.push(...imp.namedImports);
            
            // Add default/namespace import if present
            if (imp.localName && !imp.isNamespaceImport) {
              usedFunctions.push(imp.localName);
            }
            
            codeLocations.push({ line: imp.location.line, column: imp.location.column });
          }
        }

        // Check if any vulnerable functions are used
        const vulnerableFunctionsReached = body.vulnerability?.functions?.filter(fn => 
          usedFunctions.includes(fn)
        ) || [];

        result = {
          packageName: body.packageName,
          isImported,
          isReachable: isImported,
          usedFunctions: [...new Set(usedFunctions)],
          vulnerableFunctionsReached,
          codeLocations,
        };
      } else {
        // No code snippet, return basic info
        result = {
          packageName: body.packageName,
          isImported: false,
          isReachable: false,
          usedFunctions: [],
          vulnerableFunctionsReached: [],
          codeLocations: [],
        };
      }

      return { status: 200, body: result };
    } catch (err) {
      const error = err as Error;
      return { status: 400, body: { error: 'Check failed', message: error.message } };
    }
  }

  private async handleOsvQuery(req: ApiRequest): Promise<ApiResponse> {
    const body = req.body as {
      package: { name: string; ecosystem: string };
      version?: string;
    };

    if (!body?.package?.name || !body?.package?.ecosystem) {
      return { status: 400, body: { error: 'package.name and package.ecosystem required' } };
    }

    try {
      // Check cache first
      if (this.osvCacheInstance) {
        const cached = await this.osvCacheInstance.get(body.package.name, body.package.ecosystem);
        if (cached) {
          return { status: 200, body: { vulns: cached, cached: true } };
        }
      }

      const vulns = await this.osvClient.query(body.package.name, body.package.ecosystem, body.version);

      // Cache result
      if (this.osvCacheInstance && vulns.length > 0) {
        await this.osvCacheInstance.set(body.package.name, body.package.ecosystem, vulns);
      }

      return { status: 200, body: { vulns, cached: false } };
    } catch (err) {
      const error = err as Error;
      return { status: 500, body: { error: 'OSV query failed', message: error.message } };
    }
  }

  private async handleOsvBatch(req: ApiRequest): Promise<ApiResponse> {
    const body = req.body as {
      queries: Array<{ package: { name: string; ecosystem: string }; version?: string }>;
    };

    if (!body?.queries || !Array.isArray(body.queries)) {
      return { status: 400, body: { error: 'queries array required' } };
    }

    if (body.queries.length > 100) {
      return { status: 400, body: { error: 'Maximum 100 queries per batch' } };
    }

    try {
      const results = await this.osvClient.queryBatch(
        body.queries.map(q => ({
          name: q.package.name,
          ecosystem: q.package.ecosystem,
          version: q.version,
        }))
      );

      return { status: 200, body: { results } };
    } catch (err) {
      const error = err as Error;
      return { status: 500, body: { error: 'OSV batch query failed', message: error.message } };
    }
  }

  private async readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalLength = 0;
      const maxBodySize = 10 * 1024 * 1024; // 10MB

      req.on('data', (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > maxBodySize) {
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (!body) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });

      req.on('error', reject);
    });
  }

  private sendResponse(res: http.ServerResponse, response: ApiResponse, startMs: number): void {
    const { status, headers = {}, body } = response;
    const durationMs = Date.now() - startMs;

    // Default headers
    const finalHeaders: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Response-Time': `${durationMs}ms`,
      ...headers,
    };

    // CORS headers
    if (this.config.cors) {
      finalHeaders['Access-Control-Allow-Origin'] = '*';
      finalHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      finalHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }

    res.writeHead(status, finalHeaders);

    if (body === null) {
      res.end();
    } else if (typeof body === 'string') {
      res.end(body);
    } else {
      res.end(JSON.stringify(body, null, 2));
    }

    this.emit('request', { status, durationMs, path: res.req?.url });
  }

  private getClientIp(req: http.IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  private checkRateLimit(clientIp: string): boolean {
    if (!this.config.rateLimit) return true;

    const now = Date.now();
    const entry = this.rateLimitMap.get(clientIp);

    if (!entry || now > entry.resetAt) {
      this.rateLimitMap.set(clientIp, {
        count: 1,
        resetAt: now + this.config.rateLimit.windowMs,
      });
      return true;
    }

    if (entry.count >= this.config.rateLimit.maxRequests) {
      return false;
    }

    entry.count++;
    return true;
  }

  private getRateLimitReset(clientIp: string): number {
    const entry = this.rateLimitMap.get(clientIp);
    if (!entry) return 0;
    return Math.ceil((entry.resetAt - Date.now()) / 1000);
  }

  getStats(): { uptime: number; requests: number; port: number } {
    return {
      uptime: Date.now() - this.startTime,
      requests: this.requestCount,
      port: this.config.port,
    };
  }
}

/**
 * Create and start a ReachVet API server
 */
export async function startServer(config: Partial<ServerConfig> = {}): Promise<ReachVetServer> {
  const server = new ReachVetServer(config);
  await server.start();
  return server;
}

export default ReachVetServer;
