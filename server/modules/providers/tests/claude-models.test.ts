import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAUDE_PREDEFINED_MODELS,
  CLAUDE_ULTRACODE_EFFORT,
  annotateClaudeModelLabels,
  describeClaudeDeployment,
  extractClaudeEventModel,
  findClaudeModelOption,
} from '@/modules/providers/list/claude/claude-models.provider.js';

const SESSION_ID = 'session-1';

// Pinned versions as Claude Code's own model picker declares them: id, effort default,
// whether xhigh is offered. `null` marks a model with no effort control.
const PINNED_MODELS: ReadonlyArray<[id: string, defaultEffort: string | null, xhigh: boolean]> = [
  ['claude-fable-5-2', 'medium', true],
  ['claude-fable-5-1', 'high', true],
  ['claude-fable-5', 'high', true],
  ['claude-opus-5-5', 'medium', true],
  ['claude-opus-5', 'high', true],
  ['claude-opus-4-8', 'high', true],
  ['claude-opus-4-7', 'xhigh', true],
  ['claude-opus-4-6', 'high', false],
  ['claude-sonnet-5-5', 'medium', true],
  ['claude-sonnet-5', 'high', true],
  ['claude-sonnet-4-6', 'high', false],
  ['claude-haiku-5-5', 'medium', true],
  ['claude-haiku-4-5-20251001', null, false],
];

test('offers each pinned version with the effort levels and default Claude Code uses for it', () => {
  for (const [id, defaultEffort, xhigh] of PINNED_MODELS) {
    const option = findClaudeModelOption(id);
    assert.ok(option, `${id} is missing from the catalog`);

    if (defaultEffort === null) {
      assert.equal(option.effort, undefined, `${id} should have no effort control`);
      continue;
    }

    const levels = option.effort?.values.map((level) => level.value) ?? [];
    assert.equal(option.effort?.default, defaultEffort, `${id} default effort`);
    assert.ok(levels.includes(defaultEffort), `${id} default must be one of its levels`);
    assert.equal(levels.includes('xhigh'), xhigh, `${id} xhigh`);
  }
});

test('offers ultracode only on xhigh-capable pinned versions outside the Haiku family', () => {
  for (const [id, , xhigh] of PINNED_MODELS) {
    const levels = findClaudeModelOption(id)?.effort?.values.map((level) => level.value) ?? [];
    const expected = xhigh && !id.startsWith('claude-haiku-');
    assert.equal(levels.includes(CLAUDE_ULTRACODE_EFFORT), expected, `${id} ultracode`);
  }
});

test('keeps the aliases first, the default unchanged, and every model id unique', () => {
  const values = CLAUDE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value);

  // This deployment defaults to the Fable alias and has no `default` entry.
  assert.equal(CLAUDE_PREDEFINED_MODELS.DEFAULT, 'fable');
  assert.deepEqual(values.slice(0, 8), [
    'best', 'fable', 'sonnet', 'sonnet[1m]', 'opus', 'opus[1m]', 'haiku', 'opusplan',
  ]);
  assert.equal(new Set(values).size, values.length);
});

test('offers Haiku the effort levels Claude Code accepts for it, starting at its own default', () => {
  const haikuEffort = findClaudeModelOption('haiku')?.effort;
  const levels = haikuEffort?.values.map((level) => level.value);

  assert.deepEqual(levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  // The level Claude Code runs Haiku at when none is sent, so adding the control changes nothing by itself.
  assert.equal(haikuEffort?.default, 'medium');
  assert.equal(levels?.includes(CLAUDE_ULTRACODE_EFFORT), false);
});

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
