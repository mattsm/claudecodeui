import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAUDE_PREDEFINED_MODELS,
  annotateClaudeModelLabels,
  describeClaudeDeployment,
  extractClaudeEventModel,
} from '@/modules/providers/list/claude/claude-models.provider.js';

const SESSION_ID = 'session-1';

test('ignores the <synthetic> placeholder Claude Code stamps on synthesized rows', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: '<synthetic>' } },
      SESSION_ID,
    ),
    null,
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: '<synthetic>' }, SESSION_ID),
    null,
  );
});

test('still surfaces real model ids from message and event fields', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: 'claude-sonnet-5' } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: 'opus' }, SESSION_ID),
    'opus',
  );
});

test('skips a placeholder content part so a later real model tag still wins', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: [
            { text: '<model><synthetic></model>' },
            { text: '<model>claude-sonnet-5</model>' },
          ],
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('a placeholder stdout hit does not shadow a real <model> tag in the same text', () => {
  const text = '<local-command-stdout>Set model to <synthetic></local-command-stdout>'
    + '<model>claude-sonnet-5</model>';
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: text } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: [{ text }] } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('falls back to the message model when every content hit is a placeholder', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: '<model><synthetic></model>',
          model: 'claude-sonnet-5',
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

const labelFor = (env: NodeJS.ProcessEnv, value: string): string | undefined =>
  annotateClaudeModelLabels(CLAUDE_PREDEFINED_MODELS, env)
    .OPTIONS.find((option) => option.value === value)?.label;

test('labels alias models with the deployment their environment variable names', () => {
  const env = {
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
  } as NodeJS.ProcessEnv;

  assert.equal(labelFor(env, 'opus'), 'Opus 5.5');
  assert.equal(labelFor(env, 'opus[1m]'), 'Opus 5.5 (1M context)');
  assert.equal(labelFor(env, 'opusplan'), 'Opus 5.5 Plan');
  assert.equal(labelFor(env, 'sonnet'), 'Sonnet 4.6');
  assert.equal(labelFor(env, 'sonnet[1m]'), 'Sonnet 4.6 (1M context)');
});

test('names deployments by family and version, ignoring revision and date suffixes', () => {
  assert.equal(describeClaudeDeployment('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(describeClaudeDeployment('claude-opus-5'), 'Opus 5');
  assert.equal(describeClaudeDeployment('claude-opus-4-6-2'), 'Opus 4.6');
  assert.equal(describeClaudeDeployment('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(describeClaudeDeployment('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(describeClaudeDeployment('team-opus'), null);
});

test('falls back to showing the raw deployment when its name has no version', () => {
  const env = { ANTHROPIC_DEFAULT_OPUS_MODEL: 'team-opus' } as NodeJS.ProcessEnv;

  assert.equal(labelFor(env, 'opus'), 'Opus \u00b7 team-opus');
});

test('leaves labels untouched when no deployment override is set', () => {
  const env = {} as NodeJS.ProcessEnv;

  assert.equal(labelFor(env, 'opus'), 'Opus');
  assert.equal(labelFor(env, 'haiku'), 'Haiku');
  assert.equal(labelFor(env, 'best'), 'Best available');
});

test('keeps model values and effort choices intact while relabelling', () => {
  const env = { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]' } as NodeJS.ProcessEnv;
  const annotated = annotateClaudeModelLabels(CLAUDE_PREDEFINED_MODELS, env);

  assert.deepEqual(
    annotated.OPTIONS.map((option) => option.value),
    CLAUDE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value),
  );
  assert.equal(annotated.DEFAULT, CLAUDE_PREDEFINED_MODELS.DEFAULT);
  assert.deepEqual(
    annotated.OPTIONS.find((option) => option.value === 'opus[1m]')?.effort,
    CLAUDE_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === 'opus[1m]')?.effort,
  );
});
