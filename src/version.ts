/**
 * ReachVet Version - Single source of truth
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

interface PackageJson {
  version: string;
}

const pkg = require('../package.json') as PackageJson;

export const VERSION = pkg.version;
