/**
 * ReachVet - Clojure Parser Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseSource,
  findNamespaceUsages,
  parseDepsEdnContent,
  parseProjectCljContent,
  getNamespacesForPackage,
  isStandardNamespace
} from '../src/languages/clojure/parser.js';

describe('Clojure Parser', () => {
  describe('parseSource - ns form', () => {
    it('should parse ns with :require', () => {
      const source = `
(ns my.app.core
  (:require [clj-http.client :as http]
            [cheshire.core :as json]))
`;
      const imports = parseSource(source, 'core.clj');
      expect(imports).toHaveLength(2);
      expect(imports[0]).toMatchObject({
        namespaceName: 'clj-http.client',
        importStyle: 'require',
        alias: 'http'
      });
      expect(imports[1]).toMatchObject({
        namespaceName: 'cheshire.core',
        importStyle: 'require',
        alias: 'json'
      });
    });

    it('should parse ns with :refer', () => {
      const source = `
(ns my.app.core
  (:require [compojure.core :refer [defroutes GET POST]]))
`;
      const imports = parseSource(source, 'core.clj');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({
        namespaceName: 'compojure.core',
        importStyle: 'require',
        referred: ['defroutes', 'GET', 'POST']
      });
    });

    it('should parse ns with :import', () => {
      const source = `
(ns my.app.core
  (:import [java.util Date ArrayList]
           [java.io File]))
`;
      const imports = parseSource(source, 'core.clj');
      expect(imports.length).toBeGreaterThanOrEqual(3);
      
      const dateImport = imports.find(i => i.namespaceName === 'java.util.Date');
      expect(dateImport).toBeDefined();
      expect(dateImport?.importStyle).toBe('import');
    });

    it('should parse ns with :use', () => {
      const source = `
(ns my.app.core
  (:use [clojure.walk :only [postwalk]]))
`;
      const imports = parseSource(source, 'core.clj');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({
        namespaceName: 'clojure.walk',
        importStyle: 'use',
        referred: ['postwalk']
      });
    });

    it('should parse combined ns form', () => {
      const source = `
(ns my.app.server
  (:require [ring.adapter.jetty :as jetty]
            [compojure.core :refer [routes GET]]
            [cheshire.core :as json])
  (:import [java.time Instant]
           [java.util UUID]))
`;
      const imports = parseSource(source, 'server.clj');
      expect(imports.length).toBeGreaterThanOrEqual(5);
      
      const jettyImport = imports.find(i => i.namespaceName === 'ring.adapter.jetty');
      expect(jettyImport?.alias).toBe('jetty');
      
      const compojureImport = imports.find(i => i.namespaceName === 'compojure.core');
      expect(compojureImport?.referred).toContain('GET');
    });
  });

  describe('parseSource - standalone forms', () => {
    it('should parse standalone (require ...)', () => {
      const source = `
(require '[clj-http.client :as http])
(require '[cheshire.core])
`;
      const imports = parseSource(source, 'file.clj');
      expect(imports).toHaveLength(2);
      expect(imports[0].namespaceName).toBe('clj-http.client');
      expect(imports[0].alias).toBe('http');
      expect(imports[1].namespaceName).toBe('cheshire.core');
    });

    it('should parse standalone (use ...)', () => {
      const source = `(use 'clojure.walk)`;
      const imports = parseSource(source, 'file.clj');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({
        namespaceName: 'clojure.walk',
        importStyle: 'use',
        referAll: true
      });
    });

    it('should parse standalone (import ...)', () => {
      const source = `(import '[java.util Date ArrayList HashMap])`;
      const imports = parseSource(source, 'file.clj');
      expect(imports.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('parseSource - edge cases', () => {
    it('should skip comments', () => {
      const source = `
; This is a comment
(ns my.app.core
  ; Another comment
  (:require [cheshire.core :as json]))
`;
      const imports = parseSource(source, 'core.clj');
      expect(imports).toHaveLength(1);
    });

    it('should handle multiline require blocks', () => {
      const source = `(ns my.app.core
  (:require
    [clj-http.client :as http]
    [ring.adapter.jetty :as jetty]
    [compojure.core :refer [defroutes
                            GET
                            POST
                            routes]]))`;
      const imports = parseSource(source, 'core.clj');
      expect(imports.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('findNamespaceUsages', () => {
    it('should find function calls with alias', () => {
      const source = `
(ns my.app.core
  (:require [clj-http.client :as http]))

(defn fetch-data [url]
  (http/get url))

(defn post-data [url body]
  (http/post url {:body body}))
`;
      const usages = findNamespaceUsages(source, ['clj-http.client'], 'core.clj');
      expect(usages.length).toBeGreaterThanOrEqual(2);
      
      const functions = usages.map(u => u.function);
      expect(functions).toContain('get');
      expect(functions).toContain('post');
    });

    it('should find function calls with full namespace', () => {
      const source = `
(ns my.app.core
  (:require [cheshire.core]))

(defn parse [s]
  (cheshire.core/parse-string s))
`;
      const usages = findNamespaceUsages(source, ['cheshire.core'], 'core.clj');
      expect(usages.length).toBeGreaterThanOrEqual(1);
      expect(usages.some(u => u.function === 'parse-string')).toBe(true);
    });
  });

  describe('parseDepsEdnContent', () => {
    it('should parse deps.edn with mvn versions', () => {
      const content = `
{:paths ["src" "resources"]
 :deps {org.clojure/clojure {:mvn/version "1.11.1"}
        clj-http/clj-http {:mvn/version "3.12.3"}
        cheshire/cheshire {:mvn/version "5.11.0"}}
 :aliases {:dev {:extra-deps {nrepl/nrepl {:mvn/version "1.0.0"}}}}}
`;
      const deps = parseDepsEdnContent(content);
      expect(deps.length).toBeGreaterThanOrEqual(3);
      
      const cljHttp = deps.find(d => d.name === 'clj-http/clj-http');
      expect(cljHttp?.version).toBe('3.12.3');
      
      const cheshire = deps.find(d => d.name === 'cheshire/cheshire');
      expect(cheshire?.version).toBe('5.11.0');
    });

    it('should parse deps.edn with git deps', () => {
      const content = `
{:deps {io.github.user/lib {:git/url "https://github.com/user/lib"
                            :git/sha "abc123def"}}}
`;
      const deps = parseDepsEdnContent(content);
      expect(deps).toHaveLength(1);
      expect(deps[0].gitUrl).toBe('https://github.com/user/lib');
      expect(deps[0].sha).toBe('abc123def');
    });

    it('should parse deps.edn with local deps', () => {
      const content = `
{:deps {my/lib {:local/root "../my-lib"}}}
`;
      const deps = parseDepsEdnContent(content);
      expect(deps).toHaveLength(1);
      expect(deps[0].localRoot).toBe('../my-lib');
    });
  });

  describe('parseProjectCljContent', () => {
    it('should parse project.clj dependencies', () => {
      const content = `
(defproject my-app "0.1.0"
  :description "My Clojure App"
  :dependencies [[org.clojure/clojure "1.11.1"]
                 [clj-http "3.12.3"]
                 [cheshire "5.11.0"]
                 [ring/ring-core "1.9.6"]]
  :main my-app.core)
`;
      const deps = parseProjectCljContent(content);
      expect(deps.length).toBeGreaterThanOrEqual(4);
      
      const cljHttp = deps.find(d => d.name === 'clj-http');
      expect(cljHttp?.version).toBe('3.12.3');
      
      const ring = deps.find(d => d.name === 'ring/ring-core');
      expect(ring?.version).toBe('1.9.6');
    });
  });

  describe('getNamespacesForPackage', () => {
    it('should return known namespaces for common packages', () => {
      expect(getNamespacesForPackage('cheshire/cheshire')).toContain('cheshire.core');
      expect(getNamespacesForPackage('clj-http/clj-http')).toContain('clj-http.client');
      expect(getNamespacesForPackage('ring/ring')).toContain('ring.adapter.jetty');
    });

    it('should infer namespace for unknown packages', () => {
      const ns = getNamespacesForPackage('my-lib/my-lib');
      expect(ns).toContain('my-lib.core');
      expect(ns).toContain('my-lib');
    });
  });

  describe('isStandardNamespace', () => {
    it('should recognize standard namespaces', () => {
      expect(isStandardNamespace('clojure.core')).toBe(true);
      expect(isStandardNamespace('clojure.string')).toBe(true);
      expect(isStandardNamespace('clojure.test')).toBe(true);
      expect(isStandardNamespace('java.util.Date')).toBe(true);
    });

    it('should not recognize third-party namespaces', () => {
      expect(isStandardNamespace('cheshire.core')).toBe(false);
      expect(isStandardNamespace('ring.adapter.jetty')).toBe(false);
      expect(isStandardNamespace('compojure.core')).toBe(false);
    });
  });
});
