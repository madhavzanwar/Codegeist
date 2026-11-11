/** Minimal Atlassian Document Format helpers (pure). */

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: AdfNode[];
}

export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

export function paragraph(text: string): AdfNode {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
}

/** Convert plain text (blank-line separated paragraphs, "- " bullets) to ADF. */
export function textToAdf(text: string): AdfDoc {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const content: AdfNode[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      content.push({
        type: 'bulletList',
        content: lines.map((l) => ({ type: 'listItem', content: [paragraph(l.replace(/^\s*[-*•]\s+/, ''))] })),
      });
    } else {
      content.push({ type: 'paragraph', content: lines.flatMap((l, i) => [...(i ? [{ type: 'hardBreak' }] : []), { type: 'text', text: l }]) });
    }
  }
  return { type: 'doc', version: 1, content: content.length ? content : [paragraph('')] };
}

/** Wrap a comment with a Sprint Sentinel attribution footer. */
export function sentinelComment(text: string): AdfDoc {
  const doc = textToAdf(text);
  doc.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: '— posted via Sprint Sentinel after user confirmation', marks: [{ type: 'em' }] }],
  });
  return doc;
}

/** Extract plain text from an ADF document (or pass through strings). */
export function adfToText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  const n = node as AdfNode;
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'mention') return String((n.attrs?.text as string | undefined) ?? '@user');
  const inner = (n.content ?? []).map(adfToText).join('');
  const blockTypes = ['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'tableRow', 'panel', 'rule'];
  return blockTypes.includes(n.type) ? `${inner}\n` : inner;
}

export function adfHasTaskList(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as AdfNode;
  if (n.type === 'taskList' || n.type === 'decisionList') return true;
  return (n.content ?? []).some(adfHasTaskList);
}
