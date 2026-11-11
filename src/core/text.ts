import type { CommentRecord } from './types';

const AC_PATTERNS: RegExp[] = [
  /acceptance\s+criteri(a|on)/i,
  /definition\s+of\s+done/i,
  /\bAC\s*[:#-]/,
  /\bgiven\b[\s\S]{0,200}?\bwhen\b[\s\S]{0,200}?\bthen\b/i,
  /\bdone\s+when\b/i,
];

/** Heuristic: does the description define acceptance criteria? */
export function hasAcceptanceCriteria(description: string, hasChecklist: boolean): boolean {
  if (hasChecklist) return true;
  return AC_PATTERNS.some((p) => p.test(description));
}

/** Issue types for which acceptance criteria are expected. */
export function expectsAcceptanceCriteria(issueType: string, isSubtask: boolean): boolean {
  if (isSubtask) return false;
  const t = issueType.toLowerCase();
  return ['story', 'user story', 'task', 'feature', 'improvement', 'new feature'].includes(t);
}

/** True if the text contains a genuine question (a sentence ending in "?"), ignoring URLs and code. */
export function containsQuestion(text: string): boolean {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`[^`]*`/g, ' ');
  return /[A-Za-z][^.!?\n]{2,}\?(\s|$)/.test(cleaned);
}

export interface UnansweredQuestion {
  comment: CommentRecord;
  /** Excerpt of the question for evidence. */
  excerpt: string;
}

/**
 * The most recent question in the comment thread that nobody else has replied to.
 * A question counts as answered when any later comment is written by a different author.
 */
export function findUnansweredQuestion(comments: CommentRecord[]): UnansweredQuestion | null {
  const sorted = [...comments].sort((a, b) => a.created.localeCompare(b.created));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i] as CommentRecord;
    if (!containsQuestion(c.text)) continue;
    const later = sorted.slice(i + 1);
    const answered = later.some((l) => (l.author?.accountId ?? 'unknown') !== (c.author?.accountId ?? 'unknown'));
    if (answered) return null;
    return { comment: c, excerpt: excerpt(c.text) };
  }
  return null;
}

export function excerpt(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
