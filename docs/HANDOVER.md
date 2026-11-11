# Sprint Sentinel — Handover: finish and submit Codegeist 2026

Audience: the teammate who completes the project. No prior Forge knowledge assumed.
Deadline: **Tuesday 22 December 2026, 12:00 PM PST** (Devpost). Aim to submit by 18 December.
Repository: https://github.com/madhavzanwar/Codegeist (branch `main`).

## 0. Where the project stands

**Done (in the repository, tested):**
- Forge app source: risk engine, Rovo agent, 2 Rovo skills, 10 actions, MCP module, Jira dashboard, Jira issue panel, Confluence page, daily snapshot, Teamwork Graph integration, demo-data seeder.
- Quality gates: lint, typecheck, 88 unit tests (97% line coverage), Forge client-side lint, all clean (`docs/QA.md`).
- Documents: `README.md`, `SUBMISSION.md` (all Devpost text), `docs/DEMO_SCRIPT.md`, `docs/MARKETPLACE.md`, `skills/skill.md`, `CREDITS.md`, `docs/PRIVACY.md`.

**Not done (needs a human with an Atlassian login):**
1. Register, deploy and install the app on an Atlassian site.
2. Test everything live and fix anything `forge logs` reports.
3. Generate the installation link for judges.
4. Take live screenshots and record the demo video (under 5 minutes, public on YouTube).
5. Submit the Marketplace variant and get the review-ticket link.
6. Fill in and submit the Devpost form.

Time budget: about 1 day of work plus waiting for Marketplace (do step 13 early).

## 1. Repository housekeeping (2 minutes)

The old branch `claude/youthful-pasteur-fs3z7n` is still the GitHub default branch, so it could not be deleted automatically.

1. Open https://github.com/madhavzanwar/Codegeist/settings (Settings tab of the repository).
2. Under **General → Default branch**, click the switch icon, choose `main`, click **Update**, confirm.
3. Open https://github.com/madhavzanwar/Codegeist/branches and click the trash icon next to `claude/youthful-pasteur-fs3z7n`.
4. Make the repository **Public** (Settings → General → Danger Zone → Change visibility) before submitting, so judges can read the code and `skill.md`.

## 2. Accounts you need

| Account | Where | Notes |
|---|---|---|
| Atlassian account | https://id.atlassian.com/signup | Use the same e-mail for everything below. |
| Atlassian API token | https://id.atlassian.com/manage-profile/security/api-tokens | "Create API token", name it `forge-cli`, copy it once. Never commit it. |
| Atlassian developer site | created by `forge site provision` (step 5) or https://go.atlassian.com/cloud-dev | Free. Demo sites include Jira, Confluence and Rovo. |
| GitHub | https://github.com | Access to the repository. |
| Devpost | https://codegeist2026.devpost.com → **Join hackathon** | Must be registered to submit. |
| YouTube | https://studio.youtube.com | For the public demo video. |
| Marketplace partner | https://marketplace.atlassian.com/manage/vendors/create | Only for the Marketplace bonus prize. |

## 3. Install the tools on your computer

Works on macOS, Linux and Windows (use PowerShell or WSL on Windows).

1. Install **Node.js 22 LTS** from https://nodejs.org (check: `node -v` prints v22.x).
2. Install **Git** from https://git-scm.com (check: `git --version`).
3. Install the **Forge CLI**:

```bash
npm install -g @forge/cli@latest
```

4. Check it:

```bash
forge --version
```

5. Log in (paste your e-mail, then the API token from section 2 when asked):

```bash
forge login
```

6. Turn off analytics prompts (optional):

```bash
forge settings set usage-analytics false
```

## 4. Get the code and verify it

```bash
git clone https://github.com/madhavzanwar/Codegeist.git
```

```bash
cd Codegeist
```

```bash
npm ci && npm --prefix static/app ci
```

```bash
npm run check
```

Expected: ESLint prints nothing, typecheck prints nothing, Vitest prints `Tests 88 passed` and a coverage table.

```bash
npm run forge:lint
```

Expected: `Forge client-side lint: 0 error(s), 0 warning(s)`.

## 5. Get an Atlassian site with Jira, Confluence and Rovo

Recommended (includes Rovo):

```bash
forge site provision
```

Follow the prompts. Note the site URL it prints, for example `your-name-demo.atlassian.net`. Below this is written as `SITE`.

Alternative: create a site at https://go.atlassian.com/cloud-dev, then add Confluence via https://admin.atlassian.com → Products → Add product. Check Rovo is on: admin.atlassian.com → Rovo (or Apps → AI settings). If Rovo is missing, use `forge site provision`.

## 6. Register, deploy and install the app

**Option A — one command (recommended).** macOS/Linux/WSL:

```bash
SITE=your-site.atlassian.net ./scripts/ship.sh
```

What it does: installs dependencies, runs lint, typecheck, tests and the UI build, runs `forge register` the first time (this writes your new app id into `manifest.yml`), runs `forge lint`, deploys to production and installs into Jira and Confluence.

**Option B — the same, step by step** (Windows PowerShell or if the script stops):

```bash
npm run build:ui
```

```bash
forge register "Sprint Sentinel" --accept-terms
```

```bash
forge lint
```

```bash
forge deploy -e production
```

```bash
forge install -e production -s your-site.atlassian.net -p Jira
```

```bash
forge install -e production -s your-site.atlassian.net -p Confluence
```

When `forge install` lists the scopes, accept them (you must be site and organization admin for the Teamwork Graph scopes — you are, on your own site).

**Then commit the app id** that `forge register` wrote into `manifest.yml`:

```bash
git add manifest.yml && git commit -m "chore: register Forge app id" && git push
```

**Updating later:** after any code change run `npm run build:ui && forge deploy -e production`. If you changed scopes in `manifest.yml`, also run `forge install -e production -s SITE -p Jira --upgrade` (and `-p Confluence --upgrade`).

**Seeing errors:**

```bash
forge logs -e production --since 15m
```

## 7. Load the demo data

1. Open `https://SITE/jira` → **Projects** → **Create project** → **Scrum** template → name `Sentinel Demo`, key `SEN` → Create.
2. In the project's left sidebar or top tabs, open **Sprint Sentinel**. (If not visible: Project settings → Apps, or wait 1–2 minutes after deploy and reload.)
3. Click **Load demo sprint data**. A progress bar runs for about one minute and the dashboard appears.
4. Do this at least **2 hours before recording**, then on the dashboard click **Settings** → set **Stale after (hours)** to `1` → **Save & re-analyse**. Stale signals need real elapsed time; the app never fakes timestamps.

Terminal alternative (needs an API token, creates the project for you):

```bash
JIRA_SITE=https://your-site.atlassian.net JIRA_EMAIL=you@example.com JIRA_API_TOKEN=paste-token npm run seed -- --project SEN --create-project
```

## 8. Test everything live (tick each box)

- [ ] **Dashboard** loads: health gauge, score breakdown, riskiest issues, findings tab, assignee load, trend, confidence.
- [ ] Expand the top issue: evidence shows issue keys, dates and counts.
- [ ] **Flag** on a risky issue → **Preview** → **Confirm and apply** → open the issue: flag set and a comment ending "posted via Sprint Sentinel after user confirmation".
- [ ] Repeat with **Label**, **Comment**, **Follow-up sub-task**.
- [ ] Click **Refresh**: the trend says "Since last run" with a change.
- [ ] Open issue `SEN-1` (or any issue in the sprint) → **Apps** (or the panel button) → **Sprint risk** shows the same score.
- [ ] **Publish report** → pick a Confluence space → Preview → Confirm → page opens with summary, tables and trend.
- [ ] Confluence → **Apps** → **Sprint Sentinel** page shows `SEN`.
- [ ] Rovo agent works (section 9).
- [ ] MCP works (section 10).
- [ ] `forge logs -e production --since 30m` shows no errors.

If something fails, see section 16 (troubleshooting) and the AI-assistant prompts in section 17.

## 9. Rovo agent — where and what to type

Open it either with the **Ask Sentinel** button on the dashboard, or in Jira/Confluence click **Rovo** (or **Chat**) in the top bar → **Agents** / browse agents → **Sprint Sentinel**.

Prompts to use (in this order for the demo):
1. `Is the SEN sprint on track?`
2. `What are the top 5 delivery risks and the evidence for each?`
3. `Why is SEN-10 risky?` (replace with the top issue key from the dashboard)
4. `Who on the team is overloaded? Include Teamwork Graph context.`
5. `Flag SEN-6 as an impediment and ask the owner for an ETA.` → the agent shows a **preview** and asks to confirm → reply `yes`.
6. `Add the label sentinel-dependency to SEN-1.` → preview → `yes`.
7. `Create a follow-up sub-task to define acceptance criteria for SEN-3.` → preview → `yes`.
8. `Publish a Sprint Risk Report for SEN to the <SPACEKEY> space.` → preview → `yes`.
9. `How has the risk changed since the last run?`

Expected behaviour: every claim cites issue keys/dates; it states a confidence level; it never writes without your "yes". If it writes without a preview, that is a bug — report it with the transcript.

## 10. MCP tools — connect an external AI client

**10.1 Enable exposure (site admin, once):**
1. Open https://admin.atlassian.com → select your organization.
2. **Apps** → **Sites** → your site → **Connected apps**.
3. Click **Sprint Sentinel** → open app details → turn on the MCP tools (all 10).

**10.2 Find your app id:** in `manifest.yml`, `app.id` looks like `ari:cloud:ecosystem::app/1234abcd-....`. The UUID after `app/` is `APP_ID`. Your MCP URL is:

```text
https://mcp.atlassian.com/forge/APP_ID
```

**10.3 Connect a client (pick one):**

Claude Code (terminal):

```bash
claude mcp add --transport http sprint-sentinel https://mcp.atlassian.com/forge/APP_ID
```

Claude Desktop / claude.ai: Settings → **Connectors** → **Add custom connector** → name `Sprint Sentinel`, URL as above → Connect → complete the Atlassian consent screen (choose your site, approve).

Cursor: create or edit `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "sprint-sentinel": { "url": "https://mcp.atlassian.com/forge/APP_ID" } } }
```

**10.4 Give the client the skill:** paste the contents of `skills/skill.md` into the project instructions (Claude project knowledge, Cursor rules, or `CLAUDE.md`).

**10.5 Prompts to test:**
1. `Using the sprint-sentinel tools, list the sprints in project SEN.`
2. `Analyse the SEN sprint and tell me the riskiest issue and why, with evidence.`
3. `Label that issue sentinel-at-risk.` → it must show a preview and wait → reply `yes`.

Also check Rovo Studio: Rovo → **Studio** → Create agent → Tools → the Sprint Sentinel tools are listed.

## 11. Generate the installation link (for judges)

1. Open https://developer.atlassian.com/console/myapps/ → click **Sprint Sentinel**.
2. Left menu **Distribution** → **Distribution controls** → **Edit**.
3. Choose **Sharing** (not "within organization" — judges are outside your org).
4. Fill app details: name `Sprint Sentinel`, vendor (your name/team), privacy policy URL `https://github.com/madhavzanwar/Codegeist/blob/main/docs/PRIVACY.md`, support URL `https://github.com/madhavzanwar/Codegeist/issues`. Save.
5. Select products **Jira** and **Confluence**.
6. Copy the **Installation link**.
7. Paste it into `SUBMISSION.md` replacing `<PASTE INSTALLATION LINK HERE>`, and replace `<APP_ID>` everywhere (`SUBMISSION.md`, `README.md`, `skills/skill.md`):

```bash
grep -rn "APP_ID\|PASTE INSTALLATION" --include=*.md .
```

8. Test the link in a private browser window logged into a **second** Atlassian site if you have one.
9. Commit and push:

```bash
git commit -am "docs: add installation link and app id" && git push
```

Important: do **not** add `licensing` to this app or submit *this* app to Marketplace — that disables installation links. Marketplace uses a separate registration (section 13).

## 12. Screenshots for Devpost

Take them on the live site after seeding (browser width about 1440 px, light theme; one dark-mode shot is a plus). Save in `docs/screenshots/live/`. List:
1. Jira dashboard (full).
2. Top issue expanded with evidence.
3. Confirmation modal with the preview.
4. The issue after the action (flag + comment).
5. Issue panel.
6. Rovo chat: analysis answer.
7. Rovo chat: preview → "yes" → done.
8. Published Confluence report.
9. Claude/Cursor using the MCP tools.
10. Assignee load with Teamwork Graph teams.
11. Confluence Sprint Sentinel page.

Tools: macOS Cmd+Shift+4; Windows Win+Shift+S; or the GoFullPage Chrome extension for full pages.

## 13. Marketplace submission (start early; review takes days)

Follow `docs/MARKETPLACE.md`. Short version:

```bash
git switch -c marketplace
```

```bash
forge register "Sprint Sentinel for Jira" --accept-terms
```

Add to `manifest.yml` under `app:` (paid listing, required because the app supports Jira + Confluence):

```yaml
  licensing:
    enabled: true
```

```bash
npm run build:ui && forge deploy -e production
```

```bash
git commit -am "chore: Marketplace variant" && git push -u origin marketplace
```

Then:
1. Create a partner profile: https://marketplace.atlassian.com/manage/vendors/create (for paid apps also fill payment/tax details).
2. Create the listing: https://marketplace.atlassian.com/manage/apps/create → Forge app → *Sprint Sentinel for Jira* → production.
3. Paste listing copy from `docs/MARKETPLACE.md` (name, tagline, summary, highlights, description, keywords). Logo: export `static/app/public/sentinel.svg` to 144×144 PNG (e.g. https://svgtopng.com). Screenshots from section 12.
4. Submit for approval. Copy the review-ticket or listing URL into `SUBMISSION.md` (replace `<PASTE MARKETPLACE REVIEW TICKET / LISTING LINK>`).

## 14. Record and upload the demo video

1. Read `docs/DEMO_SCRIPT.md` (9 shots, about 3:40). Rehearse once.
2. Before recording: data seeded at least 2 hours earlier, stale threshold 1 h, dashboard opened once earlier (so the trend has a previous run), Confluence space exists, MCP client connected, browser notifications off, bookmarks bar hidden.
3. Record with OBS Studio (https://obsproject.com, free), Loom, or the macOS screen recorder (Cmd+Shift+5). 1080p. Record voice-over live or afterwards. No copyrighted music.
4. Trim (any editor: iMovie, Clipchamp, DaVinci Resolve). Keep it **under 5:00**.
5. Upload at https://studio.youtube.com → **Create** → **Upload videos**.
   - Title: `Sprint Sentinel — explainable delivery risk for Jira (Codegeist 2026)`
   - Description: paste the tagline from `SUBMISSION.md`, then the repository URL and "Built with Atlassian Forge, Rovo, MCP and Teamwork Graph."
   - Audience: "No, it's not made for kids".
   - Visibility: **Public**. Add English subtitles (auto-captions then fix).
6. Copy the YouTube link into `SUBMISSION.md` (replace `<YOUTUBE LINK>`), commit and push.

## 15. Fill in the Devpost form

Go to https://codegeist2026.devpost.com → **Enter a submission** (or My projects → Edit). Copy each field from `SUBMISSION.md`:

| Devpost field | Paste from |
|---|---|
| Project name | `SUBMISSION.md` → Title (`Sprint Sentinel — explainable delivery risk for Jira, powered by Rovo`) |
| Elevator pitch / tagline | `SUBMISSION.md` → Tagline |
| Thumbnail / image gallery | Section 12 screenshots (dashboard first) |
| About the project (story) | `SUBMISSION.md` → "About the project" (Inspiration … What's next), keep the headings |
| Built with | `SUBMISSION.md` → Built with (enter as tags) |
| Try it out links | GitHub repository URL + installation link |
| Video demo link | YouTube URL |
| Category | **Apps for Software Teams** |
| Bonus prizes | Tick **Best Agents**, **Best app with Atlassian MCP**, **Best apps with Teamwork Graph integration**, **Best Marketplace published app** |
| Installation link / access | Installation link + paste "Judge test instructions" from `SUBMISSION.md` |
| How it meets the requirement | `SUBMISSION.md` → "How it meets the main technology requirement" |
| Bonus-prize materials | MCP: link to `skills/skill.md` on GitHub and the MCP URL; Marketplace: review-ticket link; Teamwork Graph: one sentence from the bonus table |
| Team members | Invite teammates from the project page |

Click **Save draft**, re-read everything, then **Submit**. You can edit until the deadline.

## 16. Troubleshooting

| Symptom | Fix |
|---|---|
| `Not logged in` / `UserNotFoundError` | Run `forge login` again with a fresh API token. |
| `forge register` asks for a Developer Space | Choose your personal space, or add `--personal`. |
| Deploy error "resource path does not exist" | Run `npm run build:ui` first (creates `static/app/build`). |
| Deploy rejects the `rovo:skill` or `rovo:mcp` module | Update the CLI: `npm i -g @forge/cli@latest`; these are Preview modules. |
| Install fails on Teamwork Graph scopes | You must be **organization admin**. Use your own developer/demo site. |
| "Sprint Sentinel" tab not visible | Wait 2 minutes after deploy and reload; check Jira → Apps → Manage apps. |
| Dashboard says "no Scrum board" | Project must use the **Scrum** template (Kanban has no sprints). |
| Seeder: "already has an active sprint" | Use a new Scrum project; complete the existing sprint first. |
| Dashboard shows "Teamwork Graph: no data returned" | Admin → Connected apps → Sprint Sentinel → Permissions: enable graph scopes; wait 1 minute. Also needs teams (https://home.atlassian.com → Teams) to show team names. |
| "Confluence is not reachable" on publish | Install into Confluence: `forge install -e production -s SITE -p Confluence`. |
| Rovo agent not listed | Rovo must be enabled on the site; reload; agent name is "Sprint Sentinel". |
| MCP client cannot connect | Exposure not enabled (section 10.1), wrong APP_ID, or the client's OAuth window was blocked by a popup blocker. |
| Action returns "Arguments changed after the preview" | The agent changed text between preview and confirm; ask again — a new preview is issued. |
| Any other error | `forge logs -e production --since 30m` and use the prompts in section 17. |

## 17. Prompts for an AI coding assistant (Claude Code, Cursor)

Open the repository in your assistant and paste the prompt that fits.

**Fix a runtime error:**

```text
This is a Forge app (see README.md and docs/RESEARCH.md). Here is the output of `forge logs -e production --since 30m`:
<paste logs>
Find the root cause, fix it with the smallest change, add or update a unit test in test/, and run `npm run check` and `npm run forge:lint`. Do not change the confirmation-token protocol in src/ops.ts.
```

**Fix a deploy or lint failure:**

```text
`forge deploy -e production` (or `forge lint`) failed with:
<paste output>
Read the current Forge docs for the module involved, fix manifest.yml or the code, and re-run `npm run forge:lint`. Explain what changed.
```

**Polish the UI after looking at it live:**

```text
Here is a screenshot of the Sprint Sentinel dashboard on a real Jira site: <attach>. Improve spacing/alignment issues you see in static/app/src (keep Atlassian design tokens, keep light and dark mode), run `npm run typecheck`, `npm run build:ui`, and `npm run screenshots`.
```

**Tighten the Devpost text:**

```text
Read SUBMISSION.md and docs/DEMO_SCRIPT.md. Rewrite the "About the project" section to be punchier for judges (criteria: technical implementation, design, impact, innovation, presentation — 20% each) without inventing features. Keep every claim true to the code.
```

## 18. Final checklist before pressing Submit

- [ ] `main` is the default branch; old branch deleted; repository public.
- [ ] App deployed to **production** and installed; live checklist (section 8) all ticked.
- [ ] Installation link works and is in `SUBMISSION.md` and on Devpost.
- [ ] `APP_ID` placeholders replaced in `SUBMISSION.md`, `README.md`, `skills/skill.md`.
- [ ] Video public on YouTube, under 5 minutes, English, link on Devpost.
- [ ] Marketplace review ticket or listing link on Devpost.
- [ ] Category = Apps for Software Teams; four bonus prizes ticked.
- [ ] Screenshots uploaded; README screenshot list updated if desired.
- [ ] Final `npm run check` passes on `main`; everything pushed.
- [ ] Submitted before **22 Dec 2026, 12:00 PM PST**.

## 19. Map of the repository

| Path | What it is |
|---|---|
| `manifest.yml` | Forge modules, scopes, app id |
| `src/core/` | Pure risk engine (signals, graph, scoring, trend, report, confirmation) |
| `src/jira/`, `src/confluence/`, `src/twg/` | API access (Jira, Confluence, Teamwork Graph) |
| `src/service.ts`, `src/ops.ts` | Analysis pipeline; confirmed write operations |
| `src/actions/`, `src/resolvers/`, `src/index.ts` | Rovo/MCP action handlers, UI resolvers, Forge entry points |
| `src/seed/` | Demo dataset and seeder |
| `static/app/` | React Custom UI (dashboard, issue panel, Confluence page) |
| `skills/sprint-risk-*/SKILL.md` | Rovo skills bundled with the app |
| `skills/skill.md` | Open-source skill for external MCP clients |
| `resources/agent/prompt.md` | Rovo agent prompt |
| `scripts/` | `ship.sh`, `seed-demo.ts`, `forge-lint-offline.cjs`, `screenshots.mjs`, `make-handover-pdf.py` |
| `test/` | Vitest unit tests |
| `docs/` | QA, research, demo script, Marketplace guide, privacy, this handover |

## 20. Command cheat sheet

| Task | Command |
|---|---|
| Install dependencies | `npm ci && npm --prefix static/app ci` |
| All checks | `npm run check` |
| Forge lint offline / full | `npm run forge:lint` / `forge lint` |
| Build UI | `npm run build:ui` |
| Deploy | `forge deploy -e production` |
| Install / upgrade | `forge install -e production -s SITE -p Jira [--upgrade]` |
| Logs | `forge logs -e production --since 15m` |
| Seed from terminal | `JIRA_SITE=… JIRA_EMAIL=… JIRA_API_TOKEN=… npm run seed -- --project SEN --create-project` |
| UI preview without Jira | `npm --prefix static/app run dev` then open the printed localhost URL |
| Regenerate screenshots | `npm run screenshots` |
| Rebuild this PDF | `python3 scripts/make-handover-pdf.py` |
