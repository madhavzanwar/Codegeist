# Research notes (verified 11 Nov 2026)

All module names, manifest syntax and APIs below were checked against the live developer docs and the installed
Forge CLI (`@forge/cli` 15.1.0), not from memory.

## Hackathon (codegeist2026.devpost.com + /rules)
- Deadline **22 Dec 2026 12:00 PM PST**; judging 5 Jan – 3 Feb 2027.
- Must: Forge app + ≥1 Atlassian product/capability (Jira, Confluence, JSM, Bitbucket, Teamwork Graph, Rovo); original;
  public YouTube video < 5 min; English; **installation link** per "Start sharing your app"; instructions for judges.
- Categories: Apps for Software Teams / Business Teams / Specialized Industries → we pick **Software Teams**.
- Bonus prizes (6 × $1,500 each): **Best Agents** (`rovo:agent`, `rovo:agentConnector`, or reusable `rovo:skill`/`action`),
  **Best app with Atlassian MCP** (`rovo:mcp` + optional open-source skill.md), **Best Teamwork Graph integration**
  (push or consume TWG API), **Best Marketplace published app** (listing link or Marketplace review-ticket link).
- Judging (20% each): technological implementation, design, potential impact, innovation, presentation.

## Rovo modules
- `rovo:agent` (GA): `key`, `name` ≤ 30 chars, `description`, `icon` (`resource:<key>;<path>`), `prompt` (string or
  `resource:<key>;<path>`), `conversationStarters`, `actions`, `skills`, `followUpPrompt`.
- `rovo:skill` (Preview, Oct 2026): `key`, `source.dir` (must contain `SKILL.md`, frontmatter `name` = dir name,
  `description` 50–1024 chars, optional `allowed-tools` space-separated, must include every `dependencies.tools`),
  `dependencies.tools` = action keys from the same app. No executable scripts in Preview.
- `action`: `key`, `name`, `function`, `actionVerb` (GET/CREATE/UPDATE/DELETE/TRIGGER), `description`, `inputs`
  (`title`, `type` string|integer|number|boolean, `required`, `description`). Handler gets `(payload, context)`;
  payload includes inputs + `context.jira.{projectKey, issueKey, url}`; 5 MB data limit; return string/JSON.
  Automation-triggered agents never invoke non-GET actions.
- `rovo:mcp` (Preview, Oct 2026): `key`, `name` ≤ 30 chars, `tools` = up to 50 action keys; max one per app.
  External clients: `https://mcp.atlassian.com/forge/<appId UUID>`; admin must enable exposure per site in
  Admin → Apps → Sites → Connected apps; OAuth 2.1 consent; tools run as the invoking user.

## Teamwork Graph API (Preview)
- Available to Forge apps installed in Jira or Confluence: `api.asUser().requestTeamworkGraph(query, variables, operationName)`.
- New apps must use **curated queries** or persisted Cypher (raw `cypherQuery` unavailable). Curated fields used:
  `atlassianUserInTeams(userId)` → `AtlassianTeam.displayName`; `atlassianUserAssignedJiraWorkItems(userId)` →
  `JiraWorkItem.key/resolvedAt`. `first` ≤ 25; node is a union → inline fragments.
- Scopes per object type: `read:graph:user:atlassian`, `read:graph:team:atlassian`, `read:graph:issue:jira`.
  Missing scopes return **empty results, not errors** → we report "Teamwork Graph unavailable" honestly.
- Installing apps with TWG scopes requires **org admin**. Dev sites: the creator is org admin.

## Multi-product (Jira + Confluence)
- `app.compatibility: { jira: { required: true }, confluence: { required: false } }`. One installation id;
  install into Jira first, then connect Confluence. **Multi-app apps can only be listed on Marketplace as paid.**

## Distribution
- Deploy to **production**, Developer console → app → Distribution → Edit → **Sharing** → choose products → copy link.
- Apps with a license in the manifest or **submitted to Marketplace cannot be shared via installation link** → use a
  separate app registration for the Marketplace submission (see docs/MARKETPLACE.md).

## Other platform facts used
- UI: Custom UI chosen (full design control, SVG charts, dark mode via `view.theme.enable()`); inline styles need
  `permissions.content.styles: [unsafe-inline]`.
- `jira:projectPage`, `jira:issuePanel` (resource/resolver/title/icon), `confluence:globalPage` (route).
- `scheduledTrigger` intervals fiveMinute/hour/day/week; `function.timeoutSeconds` up to 900 for triggers.
- Function keys must be ≤ 23 characters (found via the CLI linter).
- KVS: `@forge/kvs` (`kvs.get/set/delete`), 240 KB per value → cached results capped at 200 KB.
- REST: enhanced JQL search `POST /rest/api/3/search/jql` with `nextPageToken`; Agile `board`/`sprint` endpoints;
  Confluence v2 `POST /wiki/api/v2/pages` (storage format).
- `forge lint` requires login; `scripts/forge-lint-offline.cjs` runs the CLI's own client-side linters offline.

## References studied (not copied)
- atlassian-labs/forge-inspired (Apache-2.0): `sprint-ready-agent` (write-after-confirm agent pattern),
  `team-pulse-board` (why a Jira module is needed to call Jira from Confluence).
- Teamwork Graph example apps (Onboarding Assistant) for the curated-query call shape.
