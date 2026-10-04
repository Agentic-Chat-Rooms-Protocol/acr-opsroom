/**
 * Jujutsu (jj) CLI Adapter for Agentic Working Copy Deliberation
 * Conforms to FR-011.2, FR-011.3, FR-011.4:
 * - Mockable CommandRunner execution for 100% offline testing.
 * - Zero token leakage into memory.
 * - Supports status, diff, log, new_change, describe, and git_push.
 */

import { CommandRunner, CommandOptions, defaultCommandRunner } from './command_runner.js';

export class JujutsuAdapter {
  private runner: CommandRunner;
  private defaultOptions?: CommandOptions;

  constructor(runner: CommandRunner = defaultCommandRunner, defaultOptions?: CommandOptions) {
    this.runner = runner;
    this.defaultOptions = defaultOptions;
  }

  /**
   * Run `jj status` and return working copy status.
   */
  public async status(): Promise<string> {
    const res = await this.runner('jj', ['status'], this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`jj status failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }
    return res.stdout.trim();
  }

  /**
   * Run `jj diff` and return working copy diff.
   */
  public async diff(): Promise<string> {
    const res = await this.runner('jj', ['diff'], this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`jj diff failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }
    return res.stdout.trim();
  }

  /**
   * Run `jj log` and return revision log.
   */
  public async log(limit?: number): Promise<string> {
    const args = ['log'];
    if (typeof limit === 'number' && limit > 0) {
      args.push('-n', String(limit));
    }
    const res = await this.runner('jj', args, this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`jj log failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }
    return res.stdout.trim();
  }

  /**
   * Run `jj new -m <message>` creating a new working copy change.
   */
  public async new_change(message: string): Promise<string> {
    const res = await this.runner('jj', ['new', '-m', message], this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`jj new failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }
    return res.stdout.trim();
  }

  public async newChange(message: string): Promise<string> {
    return this.new_change(message);
  }

  /**
   * Run `jj describe -m <message>` describing the current change.
   */
  public async describe(message: string): Promise<string> {
    const res = await this.runner('jj', ['describe', '-m', message], this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`jj describe failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }
    return res.stdout.trim();
  }

  /**
   * Run `jj git push` to push bookmark or changes to git remote.
   */
  public async git_push(): Promise<string> {
    const res = await this.runner('jj', ['git', 'push'], this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`jj git push failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }
    return res.stdout.trim();
  }

  public async gitPush(): Promise<string> {
    return this.git_push();
  }
}
