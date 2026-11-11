/**
 * Demo dataset: a realistic "Checkout v2" sprint for a small product team.
 * It deliberately contains every risk pattern Sprint Sentinel detects:
 * blockers and a 3-hop blocker chain, a keystone blocker, an issue blocked from outside the sprint,
 * overloaded assignees, scope creep after sprint start, missing acceptance criteria,
 * unanswered questions, overdue and due-soon work, unassigned work and a flagged impediment.
 */

export type SeedType = 'Story' | 'Task' | 'Bug';
export type SeedStatus = 'todo' | 'progress' | 'done';
export type SeedPhase = 'committed' | 'creep' | 'backlog';

export interface SeedIssue {
  ref: string;
  summary: string;
  type: SeedType;
  points?: number;
  /** Index into the list of assignable users (wraps around); null = unassigned. */
  assignee: number | null;
  status: SeedStatus;
  phase: SeedPhase;
  description: string;
  /** Due date relative to the seed day, in days (negative = overdue). */
  dueInDays?: number;
  flagged?: boolean;
  comments?: string[];
  subtasks?: string[];
}

const AC = (lines: string[]) => `\n\nAcceptance criteria:\n${lines.map((l) => `- ${l}`).join('\n')}`;

export const SEED_LABEL = 'sentinel-demo';
export const SEED_SPRINT_NAME = 'Sentinel Demo — Checkout v2';
export const SEED_SPRINT_GOAL = 'Ship Checkout v2 to 10% of EU customers';

export const SEED_ISSUES: SeedIssue[] = [
  // --- Payments backbone (blocker chain: CHK-API → TOKEN → WALLET → APPLEPAY) ---
  { ref: 'api', summary: 'Payments API v2: idempotent charge endpoint', type: 'Story', points: 8, assignee: 0, status: 'progress', phase: 'committed',
    description: 'Charges must be idempotent so retries never double-charge.' + AC(['Same idempotency key returns the original charge', 'p95 latency < 300 ms', 'Contract tests published']),
    comments: ['Draft OpenAPI spec is up for review.', 'Do we keep the v1 webhook payload shape or move to the new envelope?'] },
  { ref: 'token', summary: 'Card tokenisation service integration', type: 'Story', points: 5, assignee: 0, status: 'todo', phase: 'committed',
    description: 'Integrate the PSP tokenisation SDK behind our payments API.' + AC(['Raw PANs never touch our servers', 'Token refresh handled']) },
  { ref: 'wallet', summary: 'Saved payment methods (wallet) UI', type: 'Story', points: 5, assignee: 1, status: 'todo', phase: 'committed',
    description: 'Let returning customers pick a saved card.' },
  { ref: 'applepay', summary: 'Apple Pay button on checkout', type: 'Story', points: 3, assignee: 1, status: 'todo', phase: 'committed',
    description: 'Show Apple Pay when the device supports it.' + AC(['Button hidden on unsupported browsers', 'Successful payment lands on confirmation page']), dueInDays: 1 },
  { ref: 'gpay', summary: 'Google Pay button on checkout', type: 'Story', points: 3, assignee: 2, status: 'todo', phase: 'committed',
    description: 'Show Google Pay when available.' + AC(['Button follows brand guidelines', 'Fallback to card form on error']) },
  { ref: 'webhooks', summary: 'Payment webhooks consumer (charge.succeeded / failed)', type: 'Task', points: 5, assignee: 0, status: 'progress', phase: 'committed',
    description: 'Consume PSP webhooks and update order state.' + AC(['Signature verified', 'Retries are idempotent']), flagged: true,
    comments: ['Blocked: PSP sandbox webhooks are not being delivered to staging.'] },

  // --- Checkout flow ---
  { ref: 'address', summary: 'Address autocomplete on shipping step', type: 'Story', points: 3, assignee: 2, status: 'done', phase: 'committed',
    description: 'Use the places API to autocomplete addresses.' + AC(['Works for EU postcodes', 'Manual entry still possible']) },
  { ref: 'summary', summary: 'Order summary sidebar redesign', type: 'Story', points: 3, assignee: 3, status: 'done', phase: 'committed',
    description: 'New sidebar per Figma.' + AC(['Matches design', 'Sticky on desktop']) },
  { ref: 'promo', summary: 'Promo code field with live validation', type: 'Story', points: 3, assignee: 3, status: 'progress', phase: 'committed',
    description: 'Validate promo codes as the user types.', comments: ['Should expired codes show a specific error or the generic one?'] },
  { ref: 'tax', summary: 'VAT calculation for EU shipping countries', type: 'Story', points: 8, assignee: 0, status: 'todo', phase: 'committed',
    description: 'Calculate VAT per destination country.' + AC(['Rates sourced from tax service', 'Rounded per line item']), dueInDays: -3 },
  { ref: 'guest', summary: 'Guest checkout without account', type: 'Story', points: 5, assignee: 1, status: 'progress', phase: 'committed',
    description: 'Allow purchases without creating an account.' + AC(['Email required', 'Optional account creation after purchase']) },
  { ref: 'confirm', summary: 'Order confirmation email template', type: 'Task', points: 2, assignee: 3, status: 'done', phase: 'committed',
    description: 'New transactional template.' + AC(['Renders in Gmail and Outlook']) },
  { ref: 'a11y', summary: 'Checkout accessibility audit fixes (WCAG 2.2 AA)', type: 'Task', points: 3, assignee: 2, status: 'todo', phase: 'committed',
    description: 'Fix issues from the accessibility audit.', dueInDays: -1 },
  { ref: 'analytics', summary: 'Checkout funnel analytics events', type: 'Task', points: 2, assignee: 3, status: 'todo', phase: 'committed',
    description: 'Emit step_viewed / step_completed events.' + AC(['Events visible in the analytics dashboard']),
    comments: ['Which analytics schema version should these events use?'] },
  { ref: 'flags', summary: 'Feature flag for 10% EU rollout', type: 'Task', points: 1, assignee: 0, status: 'done', phase: 'committed',
    description: 'Configure the rollout flag.' + AC(['Flag defaults off', 'Targeting by country']) },
  { ref: 'perf', summary: 'Reduce checkout bundle size by 20%', type: 'Task', points: 5, assignee: 1, status: 'todo', phase: 'committed',
    description: 'Split vendor chunks and lazy-load payment SDKs.' },
  { ref: 'i18n', summary: 'Translate checkout into DE, FR, ES', type: 'Task', points: 3, assignee: null, status: 'todo', phase: 'committed',
    description: 'Send strings to the translation vendor.' + AC(['All strings externalised', 'Pseudo-locale test passes']) },
  { ref: 'fraud', summary: 'Fraud score check before capture', type: 'Story', points: 5, assignee: 0, status: 'todo', phase: 'committed',
    description: 'Call the fraud service and hold risky orders.' },
  { ref: 'receipt', summary: 'Downloadable PDF receipt', type: 'Story', points: 3, assignee: 2, status: 'todo', phase: 'committed',
    description: 'Customers can download a VAT receipt.' + AC(['Includes VAT breakdown', 'Available from order page']) },
  { ref: 'retry', summary: 'Graceful retry when card is declined', type: 'Story', points: 3, assignee: 3, status: 'progress', phase: 'committed',
    description: 'Keep form state and show a helpful decline message.' + AC(['Form state kept', 'Decline reason mapped to friendly copy']) },
  { ref: 'e2e', summary: 'End-to-end tests for the happy path', type: 'Task', points: 3, assignee: 1, status: 'todo', phase: 'committed',
    description: 'Playwright suite covering cart → payment → confirmation.' + AC(['Runs in CI under 5 minutes']) },
  { ref: 'docs', summary: 'Runbook for payment incidents', type: 'Task', points: 1, assignee: 3, status: 'done', phase: 'committed',
    description: 'On-call runbook.' + AC(['Linked from the alert']) },

  { ref: 'sca', summary: '3-D Secure 2 challenge flow (SCA)', type: 'Story', points: 5, assignee: 0, status: 'todo', phase: 'committed',
    description: 'Handle PSD2 strong customer authentication challenges in an iframe.' },
  { ref: 'saved-cart', summary: 'Persist cart across devices for signed-in users', type: 'Story', points: 3, assignee: 2, status: 'progress', phase: 'committed',
    description: 'Sync cart to the profile service.' + AC(['Cart merges on login', 'Conflicts keep the newest quantity']) },
  { ref: 'monitor', summary: 'Checkout error-rate alerting', type: 'Task', points: 2, assignee: 3, status: 'todo', phase: 'committed',
    description: 'Alert when payment errors exceed 2% over 5 minutes.' + AC(['Alert routes to on-call', 'Runbook linked']) },

  // --- Bugs ---
  { ref: 'bug-total', summary: 'Cart total off by one cent with 3+ discounted items', type: 'Bug', points: 2, assignee: 2, status: 'progress', phase: 'committed',
    description: 'Rounding error in discount distribution.' },
  { ref: 'bug-safari', summary: 'Safari: payment iframe does not resize', type: 'Bug', points: 1, assignee: 1, status: 'todo', phase: 'committed',
    description: 'iframe height stuck at 150px on Safari 18.', comments: ['Can someone with a Mac confirm this on Safari 18.1?'] },
  { ref: 'bug-double', summary: 'Double submit creates two orders on slow networks', type: 'Bug', points: 3, assignee: 0, status: 'todo', phase: 'committed',
    description: 'Disable submit while the request is in flight.' },
  { ref: 'bug-done', summary: 'Shipping step loses selected country on back', type: 'Bug', points: 1, assignee: 3, status: 'done', phase: 'committed',
    description: 'Fixed by persisting state.' },

  // --- Scope creep: added after the sprint started ---
  { ref: 'creep-klarna', summary: 'Add Klarna pay-later option', type: 'Story', points: 8, assignee: 0, status: 'todo', phase: 'creep',
    description: 'Sales asked for Klarna before launch.' },
  { ref: 'creep-banner', summary: 'Black Friday banner on checkout', type: 'Task', points: 2, assignee: 2, status: 'progress', phase: 'creep',
    description: 'Marketing banner.' + AC(['Dismissible', 'Hidden after Nov 30']) },
  { ref: 'creep-gift', summary: 'Gift message field', type: 'Story', points: 3, assignee: 1, status: 'todo', phase: 'creep',
    description: 'Optional gift note on the order.' },
  { ref: 'creep-bug', summary: 'Hotfix: promo banner overlaps pay button on mobile', type: 'Bug', points: 1, assignee: 3, status: 'done', phase: 'creep',
    description: 'CSS z-index fix.' },
  { ref: 'creep-audit', summary: 'PCI evidence collection for auditor', type: 'Task', points: 3, assignee: 0, status: 'todo', phase: 'creep',
    description: 'Auditor needs screenshots and config exports.', dueInDays: 2 },

  // --- Outside the sprint (backlog) but blocking sprint work ---
  { ref: 'ext-psp', summary: 'PSP contract: enable webhook delivery to staging', type: 'Task', assignee: null, status: 'todo', phase: 'backlog',
    description: 'Vendor ticket raised; waiting for PSP support.' },
  { ref: 'ext-tax', summary: 'Tax service: expose EU VAT rates endpoint', type: 'Task', assignee: 2, status: 'progress', phase: 'backlog',
    description: 'Platform team dependency.' },
];

/** [blocker, blocked] pairs using refs. */
export const SEED_LINKS: Array<[string, string]> = [
  ['api', 'token'],
  ['token', 'wallet'],
  ['wallet', 'applepay'],
  ['api', 'webhooks'],
  ['api', 'fraud'],
  ['ext-psp', 'webhooks'],
  ['ext-tax', 'tax'],
  ['tax', 'receipt'],
  ['guest', 'e2e'],
  ['sca', 'applepay'],
];

export const SEED_SUBTASKS: Array<{ parent: string; summary: string; status: SeedStatus }> = [
  { parent: 'api', summary: 'Write idempotency key middleware', status: 'done' },
  { parent: 'api', summary: 'Publish contract tests', status: 'todo' },
  { parent: 'guest', summary: 'Email capture form', status: 'progress' },
  { parent: 'tax', summary: 'Map shipping country to VAT rate', status: 'todo' },
];

export function dueDate(seedDay: Date, offsetDays: number): string {
  const d = new Date(seedDay.getTime() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}
