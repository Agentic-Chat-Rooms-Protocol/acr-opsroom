/**
 * ACR Core Reference Daemon HTTP Client
 * Connects to acr-core (default: http://127.0.0.1:20443) with automatic
 * Bearer token authentication resolved from explicit config, ACR_API_TOKEN,
 * or ~/.acr/api-token.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ACR_CORE_URL = 'http://127.0.0.1:20443';

export interface ResolveAcrApiTokenOptions {
  apiToken?: string;
  tokenFilePath?: string;
  homeDir?: string;
}

export interface AcrCoreClientConfig extends ResolveAcrApiTokenOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

export interface AcrCoreRequestOptions extends RequestInit {
  requireAuth?: boolean;
}

/**
 * Resolves the Bearer API token for acr-core daemon calls in priority order:
 * 1. Explicit `apiToken` parameter
 * 2. `process.env.ACR_API_TOKEN`
 * 3. `~/.acr/api-token` (or custom `tokenFilePath`)
 */
export function resolveAcrApiToken(options: ResolveAcrApiTokenOptions = {}): string | undefined {
  const explicit = options.apiToken?.trim();
  if (explicit) {
    return explicit;
  }

  if (typeof process !== 'undefined' && process.env) {
    const envToken = process.env.ACR_API_TOKEN?.trim();
    if (envToken) {
      return envToken;
    }
  }

  try {
    if (typeof fs?.readFileSync === 'function') {
      const resolvedPath =
        options.tokenFilePath ||
        path.join(options.homeDir || os.homedir(), '.acr', 'api-token');
      if (resolvedPath && fs.existsSync(resolvedPath)) {
        const fileToken = fs.readFileSync(resolvedPath, 'utf8').trim();
        if (fileToken) {
          return fileToken;
        }
      }
    }
  } catch {
    // Gracefully return undefined if ~/.acr/api-token is unreadable or unavailable
  }

  return undefined;
}

export class AcrCoreClient {
  public readonly baseUrl: string;
  private readonly explicitToken?: string;
  private readonly tokenFilePath?: string;
  private readonly homeDir?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: AcrCoreClientConfig = {}) {
    const rawBaseUrl =
      config.baseUrl ||
      (typeof process !== 'undefined' && process.env?.ACR_CORE_URL) ||
      DEFAULT_ACR_CORE_URL;
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '');
    this.explicitToken = config.apiToken;
    this.tokenFilePath = config.tokenFilePath;
    this.homeDir = config.homeDir;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  public resolveToken(): string | undefined {
    return resolveAcrApiToken({
      apiToken: this.explicitToken,
      tokenFilePath: this.tokenFilePath,
      homeDir: this.homeDir,
    });
  }

  public getAuthHeaders(): Record<string, string> {
    const token = this.resolveToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  public async request<T = unknown>(
    endpointPath: string,
    options: AcrCoreRequestOptions = {}
  ): Promise<T> {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Fetch implementation is unavailable for AcrCoreClient');
    }

    const { requireAuth = false, headers: customHeaders, signal, ...restInit } = options;
    const authHeaders = this.getAuthHeaders();

    if (requireAuth && !authHeaders.Authorization) {
      throw new Error(
        'ACR_API_TOKEN or ~/.acr/api-token is required for authenticated acr-core daemon calls'
      );
    }

    const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    const url = `${this.baseUrl}${normalizedPath}`;

    const mergedHeaders: Record<string, string> = {
      ...(restInit.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders,
    };

    if (customHeaders) {
      if (customHeaders instanceof Headers) {
        customHeaders.forEach((value, key) => {
          mergedHeaders[key] = value;
        });
      } else if (Array.isArray(customHeaders)) {
        for (const [key, value] of customHeaders) {
          mergedHeaders[key] = value;
        }
      } else {
        Object.assign(mergedHeaders, customHeaders);
      }
    }

    const response = await this.fetchImpl(url, {
      ...restInit,
      headers: mergedHeaders,
      signal: signal ?? AbortSignal.timeout(this.timeoutMs),
    });

    const contentType = response.headers?.get?.('content-type') || '';
    const rawBody = await response.text();
    let parsed: unknown = rawBody;
    if (rawBody && contentType.includes('application/json')) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = rawBody;
      }
    } else if (rawBody) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = rawBody;
      }
    }

    if (!response.ok) {
      const detail =
        typeof parsed === 'object' && parsed !== null && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : rawBody || response.statusText;
      throw new Error(`acr-core request failed (${response.status} ${normalizedPath}): ${detail}`);
    }

    return parsed as T;
  }

  public getHealth(): Promise<Record<string, unknown>> {
    return this.request('/health', { method: 'GET' });
  }

  public getSecurityConfig(): Promise<Record<string, unknown>> {
    return this.request('/api/v1/config/security', { method: 'GET' });
  }

  public listRooms(): Promise<Record<string, unknown>> {
    return this.request('/api/v1/rooms', { method: 'GET' });
  }

  public createRoom(payload: {
    name: string;
    isPrivate?: boolean;
    workflowType?: string;
    workflowConfig?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.request('/api/v1/rooms', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public postRoomMessage(
    roomId: string,
    payload: { content: string; senderDid?: string; signature?: string }
  ): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public createProposal(payload: {
    roomId: string;
    title: string;
    payload: Record<string, unknown>;
    proposerDid?: string;
  }): Promise<Record<string, unknown>> {
    return this.request('/api/v1/proposals', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public getAuditChain(): Promise<Record<string, unknown>> {
    return this.request('/api/v1/audit/chain', { method: 'GET' });
  }
}
