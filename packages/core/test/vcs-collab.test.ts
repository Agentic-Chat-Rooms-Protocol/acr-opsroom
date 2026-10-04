import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeCommandRunner,
  GitHubAdapter,
  JujutsuAdapter,
} from '../src/collab/index.js';

describe('VCS Collaboration - GitHubAdapter (gh CLI)', () => {
  it('constructs exact argument vector for issue_list and parses JSON result', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.setResponse('gh', [
      'issue',
      'list',
      '--repo',
      'agent-org/agent-repo',
      '--json',
      'number,title,state,author,labels,createdAt',
    ], {
      stdout: JSON.stringify([
        {
          number: 101,
          title: 'Implement Byron consensus fallback',
          state: 'OPEN',
          author: { login: 'agent-did-001' },
          labels: [{ name: 'consensus' }],
          createdAt: '2026-10-04T00:00:00Z',
        },
      ]),
      exitCode: 0,
    });

    const adapter = new GitHubAdapter(fakeRunner.run);
    const issues = await adapter.issue_list('agent-org/agent-repo');

    assert.equal(issues.length, 1);
    assert.equal(issues[0].number, 101);
    assert.equal(issues[0].title, 'Implement Byron consensus fallback');

    assert.equal(fakeRunner.invocations.length, 1);
    const inv = fakeRunner.invocations[0];
    assert.equal(inv.command, 'gh');
    assert.deepEqual(inv.args, [
      'issue',
      'list',
      '--repo',
      'agent-org/agent-repo',
      '--json',
      'number,title,state,author,labels,createdAt',
    ]);
  });

  it('constructs exact argument vector for issue_create', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.setResponse('gh', [
      'issue',
      'create',
      '--repo',
      'agent-org/agent-repo',
      '--title',
      'Bug in PII scrubber',
      '--body',
      'Redaction failed on nested dict',
    ], {
      stdout: 'https://github.com/agent-org/agent-repo/issues/42\n',
      exitCode: 0,
    });

    const adapter = new GitHubAdapter(fakeRunner.run);
    const result = await adapter.issue_create(
      'agent-org/agent-repo',
      'Bug in PII scrubber',
      'Redaction failed on nested dict'
    );

    assert.equal(result.success, true);
    assert.equal(result.repo, 'agent-org/agent-repo');
    assert.equal(result.data.url, 'https://github.com/agent-org/agent-repo/issues/42');

    assert.deepEqual(fakeRunner.invocations[0].args, [
      'issue',
      'create',
      '--repo',
      'agent-org/agent-repo',
      '--title',
      'Bug in PII scrubber',
      '--body',
      'Redaction failed on nested dict',
    ]);
  });

  it('constructs exact argument vector for issue_comment', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.defaultResponse = { stdout: 'Comment added\n', stderr: '', exitCode: 0 };

    const adapter = new GitHubAdapter(fakeRunner.run);
    const res = await adapter.issue_comment(
      'agent-org/agent-repo',
      42,
      'Deliberation approved by supermajority'
    );

    assert.equal(res.success, true);
    assert.deepEqual(fakeRunner.invocations[0].args, [
      'issue',
      'comment',
      '42',
      '--repo',
      'agent-org/agent-repo',
      '--body',
      'Deliberation approved by supermajority',
    ]);
  });

  it('constructs exact argument vector for pr_list', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.setResponse('gh', [
      'pr',
      'list',
      '--repo',
      'agent-org/agent-repo',
      '--json',
      'number,title,state,author,headRefName,baseRefName,createdAt',
    ], {
      stdout: JSON.stringify([
        {
          number: 12,
          title: 'Add Jujutsu collab driver',
          state: 'OPEN',
          headRefName: 'feat/jj',
          baseRefName: 'main',
        },
      ]),
      exitCode: 0,
    });

    const adapter = new GitHubAdapter(fakeRunner.run);
    const prs = await adapter.pr_list('agent-org/agent-repo');
    assert.equal(prs.length, 1);
    assert.equal(prs[0].number, 12);
    assert.equal(prs[0].headRefName, 'feat/jj');
  });

  it('constructs exact argument vector for pr_create', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.defaultResponse = {
      stdout: 'https://github.com/agent-org/agent-repo/pull/13\n',
      stderr: '',
      exitCode: 0,
    };

    const adapter = new GitHubAdapter(fakeRunner.run);
    const result = await adapter.pr_create(
      'agent-org/agent-repo',
      'feat: 3-pane workspace',
      'Implements WCAG 2.2 AAA 3-pane layout',
      'feature/3-pane',
      'main'
    );

    assert.equal(result.success, true);
    assert.deepEqual(fakeRunner.invocations[0].args, [
      'pr',
      'create',
      '--repo',
      'agent-org/agent-repo',
      '--title',
      'feat: 3-pane workspace',
      '--body',
      'Implements WCAG 2.2 AAA 3-pane layout',
      '--head',
      'feature/3-pane',
      '--base',
      'main',
    ]);
  });

  it('constructs exact argument vector for pr_comment', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.defaultResponse = { stdout: 'Comment created\n', stderr: '', exitCode: 0 };

    const adapter = new GitHubAdapter(fakeRunner.run);
    const result = await adapter.pr_comment(
      'agent-org/agent-repo',
      13,
      'Automated review: all gates passed'
    );

    assert.equal(result.success, true);
    assert.deepEqual(fakeRunner.invocations[0].args, [
      'pr',
      'comment',
      '13',
      '--repo',
      'agent-org/agent-repo',
      '--body',
      'Automated review: all gates passed',
    ]);
  });

  it('supports squash, merge, and rebase strategies for pr_merge', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.defaultResponse = { stdout: 'Merged\n', stderr: '', exitCode: 0 };
    const adapter = new GitHubAdapter(fakeRunner.run);

    await adapter.pr_merge('agent-org/agent-repo', 13, 'squash');
    assert.deepEqual(fakeRunner.invocations[0].args, [
      'pr',
      'merge',
      '13',
      '--repo',
      'agent-org/agent-repo',
      '--squash',
    ]);

    await adapter.pr_merge('agent-org/agent-repo', 14, 'merge');
    assert.deepEqual(fakeRunner.invocations[1].args, [
      'pr',
      'merge',
      '14',
      '--repo',
      'agent-org/agent-repo',
      '--merge',
    ]);

    await adapter.pr_merge('agent-org/agent-repo', 15, 'rebase');
    assert.deepEqual(fakeRunner.invocations[2].args, [
      'pr',
      'merge',
      '15',
      '--repo',
      'agent-org/agent-repo',
      '--rebase',
    ]);
  });

  it('throws descriptive error on command failure with non-zero exit code', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.defaultResponse = {
      stdout: '',
      stderr: 'GraphQL: Resource not accessible by integration (403)',
      exitCode: 1,
    };

    const adapter = new GitHubAdapter(fakeRunner.run);
    await assert.rejects(
      async () => {
        await adapter.issue_list('agent-org/private-repo');
      },
      /gh issue list failed \(code 1\): GraphQL: Resource not accessible/
    );
  });
});

describe('VCS Collaboration - JujutsuAdapter (jj CLI)', () => {
  it('constructs exact argument vector for status and diff', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.setResponse('jj', ['status'], {
      stdout: 'Working copy changes:\nM src/index.ts\n',
      exitCode: 0,
    });
    fakeRunner.setResponse('jj', ['diff'], {
      stdout: 'Modified: src/index.ts\n+ export * from "./collab";\n',
      exitCode: 0,
    });

    const adapter = new JujutsuAdapter(fakeRunner.run);
    const status = await adapter.status();
    assert.equal(status, 'Working copy changes:\nM src/index.ts');

    const diff = await adapter.diff();
    assert.match(diff, /export \* from "\.\/collab"/);

    assert.equal(fakeRunner.invocations.length, 2);
    assert.deepEqual(fakeRunner.invocations[0].args, ['status']);
    assert.deepEqual(fakeRunner.invocations[1].args, ['diff']);
  });

  it('constructs exact argument vector for log with and without limit', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.defaultResponse = { stdout: '@ change 1\no change 0\n', stderr: '', exitCode: 0 };

    const adapter = new JujutsuAdapter(fakeRunner.run);
    await adapter.log();
    assert.deepEqual(fakeRunner.invocations[0].args, ['log']);

    await adapter.log(5);
    assert.deepEqual(fakeRunner.invocations[1].args, ['log', '-n', '5']);
  });

  it('constructs exact argument vector for new_change, describe, and git_push', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.defaultResponse = { stdout: 'OK', stderr: '', exitCode: 0 };

    const adapter = new JujutsuAdapter(fakeRunner.run);
    await adapter.new_change('feat: autonomous patch');
    assert.deepEqual(fakeRunner.invocations[0].args, ['new', '-m', 'feat: autonomous patch']);

    await adapter.describe('feat: refined patch description');
    assert.deepEqual(fakeRunner.invocations[1].args, ['describe', '-m', 'feat: refined patch description']);

    await adapter.git_push();
    assert.deepEqual(fakeRunner.invocations[2].args, ['git', 'push']);
  });

  it('throws descriptive error on jj failure with non-zero exit code', async () => {
    const fakeRunner = new FakeCommandRunner();
    fakeRunner.defaultResponse = {
      stdout: '',
      stderr: 'Error: No git remote configured for default push',
      exitCode: 2,
    };

    const adapter = new JujutsuAdapter(fakeRunner.run);
    await assert.rejects(
      async () => {
        await adapter.git_push();
      },
      /jj git push failed \(code 2\): Error: No git remote configured/
    );
  });
});
