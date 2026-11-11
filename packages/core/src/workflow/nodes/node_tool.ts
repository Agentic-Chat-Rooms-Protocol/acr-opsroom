/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/nodes/node_tool.ts`.
 */

import { BaseNode, registerNodeToolFactory } from '../base_node.js';
import { NodeContext } from '../node_context.js';
import { executeChildNode } from '../node_runner.js';
import {
  BaseTool,
  isZodObject,
  joinBranchExecutionAuthority,
  JsonSchemaObject,
  RunAsyncToolRequest,
  toJsonSchema,
  ToolContextShim,
} from '../shims.js';

const NODE_TOOL_SIGNATURE_SYMBOL = Symbol.for('google.adk.workflow.nodeTool');

export const MAX_NODE_TOOL_DEPTH = 8;

export interface NodeToolOptions {
  allowDefaultSchema?: boolean;
}

/**
 * A tool that executes a {@link BaseNode} (e.g. a `Workflow` or a function node)
 * as a callable tool with `MAX_NODE_TOOL_DEPTH = 8` recursion protection and
 * full propagation of `workflowId`, `graphTopologyHash`, `nodePath`,
 * `interruptIds`, and elevated `executionAuthority`.
 */
export class NodeTool extends BaseTool {
  readonly [NODE_TOOL_SIGNATURE_SYMBOL] = true;
  readonly node: BaseNode;

  constructor(
    node: BaseNode,
    name?: string,
    description?: string,
    options: NodeToolOptions = {}
  ) {
    if (!node.inputSchema && options.allowDefaultSchema === false) {
      throw new Error(
        `Node '${node.name}' does not have an inputSchema defined. NodeTool ` +
          'requires an explicit input schema on the wrapped node.'
      );
    }
    super({
      name: name ?? node.name,
      description:
        description || node.description || `Executes the node: ${node.name}`,
      isLongRunning: true,
    });
    this.node = node;
  }

  _getDeclaration(): {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  } {
    const schema = this.node.inputSchema;
    let parameters: JsonSchemaObject;
    if (schema && isZodObject(schema)) {
      parameters = toJsonSchema(schema);
    } else if (
      schema &&
      typeof schema === 'object' &&
      'type' in schema &&
      schema.type === 'object'
    ) {
      parameters = schema as JsonSchemaObject;
    } else if (!schema) {
      parameters = {
        type: 'object',
        properties: {},
      };
    } else {
      parameters = {
        type: 'object',
        properties: { request: { type: 'string' } },
        required: ['request'],
      };
    }
    return { name: this.name, description: this.description, parameters };
  }

  private get inputIsObject(): boolean {
    if (!this.node.inputSchema) return true;
    if (isZodObject(this.node.inputSchema)) return true;
    return (
      typeof this.node.inputSchema === 'object' &&
      'type' in this.node.inputSchema &&
      this.node.inputSchema.type === 'object'
    );
  }

  override async runAsync({
    args,
    toolContext,
  }: RunAsyncToolRequest): Promise<unknown> {
    const nodeInput = this.inputIsObject ? args : (args['request'] ?? args);
    const child = await this.runNode(toolContext, nodeInput);

    if (child.interruptIds.length > 0) {
      return undefined;
    }

    return child.output === undefined ? { result: null } : child.output;
  }

  private async runNode(
    toolContext: ToolContextShim,
    nodeInput: unknown
  ): Promise<NodeContext> {
    const ic = toolContext.invocationContext;
    const parentNodeCtx = toolContext.nodeContext as NodeContext | undefined;
    const channel = ic.eventQueue ?? parentNodeCtx?.channel;
    if (!channel) {
      throw new Error(
        `NodeTool '${this.name}' requires an invocation event queue; ` +
          'it must be invoked from an agent or workflow tool-call step.'
      );
    }

    const runId = toolContext.functionCallId;
    if (!runId) {
      throw new Error(
        `NodeTool '${this.name}' requires a function-call id; ` +
          'it must be invoked from an agent or workflow tool-call step.'
      );
    }

    if (ic.nodeToolDepth >= MAX_NODE_TOOL_DEPTH) {
      throw new Error(
        `NodeTool '${this.name}': node-tool nesting exceeded ` +
          `${MAX_NODE_TOOL_DEPTH} (possible node -> tool -> node recursion).`
      );
    }

    const workflowId =
      toolContext.workflowId ?? parentNodeCtx?.workflowId ?? ic.invocationId;
    const graphTopologyHash =
      toolContext.graphTopologyHash ?? parentNodeCtx?.graphTopologyHash ?? '';
    const parentPath = toolContext.nodePath ?? parentNodeCtx?.nodePath ?? '';
    const initialAuthority =
      toolContext.executionAuthority ??
      parentNodeCtx?.executionAuthority ??
      ic.executionAuthority;

    const childIc = ic.clone({
      nodeToolDepth: ic.nodeToolDepth + 1,
      eventQueue: channel,
      executionAuthority: initialAuthority,
    });

    const nodeCtx = new NodeContext({
      invocationContext: childIc,
      channel,
      nodePath: parentPath,
      runId,
      workflowId,
      graphTopologyHash,
      executionAuthority: initialAuthority,
      resumeInputs: toolContext.resumeInputs ?? parentNodeCtx?.resumeInputs,
    });

    const base = childIc.branch;
    const segment = `${this.name}@${runId}`;
    const overrideBranch = base ? `${base}.${segment}` : segment;

    const child = await executeChildNode({
      parent: nodeCtx,
      node: this.node,
      input: nodeInput,
      options: {
        nodeName: this.name,
        runId,
        overrideBranch,
        overrideExecutionAuthority: initialAuthority,
      },
    });

    const joinedAuthority = joinBranchExecutionAuthority(
      initialAuthority,
      child.executionAuthority,
      initialAuthority
    );
    toolContext.executionAuthority = joinedAuthority;
    ic.executionAuthority = joinedAuthority;
    if (parentNodeCtx) {
      parentNodeCtx.executionAuthority = joinBranchExecutionAuthority(
        parentNodeCtx.executionAuthority,
        joinedAuthority,
        initialAuthority
      );
    }

    if (child.interruptIds.length > 0) {
      toolContext.interruptIds = [...child.interruptIds];
      if (parentNodeCtx) {
        for (const id of child.interruptIds) {
          if (!parentNodeCtx.interruptIds.includes(id)) {
            parentNodeCtx.interruptIds.push(id);
          }
        }
      }
    }

    return child;
  }
}

registerNodeToolFactory(
  (node, config) =>
    new NodeTool(node, config?.name, config?.description, {
      allowDefaultSchema: true,
    })
);

export function isNodeTool(value: unknown): value is NodeTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    NODE_TOOL_SIGNATURE_SYMBOL in value &&
    (value as NodeTool)[NODE_TOOL_SIGNATURE_SYMBOL] === true
  );
}
