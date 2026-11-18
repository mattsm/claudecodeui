/**
 * Messages another chat sent into this one. They arrive as user turns in three
 * shapes:
 * - the CLI's peer delivery, "Another Claude session sent a message:" followed
 *   by a `<cross-session-message from-name="...">` block;
 * - the same block alone, when Claude read it at a tool-call boundary;
 * - a message queued by `~/bin/cloudcli-nudge.mjs`, which is plain text that
 *   by convention opens by naming its sender ("From the wireless lab master:").
 */
export type PeerMessage = {
  /** One line to show while the message is folded. */
  preview: string;
};

const PEER_INTRO = 'Another Claude session sent a message:';
const CROSS_SESSION_OPEN = /^<cross-session-message\b([^>]*)>\s*/;
const CROSS_SESSION_CLOSE = /\s*<\/cross-session-message>\s*$/;

/** Tested against the first line only. */
const NUDGE_OPENERS = [
  /^From "[^"]+"/,
  /^From (?:the |your )?[^,:.]{0,60}\b(?:master|chat|queue|lead|fork|agent)\b/i,
  // "From tests (full stack), 17:00Z:" and "From git-ee (lab + labd):". A sender
  // is a name, so "From the logs: ..." and "From what I saw, ..." stay typed text.
  /^From (?!(?:the|a|an|my|our|your|this|that|these|those|what|where|when|which|here|there|now|then)\b)[^,:.]{1,50}[:,]/i,
  /^MASTER to /,
  /^.{0,60}\b(?:from|by|via) the MASTER chat\b/,
  /^tick: /,
  /^Overnight tick /,
  /^NEWEST NOTE\b.{0,30}\bfrom /,
];

const PREVIEW_LENGTH = 140;

const firstLine = (text: string) => text.trimStart().split('\n', 1)[0].trim();

const toPreview = (text: string, fallback: string) => {
  const line = firstLine(text) || fallback;
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH)}…` : line;
};

/** Returns the fold's preview when a user turn came from another chat, or null for a message the user typed. */
export function parsePeerMessage(content: string): PeerMessage | null {
  let text = content.trimStart();
  const hasIntro = text.startsWith(PEER_INTRO);
  if (hasIntro) {
    text = text.slice(PEER_INTRO.length).trimStart();
  }

  const open = CROSS_SESSION_OPEN.exec(text);
  if (open) {
    const senderName = /\bfrom-name="([^"]*)"/.exec(open[1])?.[1];
    const body = text.slice(open[0].length).replace(CROSS_SESSION_CLOSE, '');
    return { preview: toPreview(body, senderName ? `From "${senderName}"` : PEER_INTRO) };
  }
  if (hasIntro) {
    return { preview: toPreview(text, PEER_INTRO) };
  }

  const line = firstLine(text);
  return NUDGE_OPENERS.some((opener) => opener.test(line)) ? { preview: toPreview(line, line) } : null;
}

/**
 * What the server puts between queued messages it joined into one turn
 * (`QUEUED_MESSAGE_SEPARATOR` in server/modules/database/repositories/session-drafts.db.ts).
 */
export const QUEUED_MESSAGE_SEPARATOR = '\n\n---\n\n';
const QUEUED_MESSAGE_BOUNDARY = /\n[ \t]*\n---[ \t]*\n[ \t]*\n/;

export type PeerMessagePart = PeerMessage & {
  /** The part's whole text, shown when its fold is opened. */
  text: string;
};

/**
 * A user turn split into the parts other chats sent and the user's own text.
 *
 * A chat has one queued turn, so a message the user queues while a note from
 * another chat is waiting is joined onto that note. Folding the turn as a
 * whole would hide what the user typed; only the parts that came from another
 * chat fold.
 */
export function splitUserTurn(content: string): { peerParts: PeerMessagePart[]; ownText: string } {
  const peerParts: PeerMessagePart[] = [];
  const ownParts: string[] = [];
  for (const part of content.split(QUEUED_MESSAGE_BOUNDARY)) {
    const peer = parsePeerMessage(part);
    if (peer) {
      peerParts.push({ ...peer, text: part.trim() });
    } else if (part.trim()) {
      ownParts.push(part.trim());
    }
  }
  return { peerParts, ownText: peerParts.length > 0 ? ownParts.join(QUEUED_MESSAGE_SEPARATOR) : content };
}
