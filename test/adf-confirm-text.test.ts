import { describe, expect, it } from 'vitest';
import { adfHasTaskList, adfToText, sentinelComment, textToAdf } from '../src/core/adf';
import { CONFIRMATION_TTL_MS, createPending, hashArgs, stableStringify, verifyPending } from '../src/core/confirm';
import { containsQuestion, excerpt, expectsAcceptanceCriteria, hasAcceptanceCriteria } from '../src/core/text';
import { elapsedFraction, formatAge, parseDate } from '../src/core/time';

describe('adf', () => {
  it('converts text with bullets and line breaks', () => {
    const doc = textToAdf('Hello\nworld\n\n- a\n- b');
    expect(doc.content[0]?.type).toBe('paragraph');
    expect(doc.content[0]?.content?.[1]?.type).toBe('hardBreak');
    expect(doc.content[1]?.type).toBe('bulletList');
    expect(textToAdf('').content).toHaveLength(1);
  });
  it('adds attribution footer', () => {
    const doc = sentinelComment('Ping');
    expect(adfToText(doc)).toContain('posted via Sprint Sentinel after user confirmation');
  });
  it('extracts text and task lists', () => {
    const doc = { type: 'doc', content: [
      { type: 'heading', content: [{ type: 'text', text: 'AC' }] },
      { type: 'paragraph', content: [{ type: 'mention', attrs: { text: '@bob' } }, { type: 'text', text: ' hi' }, { type: 'hardBreak' }] },
      { type: 'taskList', content: [{ type: 'taskItem', content: [{ type: 'text', text: 'one' }] }] },
    ] };
    expect(adfToText(doc)).toBe('AC\n@bob hi\n\none\n');
    expect(adfToText('plain')).toBe('plain');
    expect(adfToText(null)).toBe('');
    expect(adfToText(42)).toBe('');
    expect(adfHasTaskList(doc)).toBe(true);
    expect(adfHasTaskList({ type: 'doc', content: [] })).toBe(false);
    expect(adfHasTaskList(null)).toBe(false);
  });
});

describe('confirmation tokens', () => {
  const args = { issueKey: 'D-1', label: 'x' };
  const p = createPending('add-risk-label', args, 'acc', 'preview', 1000);
  it('is stable regardless of key order', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
    expect(stableStringify(undefined)).toBe('null');
  });
  it('verifies op, user, args and expiry', () => {
    expect(verifyPending(p, 'add-risk-label', { label: 'x', issueKey: 'D-1' }, 'acc', 2000)).toEqual({ ok: true });
    expect(verifyPending(undefined, 'add-risk-label', args, 'acc', 2000).ok).toBe(false);
    expect(verifyPending(p, 'add-risk-label', args, 'acc', 1000 + CONFIRMATION_TTL_MS + 1)).toMatchObject({ ok: false, reason: expect.stringContaining('expired') });
    expect(verifyPending(p, 'flag-issue', args, 'acc', 2000)).toMatchObject({ ok: false });
    expect(verifyPending(p, 'add-risk-label', args, 'other', 2000)).toMatchObject({ ok: false, reason: expect.stringContaining('different user') });
    expect(verifyPending(p, 'add-risk-label', { ...args, label: 'y' }, 'acc', 2000)).toMatchObject({ ok: false, reason: expect.stringContaining('changed') });
  });
});

describe('text heuristics', () => {
  it('detects questions but not URLs/code', () => {
    expect(containsQuestion('Can we ship Friday?')).toBe(true);
    expect(containsQuestion('see https://x.io/?a=1')).toBe(false);
    expect(containsQuestion('run `a?b`')).toBe(false);
    expect(containsQuestion('?')).toBe(false);
  });
  it('detects AC patterns', () => {
    expect(hasAcceptanceCriteria('Definition of Done: tests', false)).toBe(true);
    expect(hasAcceptanceCriteria('AC: works', false)).toBe(true);
    expect(hasAcceptanceCriteria('Done when the API returns 200', false)).toBe(true);
    expect(hasAcceptanceCriteria('nothing', false)).toBe(false);
    expect(expectsAcceptanceCriteria('Epic', false)).toBe(false);
    expect(expectsAcceptanceCriteria('Task', false)).toBe(true);
  });
  it('truncates excerpts', () => {
    expect(excerpt('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(excerpt('  a \n b ')).toBe('a b');
  });
});

describe('time', () => {
  it('parses and formats', () => {
    expect(parseDate('2026-11-20')?.toISOString()).toBe('2026-11-20T23:59:59.000Z');
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('bad')).toBeNull();
    expect(formatAge(0.2)).toBe('12 min');
    expect(formatAge(1)).toBe('1 hour');
    expect(formatAge(5)).toBe('5 hours');
    expect(formatAge(72)).toBe('3.0 days');
    expect(formatAge(24 * 12)).toBe('12 days');
    expect(elapsedFraction('2026-11-10T00:00:00Z', '2026-11-01T00:00:00Z', new Date())).toBeNull();
    expect(elapsedFraction('2026-11-10T00:00:00Z', '2026-11-20T00:00:00Z', new Date('2026-12-01T00:00:00Z'))).toBe(1);
  });
});
