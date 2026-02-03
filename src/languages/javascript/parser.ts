/**
 * ReachVet - JavaScript/TypeScript AST Parser
 * 
 * Uses TypeScript compiler API to parse JS/TS files and extract imports
 */

import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import type { CodeLocation } from '../../types.js';

export interface ImportInfo {
  moduleName: string;          // 'lodash', './utils', '@scope/pkg'
  importStyle: 'esm' | 'commonjs' | 'dynamic';
  isNamespaceImport: boolean;  // import * as _ from 'lodash'
  isDefaultImport: boolean;    // import _ from 'lodash'
  namedImports: string[];      // import { merge, clone } from 'lodash'
  localName?: string;          // The local binding name
  location: CodeLocation;
}

export interface UsageInfo {
  identifier: string;
  location: CodeLocation;
  context?: string;  // 'call', 'property_access', 'reference'
}

/**
 * Parse a JavaScript/TypeScript file and extract imports
 */
export async function parseFile(filePath: string): Promise<ImportInfo[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseSource(content, filePath);
}

/**
 * Parse source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.ts'): ImportInfo[] {
  const imports: ImportInfo[] = [];
  
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') || fileName.endsWith('.jsx') 
      ? ts.ScriptKind.TSX 
      : ts.ScriptKind.TS
  );

  function getLocation(node: ts.Node): CodeLocation {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return {
      file: fileName,
      line: line + 1,
      column: character + 1,
      snippet: node.getText(sourceFile).slice(0, 100)
    };
  }

  function visit(node: ts.Node): void {
    // ESM: import ... from 'module'
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const moduleName = moduleSpecifier.text;
        const importClause = node.importClause;
        
        const info: ImportInfo = {
          moduleName,
          importStyle: 'esm',
          isNamespaceImport: false,
          isDefaultImport: false,
          namedImports: [],
          location: getLocation(node)
        };

        if (importClause) {
          // Default import: import foo from 'module'
          if (importClause.name) {
            info.isDefaultImport = true;
            info.localName = importClause.name.text;
          }

          // Named/namespace imports
          const namedBindings = importClause.namedBindings;
          if (namedBindings) {
            // Namespace: import * as foo from 'module'
            if (ts.isNamespaceImport(namedBindings)) {
              info.isNamespaceImport = true;
              info.localName = namedBindings.name.text;
            }
            // Named: import { a, b } from 'module'
            else if (ts.isNamedImports(namedBindings)) {
              for (const element of namedBindings.elements) {
                info.namedImports.push(element.name.text);
              }
            }
          }
        }

        imports.push(info);
      }
    }

    // ESM: export ... from 'module' (re-exports)
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        const info: ImportInfo = {
          moduleName: node.moduleSpecifier.text,
          importStyle: 'esm',
          isNamespaceImport: !!node.exportClause && ts.isNamespaceExport(node.exportClause),
          isDefaultImport: false,
          namedImports: [],
          location: getLocation(node)
        };

        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            info.namedImports.push(element.name.text);
          }
        }

        imports.push(info);
      }
    }

    // CommonJS: require('module')
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      
      // require('module')
      if (ts.isIdentifier(expression) && expression.text === 'require') {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          const info: ImportInfo = {
            moduleName: arg.text,
            importStyle: 'commonjs',
            isNamespaceImport: false,
            isDefaultImport: false,
            namedImports: [],
            location: getLocation(node)
          };

          // Check parent context for better analysis
          const requireCall = node;
          let currentNode: ts.Node = requireCall;

          // Check for property access: require('lodash').merge
          if (currentNode.parent && ts.isPropertyAccessExpression(currentNode.parent) 
              && currentNode.parent.expression === currentNode) {
            const propAccess = currentNode.parent;
            info.namedImports.push(propAccess.name.text);
            currentNode = propAccess;
          }

          // Check for variable declaration: const x = require() or const {a,b} = require()
          if (currentNode.parent && ts.isVariableDeclaration(currentNode.parent)) {
            const varDecl = currentNode.parent;
            const bindingName = varDecl.name;

            // Simple identifier: const _ = require('lodash')
            if (ts.isIdentifier(bindingName)) {
              info.localName = bindingName.text;
              // Treat as namespace-like (whole module import)
              if (info.namedImports.length === 0) {
                info.isDefaultImport = true;
              }
            }
            // Destructuring: const { merge, clone } = require('lodash')
            else if (ts.isObjectBindingPattern(bindingName)) {
              for (const element of bindingName.elements) {
                if (ts.isBindingElement(element)) {
                  // Handle { merge } and { merge: localMerge }
                  const propertyName = element.propertyName;
                  const name = element.name;
                  
                  if (propertyName && ts.isIdentifier(propertyName)) {
                    // { originalName: localName }
                    info.namedImports.push(propertyName.text);
                  } else if (ts.isIdentifier(name)) {
                    // { name }
                    info.namedImports.push(name.text);
                  }
                }
              }
            }
          }

          imports.push(info);
        }
      }

      // Dynamic import: import('module')
      if (expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          imports.push({
            moduleName: arg.text,
            importStyle: 'dynamic',
            isNamespaceImport: false,
            isDefaultImport: false,
            namedImports: [],
            location: getLocation(node)
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

/**
 * Find property accesses on namespace/default imports
 * E.g., `import * as _ from 'lodash'` followed by `_.template()` -> returns ['template']
 */
export function findNamespaceUsages(source: string, localNames: string[], fileName: string = 'file.ts'): string[] {
  const usedMembers: Set<string> = new Set();
  
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  function visit(node: ts.Node): void {
    // Look for property access: _.template, _.merge, etc.
    if (ts.isPropertyAccessExpression(node)) {
      const obj = node.expression;
      const prop = node.name;
      
      // Check if the object is one of our namespace identifiers
      if (ts.isIdentifier(obj) && localNames.includes(obj.text)) {
        usedMembers.add(prop.text);
      }
    }
    
    // Look for element access: _['template'], _["merge"]
    if (ts.isElementAccessExpression(node)) {
      const obj = node.expression;
      const arg = node.argumentExpression;
      
      if (ts.isIdentifier(obj) && localNames.includes(obj.text)) {
        if (ts.isStringLiteral(arg)) {
          usedMembers.add(arg.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...usedMembers];
}

/**
 * Find usages of an identifier in source code
 */
export function findUsages(source: string, identifiers: string[], fileName: string = 'file.ts'): UsageInfo[] {
  const usages: UsageInfo[] = [];
  
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  function getLocation(node: ts.Node): CodeLocation {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return {
      file: fileName,
      line: line + 1,
      column: character + 1,
      snippet: node.getText(sourceFile).slice(0, 100)
    };
  }

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && identifiers.includes(node.text)) {
      let context: string = 'reference';
      
      // Check if it's a call
      if (node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node) {
        context = 'call';
      }
      // Check if it's a property access
      else if (node.parent && ts.isPropertyAccessExpression(node.parent)) {
        context = 'property_access';
      }

      usages.push({
        identifier: node.text,
        location: getLocation(node),
        context
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return usages;
}
