# Demo video script — Sprint Sentinel (target 3:40, hard limit < 5:00)

**Setup before recording**
- Fresh Scrum project `SEN` seeded ≥ 2 hours earlier (dashboard → *Load demo sprint data*), then *Settings → Stale
  after = 1 h* so stale signals are real. Run the dashboard once early (creates the first snapshot for the trend).
- Confluence space `ENG` exists; the app is connected to Confluence.
- External MCP exposure enabled for the app; Claude Desktop/Code (or Cursor) configured with
  `https://mcp.atlassian.com/forge/<APP_ID>` and `skills/skill.md` loaded.
- Browser at 1440×900, zoom 110%, light theme; hide bookmarks; notifications off. Royalty-free or no music.
- Voice-over in English; captions on YouTube.

| # | Time | Shot (screen) | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:12 | **Hook.** Jira board looks fine — lots of green. Zoom to the sprint name. | "This sprint looks fine. It isn't. Three things are already going to make it slip — and nobody's noticed." |
| 2 | 0:12–0:35 | **Problem.** Quick cuts: a blocker link to another team's ticket, a question buried in a comment, a ticket added yesterday. | "Delivery risk hides in links, changelogs, comments and dates. Stand-ups find it late, and AI summaries you can't verify don't help. Meet Sprint Sentinel — a delivery-risk copilot built on Forge and Rovo." |
| 3 | 0:35–1:15 | **Dashboard.** Open *SEN → Sprint Sentinel*. Pan: health gauge, score breakdown, riskiest issues. Expand the top issue → evidence. Hover assignee load → Teamwork Graph teams + "work elsewhere". | "Health 34 out of 100. Every point is explained: issue risk, burn-down gap, scope creep and blocked work. The VAT story scores 97 — it's blocked by a platform-team ticket outside the sprint, three days overdue, and owned by Maya, who Teamwork Graph shows is carrying 14 more open items in other projects. Confidence is high, and the app says why." |
| 4 | 1:15–1:55 | **Live agent run.** Click *✨ Ask Sentinel* → Rovo Chat opens with the prompt. Agent answers: verdict line, top risks with keys and dates, overloaded people, trend, offered actions. | "The same engine powers a Rovo agent. It cites issue keys, dates and counts for every claim — and if Jira has no data, it says so instead of guessing." |
| 5 | 1:55–2:30 | **Action with confirmation.** Type "Flag SEN-6 and ask the PSP owner for an ETA". Agent shows the **preview** and asks for confirmation. Say "yes". Agent: done. Cut to the issue: flag + comment with Sentinel footer. | "Writes are always two-phase. The server issues a single-use token bound to me, this action and these exact arguments — so neither the model nor an MCP client can skip my approval." |
| 6 | 2:30–2:55 | **Confluence report.** In the dashboard click *Publish report* → choose ENG → preview → confirm → open the page: summary, score breakdown, top-risk table, findings, load, **trend vs last run** (▼ after the flag). | "One click publishes a Sprint Risk Report for stakeholders — with the trend against the last run." |
| 7 | 2:55–3:20 | **MCP from an external client.** Claude Desktop: "Using sprint-sentinel, what's the riskiest issue in SEN and why?" → tool call `analyze-sprint-risk` → answer. Then "label it sentinel-dependency" → preview → confirm. | "Everything is also an MCP server via Atlassian's rovo:mcp, plus an open-source skill.md, so Claude, Cursor or any MCP client gets the same tools — and the same guardrails." |
| 8 | 3:20–3:35 | **Impact.** Split screen: issue panel on the keystone blocker + Confluence portfolio page. | "For scrum masters and engineering managers, that's the morning risk review done in a minute — with receipts." |
| 9 | 3:35–3:45 | **Close.** Logo + "Sprint Sentinel — explainable delivery risk for Jira. Built on Forge, Rovo, MCP and Teamwork Graph." | "Sprint Sentinel. See risk early. Act safely." |

**B-roll / backup:** if Rovo is slow, cut to the pre-recorded agent answer; if MCP OAuth prompts appear, trim them.
**Checks before upload:** < 5:00, public on YouTube, English captions, no third-party logos/music without permission,
title "Sprint Sentinel — Codegeist 2026".
