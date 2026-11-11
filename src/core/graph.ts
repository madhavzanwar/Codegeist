import type { IssueRecord, StatusCategory } from './types';

/**
 * Dependency-graph analysis over "blocks" links.
 * Edges point from blocker -> blocked. Only unresolved blockers create risk.
 */

export interface BlockerGraph {
  /** blocker key -> keys it blocks */
  blocks: Map<string, Set<string>>;
  /** blocked key -> keys blocking it */
  blockedBy: Map<string, Set<string>>;
  status: Map<string, StatusCategory>;
  inSprint: Set<string>;
}

function add(map: Map<string, Set<string>>, from: string, to: string): void {
  let set = map.get(from);
  if (!set) {
    set = new Set();
    map.set(from, set);
  }
  set.add(to);
}

export function buildBlockerGraph(issues: IssueRecord[]): BlockerGraph {
  const g: BlockerGraph = { blocks: new Map(), blockedBy: new Map(), status: new Map(), inSprint: new Set() };
  for (const issue of issues) {
    g.inSprint.add(issue.key);
    g.status.set(issue.key, issue.statusCategory);
  }
  for (const issue of issues) {
    for (const link of issue.links) {
      if (!g.status.has(link.key)) g.status.set(link.key, link.statusCategory);
      if (link.relation === 'blockedBy') {
        add(g.blocks, link.key, issue.key);
        add(g.blockedBy, issue.key, link.key);
      } else {
        add(g.blocks, issue.key, link.key);
        add(g.blockedBy, link.key, issue.key);
      }
    }
  }
  return g;
}

export function isOpen(g: BlockerGraph, key: string): boolean {
  return g.status.get(key) !== 'done';
}

/** Unresolved blockers of `key`. */
export function openBlockers(g: BlockerGraph, key: string): string[] {
  return [...(g.blockedBy.get(key) ?? [])].filter((k) => isOpen(g, k)).sort();
}

/** Unresolved issues that `key` blocks. */
export function openDependents(g: BlockerGraph, key: string): string[] {
  return [...(g.blocks.get(key) ?? [])].filter((k) => isOpen(g, k)).sort();
}

/**
 * Longest chain of unresolved blockers ending at `key` (inclusive), e.g. [A, B, key] for A blocks B blocks key.
 * Cycles are cut (handled separately by findCycles).
 */
export function longestUpstreamChain(g: BlockerGraph, key: string, maxDepth = 12): string[] {
  const memo = new Map<string, string[]>();
  const visit = (k: string, stack: Set<string>, depth: number): string[] => {
    const cached = memo.get(k);
    if (cached) return cached;
    if (depth > maxDepth) return [k];
    let best: string[] = [];
    stack.add(k);
    for (const b of openBlockers(g, k)) {
      if (stack.has(b)) continue; // cycle edge
      const chain = visit(b, stack, depth + 1);
      if (chain.length > best.length || (chain.length === best.length && chain.join() < best.join())) best = chain;
    }
    stack.delete(k);
    const result = [...best, k];
    memo.set(k, result);
    return result;
  };
  return visit(key, new Set(), 0);
}

/** Maximal blocker chains (length >= 3 nodes, i.e. >= 2 hops) that end at an open sprint issue. */
export function findChains(g: BlockerGraph): string[][] {
  const chains: string[][] = [];
  for (const key of [...g.inSprint].sort()) {
    if (!isOpen(g, key)) continue;
    const chain = longestUpstreamChain(g, key);
    if (chain.length >= 3) chains.push(chain);
  }
  // Keep only maximal chains: drop any chain that is a prefix of a longer one.
  const serialized = chains.map((c) => c.join('>'));
  return chains.filter((c, i) => {
    const s = serialized[i] as string;
    return !serialized.some((other, j) => j !== i && other.length > s.length && other.startsWith(`${s}>`));
  });
}

/** Strongly connected components with more than one node among open issues (Tarjan). */
export function findCycles(g: BlockerGraph): string[][] {
  const nodes = [...g.status.keys()].filter((k) => isOpen(g, k)).sort();
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of openDependents(g, v)) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, idx.get(w) as number));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) result.push(comp.sort());
    }
  };
  for (const n of nodes) if (!idx.has(n)) strong(n);
  return result;
}
