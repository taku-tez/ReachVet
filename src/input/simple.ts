/**
 * ReachVet - Simple JSON Input Parser
 * 
 * Accepts a simple JSON format:
 * [
 *   { "name": "lodash", "version": "4.17.20" },
 *   { "name": "express", "version": "4.18.0" }
 * ]
 * 
 * Or with vulnerabilities:
 * [
 *   { 
 *     "name": "lodash", 
 *     "version": "4.17.20",
 *     "vulnerabilities": [
 *       { "id": "CVE-2021-23337", "affectedFunctions": ["template"] }
 *     ]
 *   }
 * ]
 */

import { readFile } from 'node:fs/promises';
import type { Component, ComponentVulnerability } from '../types.js';

interface SimpleComponentInput {
  name: string;
  version: string;
  ecosystem?: string;
  vulnerabilities?: Array<{
    id: string;
    severity?: string;
    affectedFunctions?: string[];
    fixedVersion?: string;
    description?: string;
  }>;
}

/**
 * Parse simple JSON component list
 */
export async function parseSimpleJson(filePath: string): Promise<Component[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseSimpleJsonString(content);
}

/**
 * Parse simple JSON string
 */
export function parseSimpleJsonString(content: string): Component[] {
  const data = JSON.parse(content) as SimpleComponentInput[];
  
  if (!Array.isArray(data)) {
    throw new Error('Input must be an array of components');
  }

  return data.map((item, index) => {
    if (!item.name || typeof item.name !== 'string') {
      throw new Error(`Component at index ${index} missing 'name'`);
    }
    if (!item.version || typeof item.version !== 'string') {
      throw new Error(`Component at index ${index} missing 'version'`);
    }

    const component: Component = {
      name: item.name,
      version: item.version,
      ecosystem: item.ecosystem ?? 'npm',
      purl: `pkg:npm/${item.name}@${item.version}`
    };

    if (item.vulnerabilities && Array.isArray(item.vulnerabilities)) {
      component.vulnerabilities = item.vulnerabilities.map(v => ({
        id: v.id,
        severity: (v.severity as ComponentVulnerability['severity']) ?? 'unknown',
        affectedFunctions: v.affectedFunctions,
        fixedVersion: v.fixedVersion,
        description: v.description
      }));
    }

    return component;
  });
}

/**
 * Parse from stdin
 */
export async function parseFromStdin(): Promise<Component[]> {
  return new Promise((resolve, reject) => {
    let data = '';
    
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(parseSimpleJsonString(data));
      } catch (err) {
        reject(err);
      }
    });
    process.stdin.on('error', reject);
  });
}
