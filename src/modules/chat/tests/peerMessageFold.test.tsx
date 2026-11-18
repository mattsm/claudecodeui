import assert from 'node:assert/strict';

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { test } from 'vitest';

import '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { isOwnPromptMessage } from '@/modules/chat/hooks/useOwnMessageJump';
import { parsePeerMessage, splitUserTurn } from '@/modules/chat/utils/peerMessages';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage } from '@/shared/types';

const CROSS_SESSION = [
  '<cross-session-message from="uds:/run/user/1000/cc-socks/2067104.sock" from-name="wireless lab: release" from-mode="prompting">',
  'From "wireless lab: release": the serving-lab promote has ended.',
  'Slot b serves 33e12d52.',
  '</cross-session-message>',
].join('\n');

test('a message another chat sent is recognised in each shape it arrives in', () => {
  assert.equal(
    parsePeerMessage(`Another Claude session sent a message:\n${CROSS_SESSION}`)?.preview,
    'From "wireless lab: release": the serving-lab promote has ended.',
  );
  assert.equal(
    parsePeerMessage(CROSS_SESSION)?.preview,
    'From "wireless lab: release": the serving-lab promote has ended.',
  );
  assert.equal(
    parsePeerMessage('<cross-session-message from-name="map UI">\n</cross-session-message>')?.preview,
    'From "map UI"',
  );
  assert.equal(
    parsePeerMessage('Another Claude session sent a message:\nplease rebase')?.preview,
    'please rebase',
  );
});

test('a nudge is recognised by the sender it opens with', () => {
  const nudges = [
    'From the wireless lab master (not Matt): main is fast-forwarded to 665fe7b.',
    'From the wireless lab master, 17:00Z. I told Matt your push was declined.',
    'From mesh lab master: the cutover is done.',
    'From "wireless lab: UI kit". Whole suite on my stack: 176 of 177.',
    'From the merge queue: #353 is on main.',
    'From tests (full stack), 17:00Z: new heads for #478.',
    'From RF profiles: #590 is on branch rf-design-level-2.',
    'From map UI, for the merge queue: #733 is ready.',
    'From the width-check agent, 09:10Z. Step 2 is done.',
    'From Matt via the MASTER chat: free the bench A3.',
    'From git-ee (lab + labd), on the client lane: started.',
    'From your fork, \'Qemu ppe ipq53xx - (fork)\' [7d661b], on Matt\'s ask: here to help.',
    'From the MASTER chat (Matt approved this on 2026-10-29): your last turn was stopped.',
    'Matt\'s instruction, relayed by the MASTER chat: fold every PR into one series.',
    'MASTER to merge queue, 21:09Z: list-760 landed.',
    'NEWEST NOTE (16:50Z), from the wireless lab master (not Matt): ignore the walk request.',
    'tick: check the queue',
    'Overnight tick 03:00Z (automated timer, not Matt): continue.',
  ];

  for (const nudge of nudges) {
    assert.ok(parsePeerMessage(`${nudge}\n\nMore detail below.`), nudge);
  }
});

test('a message the user typed is left alone', () => {
  const typed = [
    'can you check the lab',
    'from the logs it looks like the AP rebooted',
    'ask the master chat what it thinks',
    'From what I can tell this is broken',
    'From what I can tell, this is broken',
    'From the logs: the AP rebooted.',
    'From my testing, the fix holds',
    'Please ask the MASTER chat to review this.',
    'pull it from the master branch',
    'Whats keeping the fans on',
    '<task-notification>\n<task-id>a1</task-id>',
  ];

  for (const text of typed) {
    assert.equal(parsePeerMessage(text), null, text);
  }
});

test('a long first line is cut for the preview', () => {
  const preview = parsePeerMessage(`From the wireless lab master: ${'x'.repeat(400)}`)?.preview ?? '';
  assert.equal(preview.length, 141);
  assert.ok(preview.endsWith('…'));
});

const userMessage = (content: string): ChatMessage => ({
  type: 'user',
  content,
  timestamp: '2026-11-16T12:00:00.000Z',
});

const renderMessage = (message: ChatMessage) => render(
  <UiPreferencesProvider>
    <MessageComponent message={message} prevMessage={null} createDiff={() => []} provider="claude" />
  </UiPreferencesProvider>,
);

test('a message from another chat is folded until its toggle is clicked', () => {
  renderMessage(userMessage('From the wireless lab master: main moved.\n\nRebase onto 665fe7b today.'));

  const toggle = screen.getByTestId('peer-message-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(toggle.textContent?.includes('From the wireless lab master: main moved.'));
  assert.equal(screen.queryByText('Rebase onto 665fe7b today.') === null, true);

  fireEvent.click(toggle);
  assert.equal(screen.getByTestId('peer-message-toggle').getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByText('Rebase onto 665fe7b today.'));

  fireEvent.click(screen.getByTestId('peer-message-toggle'));
  assert.equal(screen.queryByText('Rebase onto 665fe7b today.') === null, true);
});

test('a message the user typed has no toggle', () => {
  renderMessage(userMessage('can you check the lab'));

  assert.equal(screen.queryByTestId('peer-message-toggle') === null, true);
  assert.ok(screen.getByText('can you check the lab'));
});

test('a message from another chat does not count as one of the user\'s own', () => {
  assert.equal(isOwnPromptMessage(userMessage('can you check the lab')), true);
  assert.equal(isOwnPromptMessage(userMessage('From the wireless lab master: main moved.')), false);
  assert.equal(isOwnPromptMessage(userMessage(`Another Claude session sent a message:\n${CROSS_SESSION}`)), false);
});

const NUDGE = 'From the merge queue: list-1052 PASSED its far run.\n\nNothing is needed from you.';
const OWN = 'what was my last message ? about running on my mbp ?';
const MERGED = `${NUDGE}\n\n---\n\n${OWN}`;

test('a turn the server joined is split into the other chat\'s part and the user\'s own', () => {
  const turn = splitUserTurn(MERGED);
  assert.deepEqual(turn.peerParts.map((part) => part.preview), ['From the merge queue: list-1052 PASSED its far run.']);
  assert.equal(turn.peerParts[0].text, NUDGE);
  assert.equal(turn.ownText, OWN);

  // The user's text first, two notes, and a second message of the user's own.
  const busy = splitUserTurn(`first of mine\n\n---\n\n${NUDGE}\n\n---\n\ntick: check the queue\n\n---\n\nsecond of mine`);
  assert.equal(busy.peerParts.length, 2);
  assert.equal(busy.ownText, 'first of mine\n\n---\n\nsecond of mine');

  // Nothing from another chat: the turn is left exactly as typed, rules and all.
  assert.deepEqual(splitUserTurn('one\n\n---\n\ntwo'), { peerParts: [], ownText: 'one\n\n---\n\ntwo' });
  assert.equal(splitUserTurn(NUDGE).ownText, '');
});

test('the user\'s own queued text stays on screen when it was joined onto a note from another chat', () => {
  renderMessage(userMessage(MERGED));

  // What the user typed is in the bubble without a click.
  assert.ok(screen.getByText(OWN));
  const toggle = screen.getByTestId('peer-message-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(toggle.textContent?.includes('From the merge queue: list-1052 PASSED its far run.'));
  assert.equal(screen.queryByText('Nothing is needed from you.') === null, true);

  fireEvent.click(toggle);
  assert.ok(screen.getByText('Nothing is needed from you.'));
  assert.ok(screen.getByText(OWN));
});

test('a joined turn with the user\'s text in it counts as one of the user\'s own messages', () => {
  assert.equal(isOwnPromptMessage(userMessage(MERGED)), true);
  assert.equal(isOwnPromptMessage(userMessage(`${NUDGE}\n\n---\n\ntick: check the queue`)), false);
});
