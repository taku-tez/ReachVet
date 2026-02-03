/**
 * ReachVet - PHP Import Parser
 * 
 * Parses PHP use statements and require/include:
 * - use Namespace\ClassName;
 * - use Namespace\ClassName as Alias;
 * - use function Namespace\functionName;
 * - use const Namespace\CONSTANT;
 * - use Namespace\{ClassA, ClassB};
 * - require 'file.php';
 * - require_once 'file.php';
 * - include 'file.php';
 * - include_once 'file.php';
 */

import type { CodeLocation } from '../../types.js';

export interface PhpImportInfo {
  /** The namespace/class being imported */
  moduleName: string;
  /** Import style */
  importStyle: 'use' | 'use_function' | 'use_const' | 'require' | 'require_once' | 'include' | 'include_once';
  /** Alias if any */
  alias?: string;
  /** For grouped use statements, the individual names */
  groupedNames?: string[];
  /** Location in source */
  location: CodeLocation;
}

export interface PhpUsageInfo {
  /** Class/function being used */
  identifier: string;
  /** Method being called (if any) */
  method?: string;
  /** Is it a static call (::) */
  isStatic: boolean;
  /** Location in source */
  location: CodeLocation;
}

// Map Composer package names to their namespaces
const PACKAGE_TO_NAMESPACE: Record<string, string[]> = {
  'laravel/framework': ['Illuminate', 'Laravel'],
  'symfony/http-foundation': ['Symfony\\Component\\HttpFoundation'],
  'symfony/console': ['Symfony\\Component\\Console'],
  'symfony/routing': ['Symfony\\Component\\Routing'],
  'symfony/http-kernel': ['Symfony\\Component\\HttpKernel'],
  'doctrine/orm': ['Doctrine\\ORM'],
  'doctrine/dbal': ['Doctrine\\DBAL'],
  'guzzlehttp/guzzle': ['GuzzleHttp'],
  'monolog/monolog': ['Monolog'],
  'phpunit/phpunit': ['PHPUnit'],
  'nesbot/carbon': ['Carbon'],
  'league/flysystem': ['League\\Flysystem'],
  'aws/aws-sdk-php': ['Aws'],
  'firebase/php-jwt': ['Firebase\\JWT'],
  'vlucas/phpdotenv': ['Dotenv'],
  'ramsey/uuid': ['Ramsey\\Uuid'],
  'psr/log': ['Psr\\Log'],
  'psr/http-message': ['Psr\\Http\\Message'],
  'psr/container': ['Psr\\Container'],
  'psr/cache': ['Psr\\Cache'],
  'twig/twig': ['Twig'],
  'slim/slim': ['Slim'],
  'laminas/laminas-diactoros': ['Laminas\\Diactoros'],
  'nikic/fast-route': ['FastRoute'],
  'swiftmailer/swiftmailer': ['Swift'],
  'phpmailer/phpmailer': ['PHPMailer'],
  'predis/predis': ['Predis'],
  'elasticsearch/elasticsearch': ['Elasticsearch'],
  'intervention/image': ['Intervention\\Image'],
  'spatie/laravel-permission': ['Spatie\\Permission'],
  'league/oauth2-server': ['League\\OAuth2'],
  'paragonie/random_compat': ['random_bytes', 'random_int'],
  'defuse/php-encryption': ['Defuse\\Crypto'],
  'phpseclib/phpseclib': ['phpseclib'],
};

// Common PHP extensions (built-in)
const BUILTIN_EXTENSIONS = new Set([
  'Core', 'standard', 'date', 'pcre', 'SPL', 'json', 'hash', 'Reflection',
  'session', 'PDO', 'mysqli', 'curl', 'openssl', 'mbstring', 'xml', 'dom',
  'SimpleXML', 'XMLReader', 'XMLWriter', 'libxml', 'filter', 'iconv',
  'tokenizer', 'ctype', 'fileinfo', 'zip', 'zlib', 'gd', 'intl', 'bcmath',
  'sodium', 'ftp', 'phar', 'Zend OPcache',
]);

/**
 * Parse PHP source code and extract imports
 */
export function parseSource(source: string, fileName: string = 'file.php'): PhpImportInfo[] {
  const imports: PhpImportInfo[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || 
        trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // use Namespace\Class;
    // use Namespace\Class as Alias;
    const useMatch = trimmed.match(/^use\s+([A-Za-z0-9_\\]+)(?:\s+as\s+([A-Za-z0-9_]+))?\s*;/);
    if (useMatch) {
      imports.push({
        moduleName: useMatch[1],
        importStyle: 'use',
        alias: useMatch[2],
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // use function Namespace\func;
    const useFuncMatch = trimmed.match(/^use\s+function\s+([A-Za-z0-9_\\]+)(?:\s+as\s+([A-Za-z0-9_]+))?\s*;/);
    if (useFuncMatch) {
      imports.push({
        moduleName: useFuncMatch[1],
        importStyle: 'use_function',
        alias: useFuncMatch[2],
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // use const Namespace\CONST;
    const useConstMatch = trimmed.match(/^use\s+const\s+([A-Za-z0-9_\\]+)(?:\s+as\s+([A-Za-z0-9_]+))?\s*;/);
    if (useConstMatch) {
      imports.push({
        moduleName: useConstMatch[1],
        importStyle: 'use_const',
        alias: useConstMatch[2],
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // use Namespace\{ClassA, ClassB, ClassC};
    const groupedUseMatch = trimmed.match(/^use\s+([A-Za-z0-9_\\]+)\\\{([^}]+)\}\s*;/);
    if (groupedUseMatch) {
      const baseNamespace = groupedUseMatch[1];
      const names = groupedUseMatch[2].split(',').map(n => n.trim());
      
      imports.push({
        moduleName: baseNamespace,
        importStyle: 'use',
        groupedNames: names,
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }

    // require/require_once/include/include_once
    const requireMatch = trimmed.match(/^(require|require_once|include|include_once)\s*\(?['"]([^'"]+)['"]\)?\s*;/);
    if (requireMatch) {
      imports.push({
        moduleName: requireMatch[2],
        importStyle: requireMatch[1].replace('_', '_') as PhpImportInfo['importStyle'],
        location: {
          file: fileName,
          line: lineNum,
          snippet: trimmed.slice(0, 100)
        }
      });
      continue;
    }
  }

  return imports;
}

/**
 * Find usages of classes/functions in source code
 */
export function findClassUsages(source: string, classNames: string[], fileName: string = 'file.php'): PhpUsageInfo[] {
  const usages: PhpUsageInfo[] = [];
  const lines = source.split('\n');

  // Build regex for all class names (escape backslashes for namespaces)
  const patterns = classNames.map(c => c.replace(/\\/g, '\\\\').replace(/[.*+?^${}()|[\]]/g, '\\$&'));
  if (patterns.length === 0) return usages;

  const classPattern = patterns.join('|');
  // Match ClassName::method() or ClassName::$property or new ClassName
  const regex = new RegExp(`(?:new\\s+)?(${classPattern})(?:::?(\\w+))?`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('#') ||
        line.trim().startsWith('/*') || line.trim().startsWith('*')) {
      continue;
    }

    let match;
    while ((match = regex.exec(line)) !== null) {
      usages.push({
        identifier: match[1],
        method: match[2],
        isStatic: line.includes('::'),
        location: {
          file: fileName,
          line: lineNum,
          column: match.index + 1,
          snippet: line.trim().slice(0, 100)
        }
      });
    }
  }

  return usages;
}

/**
 * Get namespaces for a Composer package
 */
export function getNamespacesForPackage(packageName: string): string[] {
  if (PACKAGE_TO_NAMESPACE[packageName]) {
    return PACKAGE_TO_NAMESPACE[packageName];
  }

  // Try to infer from package name: vendor/package -> Vendor\Package
  const [vendor, pkg] = packageName.split('/');
  if (vendor && pkg) {
    const vendorPascal = vendor.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    const pkgPascal = pkg.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    return [`${vendorPascal}\\${pkgPascal}`];
  }

  return [];
}

/**
 * Extract package name from namespace
 */
export function extractPackageFromNamespace(namespace: string): string | null {
  // Check known mappings
  for (const [pkg, namespaces] of Object.entries(PACKAGE_TO_NAMESPACE)) {
    for (const ns of namespaces) {
      if (namespace.startsWith(ns)) {
        return pkg;
      }
    }
  }

  // Try to extract vendor/package from namespace
  const parts = namespace.split('\\');
  if (parts.length >= 2) {
    const vendor = parts[0].toLowerCase().replace(/([A-Z])/g, '-$1').replace(/^-/, '');
    const pkg = parts[1].toLowerCase().replace(/([A-Z])/g, '-$1').replace(/^-/, '');
    return `${vendor}/${pkg}`;
  }

  return null;
}

/**
 * Check if a class is from PHP built-in extensions
 */
export function isBuiltinClass(className: string): boolean {
  // Check common built-in classes
  const builtinClasses = [
    'DateTime', 'DateTimeImmutable', 'DateInterval', 'DatePeriod', 'DateTimeZone',
    'Exception', 'Error', 'TypeError', 'ValueError', 'ArgumentCountError',
    'PDO', 'PDOStatement', 'PDOException',
    'mysqli', 'mysqli_result', 'mysqli_stmt',
    'DOMDocument', 'DOMElement', 'DOMNode', 'DOMXPath',
    'SimpleXMLElement', 'XMLReader', 'XMLWriter',
    'SplFileInfo', 'SplFileObject', 'ArrayObject', 'ArrayIterator',
    'stdClass', 'Closure', 'Generator', 'ReflectionClass', 'ReflectionMethod',
    'JsonException', 'CurlHandle', 'GdImage',
  ];

  return builtinClasses.includes(className) || 
         BUILTIN_EXTENSIONS.has(className.split('\\')[0]);
}
