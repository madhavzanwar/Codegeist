# Marketplace submission guide (for the "Best Marketplace published app" prize)

The prize accepts a **listing link or the Marketplace review-ticket link**. Two platform rules shape the plan:

1. *Apps submitted for Marketplace listing (or with a `licensing` section) cannot be shared via installation link.*
   Judges need an installation link → keep the **judging app** as is, and submit a **second registration** of the same
   code for Marketplace.
2. *Multi-product (Jira + Confluence) Forge apps can only be listed as paid.* The Marketplace variant is therefore
   listed as a paid app with a free trial (or, if you prefer a free listing, drop the Confluence compatibility and the
   `publish-risk-report` action in the variant — everything else is Jira-only).

## Step 1 — Create the Marketplace variant (5 min)

```bash
git switch -c marketplace
```

```bash
forge register "Sprint Sentinel for Jira" --accept-terms
```

This writes a new `app.id` into `manifest.yml` on this branch. For a paid listing add licensing so Forge enforces it:

```yaml
app:
  licensing:
    enabled: true
```

and add `filter: { appIsLicensed: true }` to the `scheduledTrigger`. Then deploy:

```bash
npm run build:ui && forge deploy -e production --non-interactive
```

## Step 2 — Become a Marketplace partner
1. Go to <https://marketplace.atlassian.com/manage/vendors/create> and create a partner profile (name, contact email,
   support URL = repository issues page, privacy policy URL = `docs/PRIVACY.md` on GitHub).
2. For paid apps, complete the partner payment/tax details (Partner profile → Payment details).

## Step 3 — Create the listing
1. <https://marketplace.atlassian.com/manage/apps/create> → **Forge app** → select *Sprint Sentinel for Jira* (the
   app owned by your developer account) → production environment.
2. Fill in the listing using the copy below; upload `static/app/public/sentinel.svg` exported to 144×144 PNG as the
   logo and the screenshots from `docs/screenshots/` (1840×900 recommended — re-capture on the live site).
3. Hosting: **Cloud**. Compatible products: **Jira** (+ Confluence if kept). Pricing: paid via Atlassian, 30-day trial.
4. Data security & privacy: *Runs on Atlassian* (no egress), data stored in Forge storage, see `docs/PRIVACY.md`.
5. **Submit for approval.** Copy the review ticket URL (ECOHELP/AMKTHELP) from the confirmation e-mail or the
   *Manage app → Submission* page into `SUBMISSION.md` → "Marketplace".

## Listing copy

**App name:** Sprint Sentinel for Jira

**Tagline (≤ 80 chars):** Explainable sprint delivery risk — with a Rovo agent, MCP tools and safe actions.

**Summary (≤ 250 chars):** Sprint Sentinel scores every sprint and issue 0–100 for delivery risk — blockers, blocker
chains, stale and overdue work, overload, scope creep, missing AC, unanswered questions — shows the evidence, and acts
only after you confirm.

**Highlights**
1. **Risk you can verify** — every finding cites issue keys, dates and counts, with a confidence level. No invented data.
2. **Act safely** — comment, label, flag or create follow-up sub-tasks through a preview + single-use confirmation token.
3. **Works where you work** — Jira dashboard and issue panel, Rovo agent and skills, MCP tools for Claude/Cursor,
   Confluence Sprint Risk Reports with trend.

**Description**
Sprints rarely fail on the last day. Sprint Sentinel reads your sprint like a seasoned delivery lead: it follows blocker
links (including chains, keystone blockers and circular dependencies), spots in-progress work that went quiet, overdue
and due-soon items, stories without acceptance criteria, questions in comments nobody answered, issues added after the
sprint started, and people carrying more than their share — including work assigned to them in other projects via
Atlassian Teamwork Graph. It combines these into a transparent sprint health score with a breakdown you can explain in
stand-up, and a daily snapshot builds the trend. Ask the Sprint Sentinel Rovo agent "Is our sprint on track?" or
connect any MCP client. Every change it makes is previewed and confirmed by you first.

**Keywords:** sprint, risk, scrum, agile, blockers, dependencies, Rovo, AI agent, MCP, delivery, health, report

**Support:** GitHub issues · **Docs:** README.md · **Privacy:** docs/PRIVACY.md · **EULA:** Atlassian Marketplace standard EULA.

## Pre-submission checklist
- [ ] `forge lint` clean, deployed to production, installs on a fresh site without errors.
- [ ] Icon 144×144 PNG, 3–5 screenshots 1840×900, highlight images.
- [ ] Privacy policy and support URLs reachable.
- [ ] Data-security questionnaire answered (Runs on Atlassian, no egress, no end-user data stored outside Forge).
- [ ] Review ticket link pasted into SUBMISSION.md.
