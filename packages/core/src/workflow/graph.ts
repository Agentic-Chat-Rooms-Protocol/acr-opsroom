/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/graph.ts`. Extended with `DEFAULT` alias,
 * `OUTCOME_UNKNOWN_ROUTE`, and `topologyHash` (RFC 8785 JCS + SHA-256).
 */

import { BaseNode } from './base_node.js';
import { BaseTool } from './shims.js';
import { parseEdgeItems } from './utils/graph_parser.js';
import {
  computeGraphTopologyHash,
  validateGraph,
} from './utils/graph_validation.js';

const EDGE_SIGNATURE_SYMBOL = Symbol.for('google.adk.workflow.edge');

/** Valid routing values used in conditional graph edges. */
export type RouteValue = boolean | number | string;

/** The fallback route key used when no specific route matches. */
export const DEFAULT_ROUTE = '__DEFAULT__';

/** Alias for {@link DEFAULT_ROUTE} matching `adk.dev/graphs/routes/` documentation. */
export const DEFAULT = DEFAULT_ROUTE;

/**
 * ACR Extension 3 (`DurableCommandWal`): Dedicated route key emitted by
 * `WalBackedToolNode` and `SandboxedExecutionNode` when an external mutation
 * times out after `DISPATCHED` and reconciliation is inconclusive.
 */
export const OUTCOME_UNKNOWN_ROUTE = '__OUTCOME_UNKNOWN__';

/**
 * Any value that can be converted to a workflow node: a node, a tool, a plain
 * function, or the `'START'` sentinel literal.
 */
export type NodeLike =
  | BaseNode
  | BaseTool
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | ((...args: any[]) => unknown)
  | 'START';

/**
 * What `ctx.runNode()` accepts: everything an edge accepts except `'START'`.
 */
export type RunnableNode = Exclude<NodeLike, 'START'>;

/**
 * A mapping from route values to destination node(s).
 */
export type RoutingMap = Record<
  string | number,
  NodeLike | readonly NodeLike[]
>;

/** An element within a workflow chain. */
export type ChainElement = NodeLike | readonly NodeLike[] | RoutingMap;

/**
 * An item that can be parsed into workflow edges: an explicit {@link Edge}, or a
 * chain expressed as an array of {@link ChainElement}s.
 */
export type EdgeItem = Edge | ChainElement[];

/**
 * A directed edge in the workflow graph.
 */
export class Edge {
  readonly [EDGE_SIGNATURE_SYMBOL] = true;

  constructor(
    readonly fromNode: BaseNode,
    readonly toNode: BaseNode,
    readonly route: RouteValue | RouteValue[] | null = null
  ) {}
}

/**
 * Type guard for {@link Edge}.
 */
export function isEdge(value: unknown): value is Edge {
  return (
    typeof value === 'object' &&
    value !== null &&
    EDGE_SIGNATURE_SYMBOL in value &&
    (value as Edge)[EDGE_SIGNATURE_SYMBOL] === true
  );
}

/**
 * A compiled workflow graph. Nodes are inferred (deduped by identity) from the
 * edges.
 */
export class Graph {
  readonly nodes: BaseNode[];
  readonly edges: Edge[];
  private _terminalNodeNames: ReadonlySet<string> = new Set();
  private _topologyHash?: string;

  constructor(edges: Edge[]) {
    this.edges = edges;
    const seen = new Set<BaseNode>();
    const nodes: BaseNode[] = [];
    for (const edge of edges) {
      for (const node of [edge.fromNode, edge.toNode]) {
        if (!seen.has(node)) {
          seen.add(node);
          nodes.push(node);
        }
      }
    }
    this.nodes = nodes;
  }

  /** Terminal node names (no outgoing edges); populated by {@link validate}. */
  get terminalNodeNames(): ReadonlySet<string> {
    return this._terminalNodeNames;
  }

  /**
   * Deterministic RFC 8785 JCS + SHA-256 hash of the validated graph topology.
   */
  get topologyHash(): string {
    if (!this._topologyHash) {
      this._topologyHash = computeGraphTopologyHash(this.nodes, this.edges);
    }
    return this._topologyHash;
  }

  /**
   * Determines the next nodes to transition to PENDING based on the route(s)
   * emitted by a completed node.
   */
  getNextPendingNodes(
    nodeName: string,
    routesToMatch: RouteValue | RouteValue[] | null | undefined
  ): string[] {
    const nextPending: string[] = [];
    let matchedSpecificRoute = false;
    let defaultRouteNode: string | undefined;

    for (const edge of this.edges) {
      if (edge.fromNode.name !== nodeName) {
        continue;
      }
      if (edge.route === null || edge.route === undefined) {
        nextPending.push(edge.toNode.name);
        continue;
      }

      if (edge.route === DEFAULT_ROUTE) {
        defaultRouteNode = edge.toNode.name;
        continue;
      }

      const edgeRoutes = new Set<string>(
        (Array.isArray(edge.route) ? edge.route : [edge.route]).map(String)
      );

      let edgeMatched = false;
      if (Array.isArray(routesToMatch)) {
        edgeMatched = routesToMatch.some((r) => edgeRoutes.has(String(r)));
      } else if (routesToMatch !== null && routesToMatch !== undefined) {
        edgeMatched = edgeRoutes.has(String(routesToMatch));
      }

      if (edgeMatched) {
        nextPending.push(edge.toNode.name);
        matchedSpecificRoute = true;
      }
    }

    if (!matchedSpecificRoute && defaultRouteNode) {
      nextPending.push(defaultRouteNode);
    }

    return nextPending;
  }

  /** Validates the graph and computes terminal node names & topology hash. */
  validate(): void {
    this._terminalNodeNames = validateGraph(this.nodes, this.edges);
    this._topologyHash = computeGraphTopologyHash(this.nodes, this.edges);
  }
}

/**
 * Builds, validates, and returns a {@link Graph} from a list of edge items.
 */
export function createGraphFromEdgeItems(edgeItems: EdgeItem[]): Graph {
  const graph = new Graph(parseEdgeItems(edgeItems));
  graph.validate();
  return graph;
}
