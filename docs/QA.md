# QA log

Recorded 11 Nov 2026 on Node 22.23, Forge CLI 15.1.0. Re-run everything with `npm run check && npm run forge:lint`.

## Summary

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 problems |
| Typecheck (backend + UI) | `npm run typecheck` | ✅ 0 errors |
| Unit tests + coverage | `npm run test:coverage` | ✅ 88/88 tests · 94.7% statements · 97.4% lines · 80.9% branches (thresholds 85/85/75) |
| Forge lint (client-side, offline) | `npm run forge:lint` | ✅ 0 errors, 0 warnings |
| Forge lint (full, server-side) | `forge lint` | ⏳ requires `forge login` — run by `scripts/ship.sh` before deploy |
| UI build | `npm run build:ui` | ✅ |
| Handler wiring | load `src/index.ts`, compare with manifest | ✅ all 12 manifest handlers exported as functions |
| UI render (mock bridge, real engine) | `npm run screenshots` | ✅ dashboard (light/dark), evidence, confirmation modal, findings, issue panel, Confluence page — no console errors |
| Deploy / install / live E2E | `scripts/ship.sh` | ⏳ needs Atlassian credentials — see checklist below |

## Raw output

```text
$ npm run lint
> sprint-sentinel@1.0.0 lint
> eslint .


$ npm run typecheck

> sprint-sentinel-ui@1.0.0 typecheck
> tsc --noEmit -p tsconfig.json


$ npm run test:coverage
      Coverage enabled with v8
 Test Files  7 passed (7)
      Tests  88 passed (88)
   Start at  18:53:52
   Duration  740ms (import 39%, transform 25%, tests 22%, worker 14%)
 % Coverage report from v8
----------------|---------|----------|---------|---------|----------------------
File            | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s    
----------------|---------|----------|---------|---------|----------------------
All files       |   94.74 |     80.9 |    95.2 |   97.37 |                      
 src            |   95.52 |       75 |     100 |   99.13 |                      
  ops.ts        |   95.45 |    73.21 |     100 |     100 | ...8,105-106,132-153 
  service.ts    |   95.65 |    78.12 |     100 |    97.5 | 72                   
 src/actions    |   86.17 |    74.75 |   93.33 |   94.66 |                      
  handlers.ts   |   86.17 |    74.75 |   93.33 |   94.66 | 72,90,148-149        
 src/confluence |   72.72 |    54.16 |      75 |      75 |                      
  service.ts    |   72.72 |    54.16 |      75 |      75 | 27,45,63-69          
 src/core       |   98.27 |    88.23 |   97.68 |      99 |                      
  adf.ts        |     100 |     92.5 |     100 |     100 | 55,57-58             
  analyze.ts    |   98.96 |    88.23 |     100 |   98.71 | 113-114              
  graph.ts      |   97.75 |    82.05 |     100 |     100 | 69-70,76,98          
  report.ts     |    92.3 |    63.46 |      90 |   95.55 | 68-69                
  signals.ts    |   99.27 |    92.44 |     100 |     100 | ...6-218,262,317,325 
  summary.ts    |   94.44 |       75 |   91.66 |     100 | 40-42,71             
  text.ts       |     100 |    86.66 |     100 |     100 | 48                   
  time.ts       |   95.45 |      100 |   83.33 |   94.44 | 29                   
 src/jira       |   92.98 |     76.8 |      90 |   97.22 |                      
  http.ts       |   94.11 |    97.67 |      75 |   97.61 | 45                   
  mapper.ts     |   98.85 |    85.38 |      96 |     100 | ...1,164,166,190-191 
  service.ts    |   86.66 |    54.44 |    90.9 |    94.2 | 67,81,216-217        
 src/resolvers  |   87.69 |    66.66 |     100 |   94.44 |                      
  handlers.ts   |   87.69 |    66.66 |     100 |   94.44 | 95,117-118           
 src/seed       |   92.78 |    74.59 |   92.85 |   94.73 |                      
  executor.ts   |   92.34 |    74.59 |    92.3 |    94.4 | ...5-186,206-207,276 
 src/storage    |   94.33 |    69.23 |      96 |     100 |                      
  store.ts      |   94.33 |    69.23 |      96 |     100 | 66-79,88,117         
 src/twg        |     100 |     93.1 |     100 |     100 |                      
  parse.ts      |     100 |     93.1 |     100 |     100 | 56-59                
----------------|---------|----------|---------|---------|----------------------
=============================== Coverage summary ===============================
Statements   : 94.74% ( 1388/1465 )
Branches     : 80.9% ( 1034/1278 )
Functions    : 95.2% ( 357/375 )
Lines        : 97.37% ( 1148/1179 )
================================================================================

$ npm run forge:lint   # Forge CLI 15.1.0 client-side linters, offline
No issues found.


Forge client-side lint: 0 error(s), 0 warning(s)

$ npm run build:ui
build/index.html                           0.40 kB │ gzip:  0.26 kB
build/assets/index-wACsmVQh.css           10.46 kB │ gzip:  2.88 kB
build/assets/iframe-resizer-BnJ78erM.js   29.18 kB │ gzip: 10.27 kB
build/assets/index-iRxNLQSi.js           313.13 kB │ gzip: 95.32 kB

✓ built in 205ms
```

Handler wiring check:

```text
$ npx tsx -e "import('./src/index.ts')…"
handler:function analyzeSprintRisk:function explainIssueRisk:function getAssigneeLoad:function listSprints:function
getRiskTrend:function addRiskComment:function addRiskLabel:function createFollowupSubtask:function flagIssue:function
publishRiskReport:function dailySnapshot:function
```

## What the tests cover
- **Risk engine** (`test/signals.test.ts`, `test/analyze.test.ts`): every signal incl. edge cases (resolved blockers,
  outside-sprint blockers, flagged, chains, keystones, cycles, stale thresholds, overdue scaling, due-soon, AC
  heuristics, question answered/unanswered, scope creep via changelog vs creation fallback vs activatedDate, WIP/points/
  median/Teamwork Graph overload), sprint scoring, components, confidence degradation, no-data handling.
- **Trend & report** (`test/trend-report.test.ts`): deltas/direction/new-at-risk, snapshot dedupe/cap, XML escaping,
  storage-format report incl. first-run and no-data variants.
- **Transport & mapping** (`test/backend.test.ts`): 429 + Retry-After retries, 5xx give-up, pagination, Jira JSON →
  domain mapping (links direction, comments ADF, changelog sprint adds, truncation), sprint resolution (active/future/
  missing/no board), full pipeline with snapshots and cache, Teamwork Graph query building and honest degradation.
- **Confirmation protocol** (`test/backend.test.ts`, `test/ops-e2e.test.ts`): preview writes nothing; token is
  single-use and bound to user + operation + exact arguments; tampering, other users, expiry, bad input rejected;
  comment, label, sub-task, flag and Confluence publish executed end-to-end against fakes.
- **Seeder** (`test/seed.test.ts`): dataset integrity, every step, sprint started between committed and creep moves,
  automatic correction of inverted link semantics, refusal over an active sprint / existing demo data, bulk-create retry.

## Live end-to-end checklist (run after `scripts/ship.sh`)
1. Jira → new Scrum project `SEN` → *Sprint Sentinel* tab → *Load demo sprint data* → progress reaches 100%.
2. Dashboard shows risk/health, ≥ 8 finding kinds, assignee load, confidence. `forge logs -e production` is clean.
3. Expand top issue → *Flag* → *Preview* → *Confirm and apply* → issue shows flag + comment with footer.
4. Issue view → *Sprint risk* panel renders the same score as the dashboard.
5. Rovo Chat → *Sprint Sentinel* → "Is the SEN sprint on track?" → cites keys/dates; "label SEN-1 sentinel-at-risk" →
   preview → "yes" → done.
6. *Publish report* → ENG space → page has summary, breakdown, top-risk table, findings, load, trend.
7. Admin → Connected apps → enable MCP tools → Claude Code `claude mcp add --transport http sprint-sentinel
   https://mcp.atlassian.com/forge/<APP_ID>` → `analyze-sprint-risk` works; a write tool returns a preview first.
8. Confluence → Apps → *Sprint Sentinel* page lists SEN with its trend.
