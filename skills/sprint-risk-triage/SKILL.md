---
name: sprint-risk-triage
description: Analyse delivery risk in a Jira Scrum sprint — blocked work, blocker chains, stale and overdue issues, overloaded assignees, scope creep, missing acceptance criteria and unanswered questions — and explain each finding with evidence, a 0–100 risk score and a confidence level.
allowed-tools: analyze-sprint-risk explain-issue-risk get-assignee-load list-sprints get-risk-trend
license: MIT
metadata:
  author: Sprint Sentinel
  version: "1.0.0"
---
# Sprint risk triage

Use this skill when a user asks whether a sprint is on track, what is at risk, why an issue is risky, who is overloaded, or how risk has changed.

## Steps
1. **Pick the scope.**
   - If the user names a sprint or you need to choose one, call `list-sprints` with `projectKey` and pick by name/state. Otherwise skip it — `analyze-sprint-risk` defaults to the active sprint.
   - If you have no project key (and none is in the Jira context), ask once for it.
2. **Analyse.** Call `analyze-sprint-risk` with `projectKey` (and `sprintId` if chosen).
   - `status: "no_data"` → tell the user exactly what `message` says and list `availableSprints` if present. Stop.
   - `status: "needs_input"` → ask the question in `message`. Stop.
3. **Report** using the agent output format. For every finding cite `evidence` values (issue keys, dates, counts). Report `confidence.level` with the top one or two `confidence.reasons`.
4. **Drill down on request.**
   - "Why is ABC-12 risky?" → `explain-issue-risk` with `issueKey`. If `found` is false, relay `message` — do not speculate.
   - "Who is overloaded?" → `get-assignee-load`. Mention `teams` and `openWorkElsewhere` only when present (they come from Atlassian Teamwork Graph).
   - "Is it getting better?" → `get-risk-trend`; report `direction`, `riskDelta`, `newAtRisk`, `noLongerAtRisk`. If `hasPrevious` is false, say this is the first recorded run.
5. **Offer next steps** from `suggestedActions` — as offers, never as completed work. Hand over to the `sprint-risk-remediation` skill if the user accepts.

## Interpreting scores
- Issue and sprint risk: 0–29 low, 30–59 medium, 60–79 high, 80–100 critical. Health = 100 − risk.
- Sprint risk = 40% effort-weighted issue risk + 25% burn-down gap + 15% scope creep + 20% blocked work. Use `scoreBreakdown` to explain which component dominates.
- A stale signal requires real elapsed time without updates (threshold configurable per project, default 72 h).

## Edge cases
- Empty sprint → there is no score; say so.
- Missing story points → load and burn-down fall back to issue counts; mention it if it appears in confidence reasons.
- Teamwork Graph unavailable → `teamworkGraph.used` is false; say load analysis covers this sprint only.
