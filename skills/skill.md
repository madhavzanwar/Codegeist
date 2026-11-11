---
name: sprint-sentinel
description: Use the Sprint Sentinel MCP tools (Atlassian Forge, via mcp.atlassian.com) to find and explain delivery risk in a Jira Scrum sprint — blockers, blocker chains, stale and overdue work, overloaded people, scope creep, missing acceptance criteria, unanswered questions — and to take human-confirmed actions such as commenting, labelling, flagging, creating follow-up sub-tasks and publishing a Confluence Sprint Risk Report.
license: MIT
metadata:
  version: "1.0.0"
  homepage: "https://github.com/madhavzanwar/codegeist"
---
# Sprint Sentinel — skill for third-party MCP clients

This open-source skill teaches any MCP-capable agent (Claude, Claude Code, Cursor, VS Code, …) how to use the
Sprint Sentinel tools that the Forge app exposes through the Atlassian MCP server (`rovo:mcp` module).

## 1. Connect

1. A site admin installs Sprint Sentinel and enables external MCP exposure:
   **admin.atlassian.com → Apps → Sites → (your site) → Connected apps → Sprint Sentinel → turn on the tools**.
2. Add the remote MCP server to your client:

   ```json
   {
     "mcpServers": {
       "sprint-sentinel": { "type": "http", "url": "https://mcp.atlassian.com/forge/<APP_ID>" }
     }
   }
   ```

   `<APP_ID>` is the UUID after `ari:cloud:ecosystem::app/` in the app's `manifest.yml` (see `SUBMISSION.md`).
   Claude Code: `claude mcp add --transport http sprint-sentinel https://mcp.atlassian.com/forge/<APP_ID>`.
3. Complete the OAuth 2.1 consent screen (choose the site, review scopes and tools). Tools run with **your** Jira permissions.

## 2. Tools

| Tool | Kind | Inputs | Returns |
|---|---|---|---|
| `list-sprints` | read | `projectKey` | sprints with ids, state, dates, goal |
| `analyze-sprint-risk` | read | `projectKey`, `sprintId?` | risk 0–100, health, band, confidence + reasons, score breakdown, metrics, top findings with evidence and suggested actions, riskiest issues, trend |
| `explain-issue-risk` | read | `issueKey`, `sprintId?` | the issue's score, every signal with evidence, rank in sprint |
| `get-assignee-load` | read | `projectKey`, `sprintId?` | per-person open / in-progress / remaining / done points, overload reasons, Teamwork Graph teams and work elsewhere |
| `get-risk-trend` | read | `projectKey`, `sprintId?` | delta vs previous run, direction, issues newly (no longer) at risk, history |
| `add-risk-comment` | write | `issueKey`, `comment`, `confirmationToken?` | preview → done |
| `add-risk-label` | write | `issueKey`, `label?`, `confirmationToken?` | preview → done |
| `flag-issue` | write | `issueKey`, `reason?`, `confirmationToken?` | preview → done |
| `create-followup-subtask` | write | `parentKey`, `summary`, `description?`, `confirmationToken?` | preview → done (new key) |
| `publish-risk-report` | write | `projectKey`, `spaceKey`, `sprintId?`, `parentPageId?`, `confirmationToken?` | preview → done (page URL) |

## 3. Rules you must follow

1. **Never invent data.** Report only what tools return. Cite `evidence` (issue keys, dates, counts). If a tool returns
   `status: "no_data"` or `"needs_input"`, relay the `message` and ask for what is missing.
2. **Always state confidence** (`confidence.level` and the main `confidence.reasons`).
3. **Writes are two-phase and require the human.**
   - Call the write tool without `confirmationToken` → you get `status: "confirmation_required"`, a `preview`, the normalised `arguments` and a `confirmationToken` (single use, 15 min, bound to the user and the exact arguments). Nothing has been written.
   - Show the preview and ask the user to confirm. Do not continue in the same turn.
   - Only after an explicit "yes", call the same tool with the same `arguments` plus `confirmationToken`.
   - `status: "rejected"` → explain `message`; if the token expired or arguments changed, start a new preview.
4. Never batch-approve, never reuse tokens, never claim success without `status: "done"`.

## 4. Recipes

**"Is sprint X on track?"** → `list-sprints` (if a name was given) → `analyze-sprint-risk` → summarise:
verdict line (`risk`, `band`, `health`, `confidence`), top 3–5 findings with evidence, overloaded people, trend, up to 3 offered actions from `suggestedActions`.

**"Why is ABC-12 red?"** → `explain-issue-risk` → list signals (severity, message, evidence) and its rank.

**"Clean up the blockers"** → `analyze-sprint-risk` → for each `blocked` finding offer `flag-issue` and an ETA
`add-risk-comment` → preview each → wait for the user's confirmation per action.

**"Write it up for the stakeholders"** → `publish-risk-report` with the team's space key → preview → confirm → share the URL.

## 5. Scoring reference

- Issue and sprint risk: 0–29 low · 30–59 medium · 60–79 high · 80–100 critical. Health = 100 − risk.
- Sprint risk = 40% effort-weighted issue risk + 25% burn-down gap (time elapsed vs work done) + 15% scope creep (30% added = max) + 20% blocked work (40% of remaining effort = max).
- Signal points per issue: blocked 35 (+10 if the blocker is outside the sprint), blocker chain 8/hop (max 25), keystone 8 per waiting issue (max 24), circular dependency 30, stale 20–35, overdue 30–45, due-soon-not-started 15, missing AC 12–15, unanswered question 8–20, scope creep 10, overloaded owner 10, unassigned 8 — multiplied by 0.85–1.15 as the sprint progresses, capped at 100.
