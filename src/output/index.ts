/**
 * ReachVet - Output Formatters
 */

export { toSarif, type SarifOutput } from './sarif.js';
export { generateGraph, generateGraphFromAnalysis, type GraphOptions } from './graph.js';
export {
  generateAnnotations,
  formatAnnotation,
  printAnnotations,
  annotationsToStrings,
  type Annotation,
  type AnnotationOptions,
} from './annotations.js';
export { toJUnitXml, toJUnitXmlMultiple, type JUnitOptions } from './junit.js';
export {
  toCycloneDX,
  toSPDX,
  generateVEXStatements,
  type SBOMOptions,
  type CycloneDXBom,
  type SPDXDocument,
  type VEXStatement,
} from './sbom.js';
