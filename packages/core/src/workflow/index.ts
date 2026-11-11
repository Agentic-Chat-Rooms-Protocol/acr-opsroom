/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Selective-reuse origin: google/adk-js (core/src/workflow/index.ts, commit 8dad457)
 * Adapted & extended for ACR Hyperfusion (Atlas2GraphWorkflow, Hyperfused Nodes,
 * CheckpointSafeContextCompactor, Task-Mode Agent Runner, WAL-Guarded Reflection,
 * and ToolCallIntegrityPlugin).
 */

import './node_builders.js';

export {
  ABORT_MESSAGE,
  buildAbortEvents,
  INVOCATION_ABORTED,
  isAbortEvent,
} from './abort_events.js';
export {
  BaseNode,
  isBaseNode,
  isContent,
  registerNodeToolFactory,
  START,
  toContent,
  type AsToolConfig,
  type BaseNodeConfig,
} from './base_node.js';
export {
  BranchPath,
  branchPathFromString,
  commonPrefixOf,
  createSubBranch,
} from './branch_path.js';
export {
  filterByIsolationScope,
  getContents,
  getCurrentTurnContents,
  getFunctionCallEventsFromHistory,
  isAuthEvent,
  mergeFunctionResponseEvents,
  resolveConsumerScope,
} from './content_processor_utils.js';
export * from './context/index.js';
export {
  DynamicNodeScheduler,
  type DynamicNodeSchedulerOptions,
} from './dynamic_node_scheduler.js';
export {
  DynamicNodeFailError,
  InvocationAbortedError,
  isDynamicNodeFailError,
  isInvocationAbortedError,
  isNodeInterruptedError,
  isNodeOutcomeUnknownError,
  isNodePrivilegeEscalationError,
  isNodeReportedError,
  isNodeSchemaValidationError,
  isNodeTimeoutError,
  isStaleGenerationFenceError,
  NodeInterruptedError,
  NodeOutcomeUnknownError,
  NodePrivilegeEscalationError,
  NodeReportedError,
  NodeSchemaValidationError,
  NodeTimeoutError,
  StaleGenerationFenceError,
} from './errors.js';
export {
  RoutedNode,
  runWithRouting,
  type RoutedNodeConfig,
  type Router,
} from './failover_utils.js';
export {
  createGraphFromEdgeItems,
  DEFAULT,
  DEFAULT_ROUTE,
  Edge,
  isEdge,
  OUTCOME_UNKNOWN_ROUTE,
  type ChainElement,
  type EdgeItem,
  type Graph,
  type NodeLike,
  type RoutingMap,
  type RouteValue,
  type RunnableNode,
} from './graph.js';
export {
  formatResolvedValue,
  injectSessionState,
  PREDECESSOR_REF_PATTERN,
  resolvePredecessorRefs,
  resolveValue,
  type WorkflowInstructionScope,
} from './instructions.js';
export { node, type NodeOptions, type WorkflowNode } from './node.js';
export {
  FUNCTION_BUILDER,
  NODE_BUILDERS,
  PARALLEL_WORKER_FACTORY,
  TOOL_BUILDER,
  wireDefaultNodeBuilders,
} from './node_builders.js';
export {
  NodeContext,
  type NodeContextOptions,
  type NodeResult,
} from './node_context.js';
export {
  claimNodeErrorReport,
  createNodeErrorEvent,
  isNodeErrorEvent,
  type CreateNodeErrorEventParams,
  type NodeErrorEvent,
} from './node_error_event.js';
export {
  executeChildNode,
  type ExecuteChildNodeParams,
  type RunNodeOptions,
} from './node_runner.js';
export {
  createNodeState,
  isNodeState,
  type NodeState,
} from './node_state.js';
export { NodeStatus } from './node_status.js';
export {
  FunctionNode,
  type FunctionNodeConfig,
  type FunctionNodeResult,
  type FunctionNodeReturnItem,
} from './nodes/function_node.js';
export {
  AcrAgentNode,
  Atlas2GraphWorkflow,
  ByzantineQuorumNode,
  computeGraphBoundResourceVersion,
  isConsentResumePayload,
  PasskeyConsentNode,
  SandboxedExecutionNode,
  WalBackedToolNode,
  type AcrAgentNodeConfig,
  type AcrAgentTaskTurnParams,
  type Atlas2GraphWorkflowConfig,
  type ByzantineQuorumNodeConfig,
  type ConsentResumePayload,
  type PasskeyConsentNodeConfig,
  type RewindToCheckpointParams,
  type RewindToCheckpointResult,
  type SandboxExecutionResult,
  type SandboxExecutionTerminalState,
  type SandboxedExecutionNodeConfig,
  type WalBackedToolNodeConfig,
} from './nodes/hyperfused_nodes.js';
export { JoinNode } from './nodes/join_node.js';
export {
  isNodeTool,
  MAX_NODE_TOOL_DEPTH,
  NodeTool,
  type NodeToolOptions,
} from './nodes/node_tool.js';
export {
  isParallelWorker,
  ParallelWorker,
  type ParallelWorkerConfig,
} from './nodes/parallel_worker.js';
export { ToolNode, type ToolNodeConfig } from './nodes/tool_node.js';
export * from './plugins/index.js';
export {
  isRequestInput,
  RequestInput,
  type RequestInputParams,
} from './request_input.js';
export {
  normalizeRetryExceptions,
  prepareRetryConfig,
  type ErrorClass,
  type PreparedRetryConfig,
  type RetryConfig,
} from './retry_config.js';
export {
  isRoutedAgent,
  RoutedAgent,
  type AgentRouter,
  type RoutableAgentCandidate,
  type RoutedAgentConfig,
} from './routed_agent.js';
export {
  collectPredecessorOutputs,
  extractModelResponseText,
  isStructuredInput,
  maybeSetOutput,
  pushNodeInputAsUserTurn,
  runLlmAgentAsNode,
  runTaskMode,
  withWorkflowInstructionScope,
  type AgentExecutionMode,
  type LlmAgentNodeTarget,
} from './run_llm_agent_as_node.js';
export {
  asRunnableRoot,
  executeWorkflow,
  isRunnableRoot,
  runNodeAsInvocation,
  type ExecuteWorkflowOptions,
  type ExecuteWorkflowResult,
  type RunnableRoot,
  type RunNodeAsInvocationOptions,
} from './run_node_as_invocation.js';
export {
  DynamicNodeState,
  type DynamicNodeRun,
  type ScheduleDynamicNode,
  type ScheduleDynamicNodeOptions,
} from './schedule_dynamic_node.js';
export {
  AF_FUNCTION_CALL_ID_PREFIX,
  applyEventStateDelta,
  BaseTool,
  compileJsonSchema,
  createEvent,
  createEventActions,
  createInvocationContext,
  createModelContent,
  createOwnershipFencedCommitter,
  createWorkflowSession,
  elevateExecutionAuthority,
  EXECUTION_AUTHORITY_RANK,
  generateClientFunctionCallId,
  getEventTokens,
  getFunctionCalls,
  getFunctionResponses,
  hasThoughts,
  intersectExecutionAuthorities,
  isBaseTool,
  isElevatedAuthority,
  isEvent,
  isFinalResponse,
  isStateSchemaError,
  isZodLike,
  isZodObject,
  InvocationContext,
  joinBranchExecutionAuthority,
  parseWithSchema,
  populateClientFunctionCallId,
  pruneThoughts,
  recordNodeInvocation,
  recordWorkflowInvocation,
  State,
  StateSchemaError,
  stringifyContent,
  toJsonSchema,
  type AuthConfig,
  type BaseToolConfig,
  type Content,
  type CreateEventParams,
  type Event,
  type EventActions,
  type ExecutionAuthorityLevel,
  type FencedStateCommitter,
  type FunctionCallPart,
  type FunctionResponsePart,
  type InvocationContextParams,
  type JsonSchemaObject,
  type NodeInfo,
  type NodeInvocationScope,
  type Part,
  type PluginManagerShim,
  type Route,
  type RouteKey,
  type RunAsyncToolRequest,
  type SchemaLike,
  type ToolContextShim,
  type WorkflowContent,
  type WorkflowEvent,
  type WorkflowFunctionCall,
  type WorkflowFunctionResponse,
  type WorkflowPart,
  type WorkflowSession,
  type WorkflowState,
} from './shims.js';
export {
  adoptDeltaStamp,
  carryDeltaStamp,
  carryDeltaStamps,
  recordStateWrite,
  shouldApplyDeltaWrite,
} from './state_write_order.js';
export * from './tools/index.js';
export { type Trigger } from './trigger.js';
export { parseEdgeItems } from './utils/graph_parser.js';
export {
  computeGraphTopologyHash,
  detectUnconditionalCycles,
  validateGraph,
} from './utils/graph_validation.js';
export {
  createAuthRequestEvent,
  createRequestInputEvent,
  createRequestInputResponse,
  getRequestInputInterruptIds,
  hasAuthCredential,
  hasAuthRequestFunctionCall,
  hasRequestInputFunctionCall,
  interruptResponseMismatch,
  processAuthResume,
  REQUEST_CONFIRMATION_FUNCTION_CALL_NAME,
  REQUEST_CREDENTIAL_FUNCTION_CALL_NAME,
  REQUEST_EUC_FUNCTION_CALL_NAME,
  REQUEST_INPUT_FUNCTION_CALL_NAME,
  requiresUserInput,
  responseSchemasByInterruptId,
} from './utils/hitl_utils.js';
export {
  eventsForCurrentRun,
  isFastForwardable,
  makeFastForwardResult,
  nodeNameFromPath,
  reconstructNodeRuns,
  reconstructNodeStates,
  reconstructNodeStatesByPath,
  resolvedInterruptResponses,
  unwrapResponse,
  verifySessionAuditIntegrity,
  type RehydratedNode,
} from './utils/rehydration_utils.js';
export {
  errorName,
  errorNames,
  getRetryDelaySeconds,
  shouldRetryNode,
  type GetRetryDelaySecondsParams,
  type ShouldRetryNodeParams,
} from './utils/retry_utils.js';
export {
  buildNode,
  isNodeLike,
  isPlainObject,
  registerNodeBuilder,
  setParallelWorkerFactory,
  type BuildNodeOptions,
  type NodeBuilder,
  type ParallelWorkerFactory,
} from './utils/workflow_graph_utils.js';
export {
  isWorkflow,
  Workflow,
  type DynamicEntry,
  type WorkflowConfig,
} from './workflow.js';
