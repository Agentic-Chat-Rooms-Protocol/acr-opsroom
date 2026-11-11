/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  BasePlugin,
  ContextCompactionTrigger,
  type LlmRequestShim,
  type LlmResponseShim,
} from './base_plugin.js';
export {
  GLOBAL_SCOPE_KEY,
  REFLECT_AND_RETRY_RESPONSE_TYPE,
  resolveScopeKey,
  ScopedFailureTracker,
  type ToolFailureResponse,
  TrackingScope,
} from './_reflect_retry_utils.js';
export {
  ReflectAndRetryToolPlugin,
  type ReflectAndRetryToolPluginOptions,
} from './reflect_retry_tool_plugin.js';
export {
  ADK_HANDLE_MODEL_ERROR_TOOL_NAME,
  DEFAULT_HANDLED_FINISH_REASONS,
  FinishReason,
  ReflectAndRetryModelPlugin,
  type ReflectAndRetryModelPluginOptions,
  RESERVED_TOOL_CALL_ERROR_TYPE,
} from './reflect_retry_model_plugin.js';
export {
  SIDE_EFFECT_RECONCILIATION_REQUIRED_TYPE,
  WalGuardedReflectRetryPlugin,
  type WalGuardedReflectRetryPluginOptions,
  type WalReconciliationBlockedResponse,
} from './wal_guarded_reflect_retry_plugin.js';
export {
  INTERNAL_METADATA_PREFIX,
  internalMetadata,
  markRestored,
  publicEvent,
  publicMetadata,
  publicSession,
  RESTORED_EVENT_KEY,
  withoutInternalMetadata,
  withoutRestoredMarker,
} from './internal_metadata.js';
export {
  TOOL_CALL_HMAC_METADATA_KEY,
  ToolCallIntegrityError,
  ToolCallIntegrityPlugin,
  type ToolCallIntegrityPluginOptions,
} from './tool_call_integrity_plugin.js';
export { PluginManager } from './plugin_manager.js';
