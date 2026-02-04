/**
 * ReachVet - Call Graph Analysis for JS/TS
 * 
 * Tracks whether imported functions are actually called in code
 */

import ts from 'typescript';
import type { CodeLocation } from '../../types.js';

export interface CallInfo {
  /** The function/method being called */
  callee: string;
  /** Object the function is called on (for method calls) */
  object?: string;
  /** Arguments passed (for simple literals) */
  args?: string[];
  /** Location of the call */
  location: CodeLocation;
  /** Is this a constructor call (new X()) */
  isConstructor: boolean;
  /** Is this a method call (obj.method()) */
  isMethodCall: boolean;
}

export interface DynamicCodeWarning {
  /** Type of dynamic code */
  type: 'eval' | 'Function' | 'indirect_eval' | 'setTimeout_string' | 'setInterval_string';
  /** Location */
  location: CodeLocation;
  /** Additional context */
  context?: string;
}

export interface CallGraphResult {
  /** All function/method calls found */
  calls: CallInfo[];
  /** Identifiers that are referenced but not called */
  references: Set<string>;
  /** Functions that are called */
  calledFunctions: Set<string>;
  /** Dynamic code execution warnings */
  dynamicCodeWarnings: DynamicCodeWarning[];
}

/**
 * Analyze source code to find function calls
 */
export function analyzeCallGraph(source: string, fileName: string = 'file.ts'): CallGraphResult {
  const calls: CallInfo[] = [];
  const references = new Set<string>();
  const calledFunctions = new Set<string>();
  const dynamicCodeWarnings: DynamicCodeWarning[] = [];

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
    // Track all identifier references (used as values, not declarations)
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      
      // Skip declaration contexts
      const isDeclaration = 
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isImportSpecifier(parent) && parent.name === node) ||
        (ts.isImportClause(parent) && parent.name === node) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isFunctionDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isNamespaceImport(parent) ||
        (ts.isBindingElement(parent) && parent.name === node);
      
      // Track as reference if used as a value
      if (!isDeclaration) {
        references.add(node.text);
      }
    }

    // New expression: new SomeClass()
    if (ts.isNewExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr)) {
        const callee = expr.text;
        calledFunctions.add(callee);
        calls.push({
          callee,
          location: getLocation(node),
          isConstructor: true,
          isMethodCall: false
        });
        
        // Detect new Function()
        if (callee === 'Function') {
          dynamicCodeWarnings.push({
            type: 'Function',
            location: getLocation(node),
            context: 'Function constructor - runtime code execution'
          });
        }
      } else if (ts.isPropertyAccessExpression(expr)) {
        const callee = expr.name.text;
        const obj = ts.isIdentifier(expr.expression) ? expr.expression.text : undefined;
        calledFunctions.add(callee);
        if (obj) calledFunctions.add(`${obj}.${callee}`);
        calls.push({
          callee,
          object: obj,
          location: getLocation(node),
          isConstructor: true,
          isMethodCall: true
        });
      }
    }

    // Call expression: func() or obj.method()
    if (ts.isCallExpression(node)) {
      const expr = node.expression;

      // Simple call: func()
      if (ts.isIdentifier(expr)) {
        const callee = expr.text;
        // Skip require() - handled separately
        if (callee !== 'require') {
          calledFunctions.add(callee);
          calls.push({
            callee,
            location: getLocation(node),
            isConstructor: false,
            isMethodCall: false
          });
        }
      }
      // Method call: obj.method() or obj.prop.method()
      else if (ts.isPropertyAccessExpression(expr)) {
        const callee = expr.name.text;
        let obj: string | undefined;
        
        if (ts.isIdentifier(expr.expression)) {
          obj = expr.expression.text;
        } else if (ts.isPropertyAccessExpression(expr.expression)) {
          // Handle chained: a.b.method()
          obj = expr.expression.getText(sourceFile);
        }

        calledFunctions.add(callee);
        if (obj) {
          calledFunctions.add(`${obj}.${callee}`);
        }
        
        calls.push({
          callee,
          object: obj,
          location: getLocation(node),
          isConstructor: false,
          isMethodCall: true
        });
      }
      // Element access call: obj['method']()
      else if (ts.isElementAccessExpression(expr)) {
        const arg = expr.argumentExpression;
        if (ts.isStringLiteral(arg)) {
          const callee = arg.text;
          const obj = ts.isIdentifier(expr.expression) ? expr.expression.text : undefined;
          calledFunctions.add(callee);
          if (obj) calledFunctions.add(`${obj}.${callee}`);
          calls.push({
            callee,
            object: obj,
            location: getLocation(node),
            isConstructor: false,
            isMethodCall: true
          });
        }
      }

      // Detect dynamic code execution
      if (ts.isIdentifier(expr)) {
        const callee = expr.text;
        
        // Direct eval()
        if (callee === 'eval') {
          dynamicCodeWarnings.push({
            type: 'eval',
            location: getLocation(node),
            context: 'Direct eval() call - runtime code execution'
          });
        }
        
        // new Function()
        if (callee === 'Function') {
          dynamicCodeWarnings.push({
            type: 'Function',
            location: getLocation(node),
            context: 'Function constructor - runtime code execution'
          });
        }
        
        // setTimeout/setInterval with string argument
        if ((callee === 'setTimeout' || callee === 'setInterval') && node.arguments.length > 0) {
          const firstArg = node.arguments[0];
          if (ts.isStringLiteral(firstArg) || ts.isTemplateExpression(firstArg)) {
            dynamicCodeWarnings.push({
              type: callee === 'setTimeout' ? 'setTimeout_string' : 'setInterval_string',
              location: getLocation(node),
              context: `${callee} with string argument - runtime code execution`
            });
          }
        }
      }
      
      // Indirect eval: (0, eval)() or window.eval()
      if (ts.isParenthesizedExpression(expr)) {
        const inner = expr.expression;
        if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.CommaToken) {
          const right = inner.right;
          if (ts.isIdentifier(right) && right.text === 'eval') {
            dynamicCodeWarnings.push({
              type: 'indirect_eval',
              location: getLocation(node),
              context: 'Indirect eval - global scope code execution'
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return { calls, references, calledFunctions, dynamicCodeWarnings };
}

/**
 * Check if imported members are actually called
 */
export function checkImportedMembersCalled(
  importedMembers: string[],
  callGraph: CallGraphResult,
  localName?: string
): { called: string[]; notCalled: string[]; uncertain: string[] } {
  const called: string[] = [];
  const notCalled: string[] = [];
  const uncertain: string[] = [];

  for (const member of importedMembers) {
    // Check direct call
    if (callGraph.calledFunctions.has(member)) {
      called.push(member);
      continue;
    }

    // Check call via namespace: localName.member
    if (localName && callGraph.calledFunctions.has(`${localName}.${member}`)) {
      called.push(member);
      continue;
    }

    // Check if referenced at all (might be passed as callback)
    if (callGraph.references.has(member)) {
      uncertain.push(member);
      continue;
    }

    notCalled.push(member);
  }

  return { called, notCalled, uncertain };
}
