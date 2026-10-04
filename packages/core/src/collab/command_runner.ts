/**
 * Mockable Command Runner Abstraction for VCS Collaboration
 * Ensures 100% offline unit testing without spawning child processes.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions
) => Promise<CommandResult>;

export const defaultCommandRunner: CommandRunner = async (
  command: string,
  args: string[],
  options?: CommandOptions
): Promise<CommandResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      timeout: options?.timeoutMs ?? 30000,
    });
    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
    };
  } catch (err: any) {
    return {
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : err.message || String(err),
      exitCode: typeof err.code === 'number' ? err.code : 1,
    };
  }
};

export interface RecordedInvocation {
  command: string;
  args: string[];
  options?: CommandOptions;
}

export class FakeCommandRunner {
  public invocations: RecordedInvocation[] = [];
  private cannedResponses: Map<string, CommandResult> = new Map();
  public defaultResponse: CommandResult = {
    stdout: '',
    stderr: '',
    exitCode: 0,
  };

  public setResponse(command: string, args: string[], response: Partial<CommandResult>): void {
    const key = this.makeKey(command, args);
    this.cannedResponses.set(key, {
      stdout: response.stdout ?? '',
      stderr: response.stderr ?? '',
      exitCode: response.exitCode ?? 0,
    });
  }

  public setResponsePrefix(command: string, prefixArgs: string[], response: Partial<CommandResult>): void {
    const key = `${command} ${prefixArgs.join(' ')}`;
    this.cannedResponses.set(key, {
      stdout: response.stdout ?? '',
      stderr: response.stderr ?? '',
      exitCode: response.exitCode ?? 0,
    });
  }

  private makeKey(command: string, args: string[]): string {
    return `${command} ${args.join(' ')}`;
  }

  public run: CommandRunner = async (
    command: string,
    args: string[],
    options?: CommandOptions
  ): Promise<CommandResult> => {
    this.invocations.push({ command, args, options });
    const fullKey = this.makeKey(command, args);
    if (this.cannedResponses.has(fullKey)) {
      return this.cannedResponses.get(fullKey)!;
    }

    // Try prefix matching
    for (const [key, res] of this.cannedResponses.entries()) {
      if (fullKey.startsWith(key)) {
        return res;
      }
    }

    return this.defaultResponse;
  };

  public clear(): void {
    this.invocations = [];
    this.cannedResponses.clear();
  }
}
