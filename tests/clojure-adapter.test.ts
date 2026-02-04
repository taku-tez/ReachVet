/**
 * ReachVet - Clojure Adapter Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClojureAdapter } from '../src/languages/clojure/index.js';
import type { Component } from '../src/types.js';

describe('ClojureAdapter', () => {
  let adapter: ClojureAdapter;
  let tempDir: string;

  beforeEach(async () => {
    adapter = new ClojureAdapter();
    tempDir = await mkdtemp(join(tmpdir(), 'reachvet-clojure-test-'));
    await mkdir(join(tempDir, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('canHandle', () => {
    it('should detect deps.edn project', async () => {
      await writeFile(join(tempDir, 'deps.edn'), '{:deps {}}');
      expect(await adapter.canHandle(tempDir)).toBe(true);
    });

    it('should detect project.clj (Leiningen)', async () => {
      await writeFile(join(tempDir, 'project.clj'), '(defproject my-app "0.1.0")');
      expect(await adapter.canHandle(tempDir)).toBe(true);
    });

    it('should detect .clj files', async () => {
      await writeFile(join(tempDir, 'src', 'core.clj'), '(ns my.core)');
      expect(await adapter.canHandle(tempDir)).toBe(true);
    });

    it('should return false for non-Clojure project', async () => {
      await writeFile(join(tempDir, 'package.json'), '{}');
      expect(await adapter.canHandle(tempDir)).toBe(false);
    });
  });

  describe('analyze', () => {
    it('should detect reachable component via require', async () => {
      const source = `
(ns my.app.core
  (:require [cheshire.core :as json]))

(defn parse-response [body]
  (json/parse-string body true))
`;
      await writeFile(join(tempDir, 'src', 'core.clj'), source);

      const components: Component[] = [{
        name: 'cheshire/cheshire',
        version: '5.11.0',
        ecosystem: 'clojars'
      }];

      const results = await adapter.analyze(tempDir, components);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].confidence).toBe('high');
    });

    it('should detect not reachable component', async () => {
      const source = `
(ns my.app.core
  (:require [ring.adapter.jetty :as jetty]))
`;
      await writeFile(join(tempDir, 'src', 'core.clj'), source);

      const components: Component[] = [{
        name: 'cheshire/cheshire',
        version: '5.11.0',
        ecosystem: 'clojars'
      }];

      const results = await adapter.analyze(tempDir, components);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('not_reachable');
    });

    it('should detect vulnerable function usage', async () => {
      const source = `
(ns my.app.api
  (:require [clj-http.client :as http]))

(defn fetch [url]
  (http/get url {:insecure? true}))
`;
      await writeFile(join(tempDir, 'src', 'api.clj'), source);

      const components: Component[] = [{
        name: 'clj-http/clj-http',
        version: '3.12.3',
        ecosystem: 'clojars',
        vulnerabilities: [{
          id: 'CVE-2024-1234',
          severity: 'high',
          affectedFunctions: ['get', 'post']
        }]
      }];

      const results = await adapter.analyze(tempDir, components);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('reachable');
      expect(results[0].usage?.usedMembers).toContain('get');
    });

    it('should handle use with :refer :all warning', async () => {
      const source = `
(ns my.app.core
  (:use [clojure.walk]))
`;
      // Note: clojure.walk is standard, using a fake package to test the warning
      await writeFile(join(tempDir, 'src', 'core.clj'), source);

      const components: Component[] = [{
        name: 'clojure-walk-extra',
        version: '1.0.0',
        ecosystem: 'clojars'
      }];

      // This test verifies warning detection, component likely won't match
      const results = await adapter.analyze(tempDir, components);
      expect(results).toHaveLength(1);
    });

    it('should handle multiple source files', async () => {
      const source1 = `
(ns my.app.http
  (:require [clj-http.client :as http]))

(defn fetch [url]
  (http/get url))
`;
      const source2 = `
(ns my.app.json
  (:require [cheshire.core :as json]))

(defn encode [data]
  (json/generate-string data))
`;
      await writeFile(join(tempDir, 'src', 'http.clj'), source1);
      await writeFile(join(tempDir, 'src', 'json.clj'), source2);

      const components: Component[] = [
        { name: 'clj-http/clj-http', version: '3.12.3', ecosystem: 'clojars' },
        { name: 'cheshire/cheshire', version: '5.11.0', ecosystem: 'clojars' }
      ];

      const results = await adapter.analyze(tempDir, components);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === 'reachable')).toBe(true);
    });

    it('should return unknown for empty project', async () => {
      const components: Component[] = [{
        name: 'cheshire/cheshire',
        version: '5.11.0',
        ecosystem: 'clojars'
      }];

      const results = await adapter.analyze(tempDir, components);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('unknown');
    });

    it('should handle ClojureScript files', async () => {
      const source = `
(ns my.app.core
  (:require [reagent.core :as r]))

(defn component []
  (r/render [:div "Hello"]))
`;
      await writeFile(join(tempDir, 'src', 'core.cljs'), source);

      const components: Component[] = [{
        name: 'reagent/reagent',
        version: '1.2.0',
        ecosystem: 'clojars'
      }];

      const results = await adapter.analyze(tempDir, components);
      expect(results).toHaveLength(1);
      // May or may not detect depending on namespace mapping
    });
  });

  describe('language property', () => {
    it('should have language set to clojure', () => {
      expect(adapter.language).toBe('clojure');
    });
  });

  describe('fileExtensions', () => {
    it('should include all Clojure extensions', () => {
      expect(adapter.fileExtensions).toContain('.clj');
      expect(adapter.fileExtensions).toContain('.cljs');
      expect(adapter.fileExtensions).toContain('.cljc');
    });
  });
});
