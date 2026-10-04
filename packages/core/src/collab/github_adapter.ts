/**
 * GitHub CLI (gh) Adapter for Cross-Repo VCS Deliberation
 * Conforms to FR-011.1, FR-011.3, FR-011.4:
 * - Mockable CommandRunner execution for 100% offline testing.
 * - Zero token leakage into memory; relies entirely on host environment credentials.
 * - Comprehensive issue and PR deliberation actions.
 */

import { CommandRunner, CommandOptions, defaultCommandRunner } from './command_runner.js';

export type MergeMethod = 'squash' | 'merge' | 'rebase';

export interface GitHubIssue {
  number: number;
  title: string;
  state?: string;
  author?: { login: string };
  labels?: Array<{ name: string }>;
  createdAt?: string;
  url?: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state?: string;
  author?: { login: string };
  headRefName?: string;
  baseRefName?: string;
  createdAt?: string;
  url?: string;
}

export interface GitHubOperationResult {
  success: boolean;
  repo: string;
  rawOutput: string;
  data?: any;
}

export class GitHubAdapter {
  private runner: CommandRunner;
  private defaultOptions?: CommandOptions;

  constructor(runner: CommandRunner = defaultCommandRunner, defaultOptions?: CommandOptions) {
    this.runner = runner;
    this.defaultOptions = defaultOptions;
  }

  /**
   * List issues in a repository.
   */
  public async issue_list(repo: string): Promise<GitHubIssue[]> {
    const args = [
      'issue',
      'list',
      '--repo',
      repo,
      '--json',
      'number,title,state,author,labels,createdAt',
    ];
    const res = await this.runner('gh', args, this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`gh issue list failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    try {
      const parsed = JSON.parse(res.stdout.trim() || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async issueList(repo: string): Promise<GitHubIssue[]> {
    return this.issue_list(repo);
  }

  /**
   * Create an issue in a repository.
   */
  public async issue_create(repo: string, title: string, body: string): Promise<GitHubOperationResult> {
    const args = ['issue', 'create', '--repo', repo, '--title', title, '--body', body];
    const res = await this.runner('gh', args, this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`gh issue create failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    let parsedData: any = undefined;
    try {
      parsedData = JSON.parse(res.stdout.trim());
    } catch {
      parsedData = { url: res.stdout.trim() };
    }

    return {
      success: true,
      repo,
      rawOutput: res.stdout.trim(),
      data: parsedData,
    };
  }

  public async issueCreate(repo: string, title: string, body: string): Promise<GitHubOperationResult> {
    return this.issue_create(repo, title, body);
  }

  /**
   * Add a comment to an issue.
   */
  public async issue_comment(
    repo: string,
    number: number,
    body: string
  ): Promise<GitHubOperationResult> {
    const args = ['issue', 'comment', String(number), '--repo', repo, '--body', body];
    const res = await this.runner('gh', args, this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`gh issue comment failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    return {
      success: true,
      repo,
      rawOutput: res.stdout.trim(),
    };
  }

  public async issueComment(
    repo: string,
    number: number,
    body: string
  ): Promise<GitHubOperationResult> {
    return this.issue_comment(repo, number, body);
  }

  /**
   * List pull requests in a repository.
   */
  public async pr_list(repo: string): Promise<GitHubPullRequest[]> {
    const args = [
      'pr',
      'list',
      '--repo',
      repo,
      '--json',
      'number,title,state,author,headRefName,baseRefName,createdAt',
    ];
    const res = await this.runner('gh', args, this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`gh pr list failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    try {
      const parsed = JSON.parse(res.stdout.trim() || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async prList(repo: string): Promise<GitHubPullRequest[]> {
    return this.pr_list(repo);
  }

  /**
   * Create a pull request in a repository.
   */
  public async pr_create(
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<GitHubOperationResult> {
    const args = [
      'pr',
      'create',
      '--repo',
      repo,
      '--title',
      title,
      '--body',
      body,
      '--head',
      head,
      '--base',
      base,
    ];
    const res = await this.runner('gh', args, this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`gh pr create failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    let parsedData: any = undefined;
    try {
      parsedData = JSON.parse(res.stdout.trim());
    } catch {
      parsedData = { url: res.stdout.trim() };
    }

    return {
      success: true,
      repo,
      rawOutput: res.stdout.trim(),
      data: parsedData,
    };
  }

  public async prCreate(
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<GitHubOperationResult> {
    return this.pr_create(repo, title, body, head, base);
  }

  /**
   * Add a comment to a pull request.
   */
  public async pr_comment(
    repo: string,
    number: number,
    body: string
  ): Promise<GitHubOperationResult> {
    const args = ['pr', 'comment', String(number), '--repo', repo, '--body', body];
    const res = await this.runner('gh', args, this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`gh pr comment failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    return {
      success: true,
      repo,
      rawOutput: res.stdout.trim(),
    };
  }

  public async prComment(
    repo: string,
    number: number,
    body: string
  ): Promise<GitHubOperationResult> {
    return this.pr_comment(repo, number, body);
  }

  /**
   * Merge a pull request using squash, merge, or rebase.
   */
  public async pr_merge(
    repo: string,
    number: number,
    method: MergeMethod = 'squash'
  ): Promise<GitHubOperationResult> {
    const methodFlag = `--${method}`;
    const args = ['pr', 'merge', String(number), '--repo', repo, methodFlag];
    const res = await this.runner('gh', args, this.defaultOptions);
    if (res.exitCode !== 0) {
      throw new Error(`gh pr merge failed (code ${res.exitCode}): ${res.stderr || res.stdout}`);
    }

    return {
      success: true,
      repo,
      rawOutput: res.stdout.trim(),
    };
  }

  public async prMerge(
    repo: string,
    number: number,
    method: MergeMethod = 'squash'
  ): Promise<GitHubOperationResult> {
    return this.pr_merge(repo, number, method);
  }
}
