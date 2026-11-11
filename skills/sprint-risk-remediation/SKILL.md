---
name: sprint-risk-remediation
description: Take safe, human-confirmed remediation actions on sprint risks — comment on an issue, add a risk label, flag an impediment, create a follow-up sub-task, or publish a Sprint Risk Report page to Confluence — using a two-phase preview and confirmation-token protocol.
allowed-tools: add-risk-comment add-risk-label flag-issue create-followup-subtask publish-risk-report
license: MIT
metadata:
  author: Sprint Sentinel
  version: "1.0.0"
---
# Sprint risk remediation (always confirmed)

Every tool in this skill is **two-phase**. The server refuses to write without a valid, single-use confirmation token bound to the same user, tool and arguments.

## Protocol
1. Call the tool **without** `confirmationToken`. Nothing is written. You receive `status: "confirmation_required"`, a `preview`, the normalised `arguments` and a `confirmationToken` (valid 15 minutes).
2. Show the `preview` to the user and ask for explicit confirmation.
3. If — and only if — the user confirms, call the **same tool** with the **same `arguments`** plus `confirmationToken`.
4. Report the result: on `status: "done"` relay `message` and any `details.url`. On `status: "rejected"` relay `message` and, if the token expired or arguments changed, offer a fresh preview.

Never call phase 2 in the same turn as phase 1. Never reuse a token. Never claim success without `status: "done"`.

## Tools
- `add-risk-comment` — `issueKey`, `comment`. Draft a short, specific comment that cites the evidence (e.g. "DEMO-6 has been blocked by DEMO-31 (outside the sprint) since sprint start — @owner, can we get an ETA?"). The comment is posted with a "posted via Sprint Sentinel after user confirmation" footer.
- `add-risk-label` — `issueKey`, optional `label` (default `sentinel-at-risk`; no spaces). Suggested labels: `sentinel-at-risk`, `sentinel-dependency`, `sentinel-scope-creep`.
- `flag-issue` — `issueKey`, optional `reason` (posted as a comment). Sets Jira's Flagged = Impediment.
- `create-followup-subtask` — `parentKey`, `summary`, optional `description`. Typical use: "Define acceptance criteria for DEMO-3".
- `publish-risk-report` — `projectKey`, `spaceKey` (Confluence space key; reused from the last report if omitted), optional `sprintId`, optional `parentPageId`. Creates a page with the score, breakdown, top-risk table, findings, assignee load, confidence and the trend vs the last run. Requires the app to be connected to Confluence on the site; if the tool says Confluence is not reachable, relay the admin instructions.
