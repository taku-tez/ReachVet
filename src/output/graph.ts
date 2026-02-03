/**
 * ReachVet - Dependency Graph Visualization
 * 
 * Generates dependency graphs in Mermaid and DOT (Graphviz) formats.
 * Highlights vulnerable and reachable components.
 */

import type { ComponentResult, AnalysisOutput } from '../types.js';

export interface GraphOptions {
  /** Output format: 'mermaid' or 'dot' */
  format: 'mermaid' | 'dot';
  /** Graph direction for Mermaid: TB (top-bottom), LR (left-right), etc. */
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  /** Include transitive dependencies */
  transitive?: boolean;
  /** Maximum depth for transitive dependencies */
  maxDepth?: number;
  /** Only show vulnerable/reachable components */
  vulnerableOnly?: boolean;
  /** Group by language */
  groupByLanguage?: boolean;
  /** Include legend */
  includeLegend?: boolean;
  /** Node shape for DOT format */
  nodeShape?: 'box' | 'ellipse' | 'diamond' | 'hexagon';
}

const DEFAULT_OPTIONS: Required<GraphOptions> = {
  format: 'mermaid',
  direction: 'TB',
  transitive: true,
  maxDepth: 5,
  vulnerableOnly: false,
  groupByLanguage: false,
  includeLegend: true,
  nodeShape: 'box',
};

interface GraphNode {
  id: string;
  label: string;
  status: 'vulnerable' | 'reachable' | 'imported' | 'indirect' | 'safe';
  language?: string;
  version?: string;
}

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

/**
 * Sanitize string for use as graph node ID
 */
function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
}

/**
 * Escape label for Mermaid/DOT
 */
function escapeLabel(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Build graph structure from analysis results
 */
function buildGraph(
  results: ComponentResult[],
  options: Required<GraphOptions>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: Map<string, GraphNode> = new Map();
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();

  // Add root node for the project
  nodes.set('project', {
    id: 'project',
    label: 'Project',
    status: 'safe',
  });

  for (const result of results) {
    const component = result.component;
    const nodeId = sanitizeId(`${component.name}_${component.version || 'latest'}`);
    
    // Determine status from result.status and vulnerabilities
    const hasVulnerabilities = component.vulnerabilities && component.vulnerabilities.length > 0;
    let status: GraphNode['status'] = 'safe';
    
    if (result.status === 'reachable' && hasVulnerabilities) {
      status = 'vulnerable';
    } else if (result.status === 'reachable') {
      status = 'reachable';
    } else if (result.status === 'imported') {
      status = 'imported';
    } else if (result.status === 'indirect') {
      status = 'indirect';
    } else if (result.status === 'not_reachable' || result.status === 'unknown') {
      status = 'safe';
    }

    // Filter if vulnerableOnly
    if (options.vulnerableOnly && status === 'safe') {
      continue;
    }

    // Add node
    if (!nodes.has(nodeId)) {
      nodes.set(nodeId, {
        id: nodeId,
        label: `${component.name}${component.version ? `@${component.version}` : ''}`,
        status,
        language: component.ecosystem, // Use ecosystem as language hint
        version: component.version,
      });
    }

    // Add edge from project to direct dependency
    const edgeKey = `project->${nodeId}`;
    if (!seenEdges.has(edgeKey)) {
      edges.push({ from: 'project', to: nodeId });
      seenEdges.add(edgeKey);
    }

    // Add edges for usages (from component to what it calls)
    if (result.usage && options.transitive) {
      // We have usage info but no sub-dependency info
      // For now, just note the usage exists
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

/**
 * Generate Mermaid graph
 */
function toMermaid(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: Required<GraphOptions>
): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`graph ${options.direction}`);
  lines.push('');
  
  // Style definitions
  lines.push('  %% Style definitions');
  lines.push('  classDef vulnerable fill:#ff6b6b,stroke:#c92a2a,color:#fff');
  lines.push('  classDef reachable fill:#ffa94d,stroke:#e67700,color:#fff');
  lines.push('  classDef imported fill:#74c0fc,stroke:#1971c2,color:#fff');
  lines.push('  classDef indirect fill:#b2bec3,stroke:#636e72');
  lines.push('  classDef safe fill:#69db7c,stroke:#2f9e44');
  lines.push('  classDef project fill:#9775fa,stroke:#7048e8,color:#fff');
  lines.push('');

  // Group by language if requested
  if (options.groupByLanguage) {
    const byLanguage = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      if (node.id === 'project') continue;
      const lang = node.language || 'unknown';
      if (!byLanguage.has(lang)) {
        byLanguage.set(lang, []);
      }
      byLanguage.get(lang)!.push(node);
    }

    // Add project node first
    const projectNode = nodes.find(n => n.id === 'project');
    if (projectNode) {
      lines.push(`  ${projectNode.id}["📦 ${escapeLabel(projectNode.label)}"]`);
    }

    // Add subgraphs for each language
    for (const [lang, langNodes] of byLanguage) {
      lines.push(`  subgraph ${lang}`);
      for (const node of langNodes) {
        const icon = getStatusIcon(node.status);
        lines.push(`    ${node.id}["${icon} ${escapeLabel(node.label)}"]`);
      }
      lines.push('  end');
    }
  } else {
    // Nodes without grouping
    lines.push('  %% Nodes');
    for (const node of nodes) {
      const icon = node.id === 'project' ? '📦' : getStatusIcon(node.status);
      lines.push(`  ${node.id}["${icon} ${escapeLabel(node.label)}"]`);
    }
  }

  lines.push('');
  
  // Edges
  lines.push('  %% Dependencies');
  for (const edge of edges) {
    const label = edge.label ? `|${escapeLabel(edge.label)}|` : '';
    lines.push(`  ${edge.from} -->${label} ${edge.to}`);
  }

  lines.push('');
  
  // Apply classes
  lines.push('  %% Apply styles');
  const byStatus = new Map<string, string[]>();
  for (const node of nodes) {
    const status = node.id === 'project' ? 'project' : node.status;
    if (!byStatus.has(status)) {
      byStatus.set(status, []);
    }
    byStatus.get(status)!.push(node.id);
  }

  for (const [status, nodeIds] of byStatus) {
    if (nodeIds.length > 0) {
      lines.push(`  class ${nodeIds.join(',')} ${status}`);
    }
  }

  // Legend
  if (options.includeLegend) {
    lines.push('');
    lines.push('  %% Legend');
    lines.push('  subgraph Legend');
    lines.push('    direction LR');
    lines.push('    L1["🔴 Vulnerable & Reachable"]:::vulnerable');
    lines.push('    L2["🟠 Reachable"]:::reachable');
    lines.push('    L3["🔵 Imported"]:::imported');
    lines.push('    L4["⚪ Indirect"]:::indirect');
    lines.push('    L5["🟢 Safe"]:::safe');
    lines.push('  end');
  }

  return lines.join('\n');
}

/**
 * Generate DOT (Graphviz) graph
 */
function toDot(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: Required<GraphOptions>
): string {
  const lines: string[] = [];
  
  // Determine if directed
  const rankdir = options.direction === 'LR' ? 'LR' : 
                  options.direction === 'RL' ? 'RL' :
                  options.direction === 'BT' ? 'BT' : 'TB';

  lines.push('digraph DependencyGraph {');
  lines.push(`  rankdir=${rankdir};`);
  lines.push('  node [fontname="Helvetica"];');
  lines.push('  edge [fontname="Helvetica", fontsize=10];');
  lines.push('');

  // Color definitions
  const statusColors: Record<GraphNode['status'] | 'project', { fill: string; font: string; border: string }> = {
    vulnerable: { fill: '#ff6b6b', font: 'white', border: '#c92a2a' },
    reachable: { fill: '#ffa94d', font: 'white', border: '#e67700' },
    imported: { fill: '#74c0fc', font: 'white', border: '#1971c2' },
    indirect: { fill: '#b2bec3', font: 'black', border: '#636e72' },
    safe: { fill: '#69db7c', font: 'black', border: '#2f9e44' },
    project: { fill: '#9775fa', font: 'white', border: '#7048e8' },
  };

  // Nodes
  lines.push('  // Nodes');
  for (const node of nodes) {
    const status = node.id === 'project' ? 'project' : node.status;
    const colors = statusColors[status];
    const shape = node.id === 'project' ? 'box3d' : options.nodeShape;
    const icon = node.id === 'project' ? '📦 ' : `${getStatusIcon(node.status)} `;
    
    lines.push(`  ${node.id} [label="${icon}${escapeLabel(node.label)}", shape=${shape}, style=filled, fillcolor="${colors.fill}", fontcolor="${colors.font}", color="${colors.border}"];`);
  }

  lines.push('');

  // Group by language if requested
  if (options.groupByLanguage) {
    const byLanguage = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      if (node.id === 'project') continue;
      const lang = node.language || 'unknown';
      if (!byLanguage.has(lang)) {
        byLanguage.set(lang, []);
      }
      byLanguage.get(lang)!.push(node);
    }

    let clusterIdx = 0;
    for (const [lang, langNodes] of byLanguage) {
      lines.push(`  subgraph cluster_${clusterIdx++} {`);
      lines.push(`    label="${lang}";`);
      lines.push('    style=rounded;');
      lines.push('    bgcolor="#f8f9fa";');
      for (const node of langNodes) {
        lines.push(`    ${node.id};`);
      }
      lines.push('  }');
    }
    lines.push('');
  }

  // Edges
  lines.push('  // Dependencies');
  for (const edge of edges) {
    const label = edge.label ? ` [label="${escapeLabel(edge.label)}"]` : '';
    lines.push(`  ${edge.from} -> ${edge.to}${label};`);
  }

  // Legend
  if (options.includeLegend) {
    lines.push('');
    lines.push('  // Legend');
    lines.push('  subgraph cluster_legend {');
    lines.push('    label="Legend";');
    lines.push('    style=rounded;');
    lines.push('    bgcolor="#ffffff";');
    lines.push(`    leg_vulnerable [label="🔴 Vulnerable & Reachable", shape=box, style=filled, fillcolor="${statusColors.vulnerable.fill}", fontcolor="${statusColors.vulnerable.font}"];`);
    lines.push(`    leg_reachable [label="🟠 Reachable", shape=box, style=filled, fillcolor="${statusColors.reachable.fill}", fontcolor="${statusColors.reachable.font}"];`);
    lines.push(`    leg_imported [label="🔵 Imported", shape=box, style=filled, fillcolor="${statusColors.imported.fill}", fontcolor="${statusColors.imported.font}"];`);
    lines.push(`    leg_indirect [label="⚪ Indirect", shape=box, style=filled, fillcolor="${statusColors.indirect.fill}", fontcolor="${statusColors.indirect.font}"];`);
    lines.push(`    leg_safe [label="🟢 Safe", shape=box, style=filled, fillcolor="${statusColors.safe.fill}", fontcolor="${statusColors.safe.font}"];`);
    lines.push('    leg_vulnerable -> leg_reachable -> leg_imported -> leg_indirect -> leg_safe [style=invis];');
    lines.push('  }');
  }

  lines.push('}');

  return lines.join('\n');
}

function getStatusIcon(status: GraphNode['status']): string {
  switch (status) {
    case 'vulnerable': return '🔴';
    case 'reachable': return '🟠';
    case 'imported': return '🔵';
    case 'indirect': return '⚪';
    case 'safe': return '🟢';
    default: return '⚪';
  }
}

/**
 * Generate dependency graph from analysis results
 */
export function generateGraph(
  results: ComponentResult[],
  options: Partial<GraphOptions> = {}
): string {
  const opts: Required<GraphOptions> = { ...DEFAULT_OPTIONS, ...options };
  const { nodes, edges } = buildGraph(results, opts);

  if (opts.format === 'dot') {
    return toDot(nodes, edges, opts);
  }
  return toMermaid(nodes, edges, opts);
}

/**
 * Generate graph from full analysis output
 */
export function generateGraphFromAnalysis(
  analysis: AnalysisOutput,
  options: Partial<GraphOptions> = {}
): string {
  return generateGraph(analysis.results, options);
}

export default {
  generateGraph,
  generateGraphFromAnalysis,
};
