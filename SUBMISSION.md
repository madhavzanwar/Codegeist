# Devpost submission — Codegeist 2026

## Title
**Sprint Sentinel — explainable delivery risk for Jira, powered by Rovo**

## Tagline (≤ 200 chars)
A Rovo agent, MCP server and Jira dashboard that finds sprint delivery risk early, shows the evidence behind every point, and acts only after you confirm.

## Installation link
`<PASTE INSTALLATION LINK HERE>` — generated in the Developer console → Sprint Sentinel → Distribution → **Sharing**
(products: Jira + Confluence) after `scripts/ship.sh` deploys to production. See "Judge test instructions".

MCP endpoint: `https://mcp.atlassian.com/forge/<APP_ID>` (APP_ID = UUID in `manifest.yml` after `forge register`).
Source: <https://github.com/madhavzanwar/codegeist> · Demo video: `<YOUTUBE LINK>`

## Category and bonus prizes
| Select | Why it qualifies |
|---|---|
| **Category: Apps for Software Teams** | Delivery-risk triage for Scrum teams: blockers, dependencies, overload, scope creep — "issue triage that actually understands what matters". |
| **Best Agents – Rovo/Assignable agents** | `rovo:agent` (Sprint Sentinel) + **2 reusable `rovo:skill` modules** (`sprint-risk-triage`, `sprint-risk-remediation`) + **10 `action` modules** other agents can invoke; write actions use a server-enforced confirmation protocol. |
| **Best app with Atlassian MCP** | `rovo:mcp` module exposes all 10 actions as MCP tools (Rovo Studio + external clients via `mcp.atlassian.com/forge/<appId>`), plus an **open-source `skills/skill.md`** for Claude/Cursor/any MCP agent. |
| **Best apps with Teamwork Graph integration** | Consumes the Teamwork Graph API (`requestTeamworkGraph`, curated queries `atlassianUserInTeams` and `atlassianUserAssignedJiraWorkItems`) to add teams and cross-project open work to the overload analysis; degrades honestly when scopes aren't granted. |
| **Best Marketplace published app** | Marketplace variant submitted per `docs/MARKETPLACE.md`; review ticket: `<PASTE MARKETPLACE REVIEW TICKET / LISTING LINK>`. |

## How it meets the main technology requirement
A Forge app (`manifest.yml`, Node 22 runtime) integrating **Jira** (project page, issue panel, REST + Agile APIs),
**Confluence** (global page, v2 pages API — optional product via app compatibility), **Rovo** (agent, skills, actions,
MCP) and **Teamwork Graph** (curated GraphQL queries). Runs on Atlassian — no egress.

---

## About the project

### Inspiration
Every engineering manager knows the feeling: the board looks green on Monday and the sprint is lost by Wednesday. The
reasons were all in Jira — a dependency on another team's ticket, one person quietly holding half the points, a
"quick" ticket added mid-sprint, a question in a comment nobody answered — but scattered across links, changelogs,
comments and dates. Generic AI summaries don't fix this, because you can't trust a summary that doesn't show its
work. We wanted a copilot that reasons like a seasoned delivery lead **and shows the receipts**.

### What it does
Sprint Sentinel analyses a Jira sprint and produces:
- **11 explainable risk signals** — blocked work (links and the Flagged field), blocker chains, keystone blockers,
  circular dependencies, stale in-progress work, overdue and due-soon-not-started work, missing acceptance criteria,
  unanswered questions in comments, scope creep since sprint start (from the Sprint changelog), overloaded and
  unassigned work.
- **A 0–100 risk score per issue and per sprint** (plus health = 100 − risk) with a transparent breakdown, and a
  **confidence level with reasons**. If Jira has no data, it says so — it never invents a score.
- **Teamwork Graph context**: which teams each assignee is in, and how much unresolved work they carry *outside* this
  sprint — hidden load that a single-project view can't see.
- **Safe actions**: comment, label, flag, create a follow-up sub-task, and publish a **Sprint Risk Report** to
  Confluence with a table and a **trend vs. the last run**. Every write goes through a preview and a single-use
  confirmation token that the server binds to the user, the operation and the exact arguments.
- It's available as a **Rovo agent** (with two reusable skills), as **MCP tools** for Claude, Cursor and Rovo
  Studio, in a **Jira dashboard** and **issue panel**, and on a **Confluence portfolio page**. A daily scheduled
  snapshot builds the trend.

### How we built it
- **Forge** with Custom UI (React + hand-built SVG charts on Atlassian design tokens, light/dark), resolvers,
  10 `action` modules, `rovo:agent`, 2 `rovo:skill`s, `rovo:mcp`, `jira:projectPage`, `jira:issuePanel`,
  `confluence:globalPage`, `scheduledTrigger` and Forge KVS.
- A **pure TypeScript risk engine** (`src/core`) with injected time: signal detectors, a blocker graph with chain
  search and Tarjan cycle detection, scoring, confidence, trend and a Confluence storage-format report builder.
  88 Vitest tests, ~97% line coverage.
- Thin adapters for Jira (enhanced JQL search with `nextPageToken`, changelog, Agile boards/sprints), Confluence v2
  and Teamwork Graph, all behind a transport-agnostic requester with **retry on 429/5xx honouring Retry-After**.
- A **resumable demo seeder** that runs as the user from a button in the app (or from a CLI) and creates a realistic
  40-issue sprint with every risk pattern — including scope creep added after the sprint actually started.
- An offline runner for the Forge CLI's own client-side linters, so the manifest is validated in CI.

### Challenges we ran into
- **Making AI trustworthy.** We moved every judgement into deterministic code and gave the LLM only facts with
  evidence and a confidence level; the agent prompt and skills forbid unsupported claims.
- **Confirmation that can't be skipped.** Prompt instructions aren't a guarantee, so writes require a server-issued,
  single-use token bound to user + operation + argument hash — the same protocol protects Rovo, MCP clients and the UI.
- **Scope creep needs history, not state.** We reconstruct when each issue entered the sprint from the changelog and
  compare it to the sprint's activation time, falling back (with lower confidence) to creation dates.
- **Link direction ambiguity.** Jira's issue-link API is easy to get backwards; the seeder verifies the first link it
  creates and self-corrects.
- **Teamwork Graph scopes fail closed** (empty, not error), so we report "Teamwork Graph unavailable" rather than
  silently under-counting load.

### Accomplishments that we're proud of
- Every number on screen can be traced to issue keys, dates and counts.
- One engine, five surfaces: Rovo agent, reusable skills, MCP tools, Jira UI and Confluence reports.
- A one-click demo that works on a brand-new site with no API tokens.

### What we learned
- Rovo skills are the right place for task playbooks; the agent prompt stays small and focused on guardrails.
- `rovo:mcp` turns Forge actions into tools for any MCP client almost for free — so the guardrails must live server-side.
- Teamwork Graph curated queries are a fast way to bring cross-product context into an app.

### What's next
- Capacity from calendars/time off and historical velocity.
- Rovo automation: post a risk digest to Slack/Teams/Confluence every morning.
- Forecast "probability to finish" with Monte Carlo on historical cycle times.
- Write risk signals back into Teamwork Graph so other agents can use them.

## Built with
`atlassian-forge` · `rovo` · `rovo-agent` · `rovo-skills` · `mcp` · `teamwork-graph` · `jira` · `jira-software` ·
`confluence` · `custom-ui` · `typescript` · `react` · `vite` · `node.js` · `vitest` · `zod` · `forge-kvs` · `graphql`

---

## Judge test instructions
**Requirements:** an Atlassian Cloud site where you are a site **and organization** admin (free developer sites
qualify) with Jira; add Confluence for reports; Rovo for the agent (included in Atlassian Cloud Premium/Enterprise
and developer/demo sites).

1. Open the **installation link** above → choose your site → install into **Jira**. When prompted (or later in
   *Admin → Apps → Connected apps → Sprint Sentinel*), also connect **Confluence**. Approve the scopes, including the
   Teamwork Graph scopes.
2. In Jira, create a project with the **Scrum** template (e.g. key `SEN`). Open the project's **Sprint Sentinel** tab
   and click **🧪 Load demo sprint data** (≈ 1 minute). The dashboard appears with the seeded sprint.
3. Explore: expand the top risk to see evidence; switch to *Findings*; hover assignee load.
4. **Action with confirmation:** on any risky issue click **Flag** → **Preview** → **Confirm and apply**. Open the issue
   to see the flag and the comment. Refresh the dashboard to see the score and trend change.
5. Open any issue in the sprint → **Apps → Sprint risk** for the issue panel.
6. **Rovo agent:** click **✨ Ask Sentinel** (or Rovo Chat → Agents → *Sprint Sentinel*). Ask "Is the SEN sprint on
   track?", then "Flag SEN-6 and ask the owner for an ETA" → the agent shows a preview → reply "yes".
7. **Confluence report:** click **📄 Publish report**, pick a space → Preview → Confirm → open the page.
8. **MCP (optional):** *admin.atlassian.com → Apps → Sites → your site → Connected apps → Sprint Sentinel* → enable the
   tools. Then `claude mcp add --transport http sprint-sentinel https://mcp.atlassian.com/forge/<APP_ID>` (or add the
   URL to Cursor) and load `skills/skill.md`. Ask "What's the riskiest issue in SEN?".
9. **Confluence portfolio:** Confluence → Apps → *Sprint Sentinel*.

Tips: *Settings → Stale after* can be lowered to 1 hour to see stale signals on freshly seeded data (staleness needs
real elapsed time — the app never fakes timestamps). Rerunning the seeder in the same project is blocked to avoid
duplicates; use a new Scrum project.

---

## Final self-review against the official rules (re-read 11 Nov 2026)
| Rule | Status |
|---|---|
| Built on Forge, integrates ≥ 1 Atlassian product/capability | ✅ Jira, Confluence, Rovo, Teamwork Graph (`manifest.yml`) |
| New project created during the submission period | ✅ repository history starts 11 Nov 2026 |
| Original work; third-party material authorised | ✅ see `CREDITS.md` (MIT/Apache/Atlassian licences only) |
| Installation link for judges ("Start sharing your app") | ⏳ generate after production deploy (Developer console → Distribution → Sharing) |
| Instructions for all configuration steps | ✅ "Judge test instructions" above |
| Demo video < 5 min, public on YouTube, no unlicensed music/trademarks | ⏳ record from `docs/DEMO_SCRIPT.md` |
| Category + bonus prizes identified, bonus materials provided | ✅ table above; MCP `skills/skill.md`; Marketplace link ⏳ |
| English | ✅ |
| Marketplace prize: listing or review-ticket link | ⏳ follow `docs/MARKETPLACE.md` (separate app registration, because Marketplace-submitted apps can't use installation links) |
