import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, askAgent, openUrl } from '../api';
import type { DashboardData, IssueRisk } from '../api';
import type { ActionKind, ActionRequest } from '../components/ActionModal';
import { ActionModal } from '../components/ActionModal';
import { HealthGauge, LoadBar, Lozenge, ScorePill, TrendLine, bandOf } from '../components/charts';
import type { Band } from '../components/charts';
import { SeedPanel } from './SeedPanel';
import type { Finding, Signal, SignalKind } from '../../../../src/core/types';

const KIND_LABEL: Record<SignalKind, string> = {
  blocked: 'Blocked',
  blocker_chain: 'Blocker chain',
  circular_dependency: 'Circular dependency',
  stale: 'Stale',
  overdue: 'Overdue',
  due_soon_not_started: 'Due soon',
  missing_acceptance_criteria: 'No acceptance criteria',
  unanswered_question: 'Open question',
  scope_creep: 'Added mid-sprint',
  overloaded_assignee: 'Overloaded owner',
  unassigned: 'Unassigned',
};

const ACTION_LABEL: Record<ActionKind, string> = {
  'add-risk-comment': 'Comment',
  'add-risk-label': 'Label',
  'create-followup-subtask': 'Follow-up sub-task',
  'flag-issue': 'Flag',
  'publish-risk-report': 'Publish report',
};

export function buildRequest(op: ActionKind, key: string, signal?: Signal | Finding): ActionRequest {
  const message = signal ? ('message' in signal ? signal.message : signal.explanation) : '';
  const kind = signal?.kind;
  switch (op) {
    case 'add-risk-comment':
      return { op, title: `Comment on ${key}`, args: { issueKey: key, comment: `Sprint Sentinel flagged a delivery risk: ${message}\n\nCould the owner share an update or a new ETA?` } };
    case 'add-risk-label':
      return {
        op,
        title: `Label ${key}`,
        args: { issueKey: key, label: kind === 'blocker_chain' || kind === 'circular_dependency' ? 'sentinel-dependency' : kind === 'scope_creep' ? 'sentinel-scope-creep' : 'sentinel-at-risk' },
      };
    case 'create-followup-subtask':
      return {
        op,
        title: `Follow-up sub-task for ${key}`,
        args: {
          parentKey: key,
          summary: kind === 'missing_acceptance_criteria' ? `Define acceptance criteria for ${key}` : `Resolve delivery risk on ${key}`,
          description: message,
        },
      };
    case 'flag-issue':
      return { op, title: `Flag ${key} as an impediment`, args: { issueKey: key, reason: message } };
    case 'publish-risk-report':
      return { op, title: 'Publish Sprint Risk Report to Confluence', args: { projectKey: key } };
  }
}

function Evidence({ items }: { items: Array<{ label: string; value: string | number }> }) {
  return (
    <div className="evidence">
      {items.map((e, i) => (
        <span key={i}>
          {e.label}: <b>{String(e.value)}</b>
        </span>
      ))}
    </div>
  );
}

function RiskItem({ issue, siteUrl, onAction }: { issue: IssueRisk; siteUrl: string | null; onAction: (r: ActionRequest) => void }) {
  const [open, setOpen] = useState(false);
  const top = issue.signals.slice().sort((a, b) => b.points - a.points)[0];
  const ops = Array.from(new Set<ActionKind>(['add-risk-comment', 'add-risk-label', 'flag-issue', 'create-followup-subtask']));
  return (
    <div className="risk-item">
      <button className="risk-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ScorePill score={issue.score} />
        <div className="risk-title">
          <div>
            <span className="key">{issue.key}</span>
            <span className="sum">{issue.summary}</span>
          </div>
          <div className="risk-sub">
            {issue.signals.map((s, i) => (
              <Lozenge key={i} band={s.severity}>
                {KIND_LABEL[s.kind]}
              </Lozenge>
            ))}
            <span>
              {issue.status} · {issue.assignee ?? 'Unassigned'}
              {issue.storyPoints !== undefined ? ` · ${issue.storyPoints} pts` : ''}
            </span>
          </div>
        </div>
        <span className="muted small" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open ? (
        <>
          <div className="signals">
            {issue.signals.map((s, i) => (
              <div className="signal" key={i}>
                <div className="msg">
                  <Lozenge band={s.severity}>{s.severity}</Lozenge> {s.message}{' '}
                  <span className="muted small">
                    (+{s.points} pts · {s.confidence} confidence)
                  </span>
                </div>
                <Evidence items={s.evidence} />
              </div>
            ))}
          </div>
          <div className="actions">
            {ops.map((op) => (
              <button key={op} className="btn small" onClick={() => onAction(buildRequest(op, issue.key, top))}>
                {ACTION_LABEL[op]}
              </button>
            ))}
            <button className="btn small link" onClick={() => askAgent(`Explain the delivery risk of ${issue.key} and suggest what to do.`)}>
              Ask Sentinel
            </button>
            {siteUrl ? (
              <button className="btn small link" onClick={() => openUrl(`${siteUrl}/browse/${issue.key}`)}>
                Open issue ↗
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="app" aria-busy="true">
      <div className="skeleton" style={{ height: 32, width: 280, marginBottom: 16 }} />
      <div className="grid">
        {[0, 1, 2].map((i) => (
          <div key={i} className="col-4 skeleton" style={{ height: 160 }} />
        ))}
        <div className="col-8 skeleton" style={{ height: 320 }} />
        <div className="col-4 skeleton" style={{ height: 320 }} />
      </div>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sprintId, setSprintId] = useState<number | undefined>();
  const [request, setRequest] = useState<ActionRequest | null>(null);
  const [spaces, setSpaces] = useState<Array<{ key: string; name: string }>>([]);
  const [tab, setTab] = useState<'issues' | 'findings'>('issues');
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (id?: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.dashboard(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(sprintId);
  }, [load, sprintId]);

  const result = data?.result;
  const openIssues = useMemo(() => (result?.issues ?? []).filter((i) => i.score > 0), [result]);
  const maxLoad = useMemo(() => Math.max(1, ...(result?.assignees ?? []).map((a) => a.remainingPoints + a.donePoints), data?.settings.maxPointsPerPerson ?? 13), [result, data]);

  const publish = async () => {
    const s = await api.listSpaces();
    if (!s.available) {
      setNotice(s.message ?? 'Confluence is not connected to Sprint Sentinel on this site.');
      return;
    }
    setSpaces(s.spaces);
    const req = buildRequest('publish-risk-report', data?.projectKey ?? '');
    req.args = { projectKey: data?.projectKey ?? '', spaceKey: data?.settings.reportSpaceKey ?? s.spaces[0]?.key ?? '', ...(result ? { sprintId: result.sprint.id } : {}) };
    setRequest(req);
  };

  const ask = async () => {
    const ok = await askAgent(`Analyse the delivery risk of the ${result?.sprint.name ?? 'current'} sprint in project ${data?.projectKey}. What are the top risks and what should we do first?`);
    if (!ok) setNotice('Rovo is not enabled on this site, so the chat could not be opened. Everything on this page still works.');
  };

  if (loading && !data) return <Skeleton />;
  if (error)
    return (
      <div className="app">
        <div className="banner err">Sprint Sentinel could not load this project: {error}</div>
        <button className="btn" onClick={() => load(sprintId)}>Retry</button>
      </div>
    );
  if (!data) return null;

  const header = (
    <div className="toolbar">
      <h1>
        <img src="./sentinel.svg" alt="" /> Sprint Sentinel
        {result ? <span className="subtitle">· {result.project.name} · generated {new Date(result.generatedAt).toLocaleTimeString()}</span> : null}
      </h1>
      {data.sprints.length ? (
        <select aria-label="Sprint" value={sprintId ?? result?.sprint.id ?? ''} onChange={(e) => setSprintId(Number(e.target.value))}>
          {data.sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.state})
            </option>
          ))}
        </select>
      ) : null}
      <button className="btn" onClick={() => load(sprintId)} disabled={loading}>
        {loading ? 'Refreshing…' : '↻ Refresh'}
      </button>
      <button className="btn" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>
        ⚙ Settings
      </button>
      {result?.status === 'ok' ? (
        <button className="btn" onClick={publish}>
          📄 Publish report
        </button>
      ) : null}
      <button className="btn discovery" onClick={ask}>
        ✨ Ask Sentinel
      </button>
    </div>
  );

  const banners = (
    <>
      {notice ? (
        <div className="banner info" role="status">
          {notice}{' '}
          <button className="btn small link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {data.lastReport ? (
        <div className="small muted" style={{ marginBottom: 8 }}>
          Last report:{' '}
          {data.lastReport.url ? (
            <a href="#" onClick={(e) => (e.preventDefault(), openUrl(data.lastReport?.url as string))}>
              {data.lastReport.title}
            </a>
          ) : (
            data.lastReport.title
          )}
        </div>
      ) : null}
      {showSettings ? <SettingsCard data={data} onSaved={() => (setShowSettings(false), load(sprintId))} /> : null}
    </>
  );

  if (!result || result.status === 'no_data') {
    return (
      <div className="app">
        {header}
        {banners}
        <div className="card empty">
          <img src="./sentinel.svg" alt="" width={56} height={56} />
          <h2>{result ? 'This sprint has no issues yet' : 'No sprint to analyse'}</h2>
          <p>{result?.message ?? data.message ?? 'Sprint Sentinel needs a Scrum board with an active or planned sprint.'} Sprint Sentinel never invents data — it only scores what Jira contains.</p>
          <SeedPanel onDone={() => load()} />
        </div>
      </div>
    );
  }

  const m = result.metrics;
  const band = (result.band ?? 'low') as Band;
  const topFinding = result.findings[0];

  return (
    <div className="app">
      {header}
      {banners}
      <div className="grid">
        <section className="card col-5" aria-label="Sprint health">
          <div className="hero">
            <HealthGauge risk={result.riskScore ?? 0} />
            <div className="hero-meta">
              <div className="verdict">{result.sprint.name}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Lozenge band={band}>Risk {result.riskScore}/100 · {band}</Lozenge>
                <Lozenge band="neutral">Confidence: {result.confidence.level}</Lozenge>
                {result.graph.used ? <Lozenge band="info">Teamwork Graph</Lozenge> : null}
              </div>
              {result.sprint.goal ? <div className="small muted">Goal: {result.sprint.goal}</div> : null}
              {topFinding ? (
                <div className="small">
                  <b>Biggest risk:</b> {topFinding.title}
                </div>
              ) : (
                <div className="small">No risk signals. 🎉</div>
              )}
              {data.trend?.hasPrevious ? (
                <div className="small muted">
                  Since last run: {data.trend.riskDelta !== null && data.trend.riskDelta > 0 ? '▲ +' : data.trend.riskDelta !== null && data.trend.riskDelta < 0 ? '▼ ' : '±'}
                  {data.trend.riskDelta ?? 0} risk ({data.trend.direction})
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card col-7" aria-label="Sprint metrics">
          <div className="grid" style={{ gap: 12 }}>
            <div className="stat col-3">
              <span className="label">Done</span>
              <span className="value">
                {m.doneIssues}/{m.totalIssues}
              </span>
              <span className="hint">
                {m.donePoints}/{m.totalPoints} pts
              </span>
            </div>
            <div className="stat col-3">
              <span className="label">Time elapsed</span>
              <span className="value">{m.elapsedFraction === null ? '—' : `${Math.round(m.elapsedFraction * 100)}%`}</span>
              <span className="hint">{m.daysRemaining === null ? 'no dates' : `${m.daysRemaining} days left`}</span>
            </div>
            <div className="stat col-3">
              <span className="label">Added mid-sprint</span>
              <span className="value">+{m.addedIssues}</span>
              <span className="hint">+{m.addedPoints} pts on {m.committedPoints} committed</span>
            </div>
            <div className="stat col-3">
              <span className="label">Blocked</span>
              <span className="value">{m.blockedIssues}</span>
              <span className="hint">open issues</span>
            </div>
          </div>
          <h2 style={{ marginTop: 16 }}>How the score is built</h2>
          {result.components.map((c) => (
            <div className="bar-row" key={c.name} title={c.detail}>
              <span className="small">
                {c.name} <span className="muted">· {Math.round(c.weight * 100)}%</span>
              </span>
              <div className="bar-track" role="img" aria-label={`${c.name} ${c.value} of 100: ${c.detail}`}>
                <div className="bar-fill" style={{ width: `${c.value}%`, background: `var(--gauge-${bandOf(c.value)})` }} />
              </div>
              <span className="bar-value small">{c.value}</span>
            </div>
          ))}
        </section>

        <section className="card col-8" aria-label="Risks">
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" aria-selected={tab === 'issues'} onClick={() => setTab('issues')}>
              Riskiest issues <span className="muted">({openIssues.length})</span>
            </button>
            <button className="tab" role="tab" aria-selected={tab === 'findings'} onClick={() => setTab('findings')}>
              Findings <span className="muted">({result.findings.length})</span>
            </button>
          </div>
          {tab === 'issues' ? (
            <div className="risk-list">
              {openIssues.length ? (
                <>
                  {openIssues.slice(0, showAll ? openIssues.length : 12).map((i) => (
                    <RiskItem key={i.key} issue={i} siteUrl={data.siteUrl} onAction={setRequest} />
                  ))}
                  {openIssues.length > 12 ? (
                    <button className="btn small link" style={{ marginTop: 8, alignSelf: 'flex-start' }} onClick={() => setShowAll(!showAll)}>
                      {showAll ? 'Show fewer' : `Show all ${openIssues.length} issues with risk signals`}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="muted">No open issue carries a risk signal.</p>
              )}
            </div>
          ) : (
            <div>
              {result.findings.map((f) => (
                <div key={f.id} className={`finding sev-b-${f.severity}`}>
                  <div className="t">
                    <Lozenge band={f.severity}>{f.severity}</Lozenge> {f.title} <span className="muted small">· {f.confidence} confidence</span>
                  </div>
                  <div className="e">{f.explanation}</div>
                  <Evidence items={f.evidence.slice(0, 8)} />
                  {f.suggestedActions.length ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {f.suggestedActions.slice(0, 3).map((a, i) => (
                        <button key={i} className="btn small" title={a.reason} onClick={() => setRequest(buildRequest(a.action, a.issueKey, f))}>
                          {ACTION_LABEL[a.action]} {a.issueKey}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="col-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" aria-label="Assignee load">
            <h2>
              Assignee load <span className="count">remaining vs done points</span>
            </h2>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--series-1)' }} />
                Remaining
              </span>
              <span>
                <i style={{ background: 'var(--series-muted)' }} />
                Done
              </span>
              <span>
                <i style={{ background: 'var(--text-subtlest)', width: 2 }} />
                Limit {data.settings.maxPointsPerPerson} pts
              </span>
            </div>
            {result.assignees.map((a) => (
              <div className="load-row" key={a.accountId ?? 'none'}>
                <span className="load-name" title={a.reasons.join('; ')}>
                  {a.displayName}
                  {a.teams.length || a.openWorkElsewhere !== undefined ? (
                    <span className="teams">
                      {a.teams.join(', ')}
                      {a.openWorkElsewhere ? `${a.teams.length ? ' · ' : ''}+${a.openWorkElsewhere}${a.openWorkElsewhereCapped ? '+' : ''} elsewhere` : ''}
                    </span>
                  ) : null}
                </span>
                <LoadBar remaining={a.remainingPoints} done={a.donePoints} max={maxLoad} capacity={data.settings.maxPointsPerPerson} />
                <span className="small" style={{ textAlign: 'right', minWidth: 64 }}>
                  {a.overloaded ? <Lozenge band="high">Over</Lozenge> : <span className="muted">{a.openIssues} open</span>}
                </span>
              </div>
            ))}
            <details className="small" style={{ marginTop: 8 }}>
              <summary className="muted">Table view</summary>
              <table className="simple">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Open</th>
                    <th>WIP</th>
                    <th>Remaining</th>
                    <th>Done</th>
                  </tr>
                </thead>
                <tbody>
                  {result.assignees.map((a) => (
                    <tr key={a.accountId ?? 'none'}>
                      <td>{a.displayName}</td>
                      <td>{a.openIssues}</td>
                      <td>{a.inProgress}</td>
                      <td>{a.remainingPoints}</td>
                      <td>{a.donePoints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            {!result.graph.used && result.graph.note ? <p className="small muted">Teamwork Graph: {result.graph.note}</p> : null}
          </section>

          <section className="card" aria-label="Risk trend">
            <h2>
              Risk trend <span className="count">per run</span>
            </h2>
            <TrendLine points={data.trend?.history ?? []} />
            {data.trend?.hasPrevious ? (
              <div className="small muted">
                {data.trend.newAtRisk.length ? `Newly at risk: ${data.trend.newAtRisk.join(', ')}. ` : ''}
                {data.trend.noLongerAtRisk.length ? `No longer at risk: ${data.trend.noLongerAtRisk.join(', ')}.` : ''}
              </div>
            ) : null}
          </section>

          <section className="card" aria-label="Data confidence">
            <h2>
              Confidence <Lozenge band="neutral">{result.confidence.level}</Lozenge>
            </h2>
            <ul className="reasons small">
              {result.confidence.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      {request ? (
        <ActionModal
          request={request}
          spaces={spaces}
          onClose={() => setRequest(null)}
          onDone={() => {
            void load(sprintId);
          }}
        />
      ) : null}
    </div>
  );
}

function SettingsCard({ data, onSaved }: { data: DashboardData; onSaved: () => void }) {
  const [s, setS] = useState({ ...data.settings });
  const [saving, setSaving] = useState(false);
  const field = (name: 'staleAfterHours' | 'maxPointsPerPerson' | 'maxWipPerPerson' | 'unansweredQuestionHours', label: string) => (
    <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label}
      <input type="number" min={1} value={s[name]} onChange={(e) => setS({ ...s, [name]: Number(e.target.value) })} />
    </label>
  );
  return (
    <section className="card" style={{ marginBottom: 16 }} aria-label="Settings">
      <h2>Thresholds for {data.projectKey}</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {field('staleAfterHours', 'Stale after (hours)')}
        {field('maxPointsPerPerson', 'Points per person')}
        {field('maxWipPerPerson', 'WIP limit per person')}
        {field('unansweredQuestionHours', 'Question overdue after (hours)')}
        <button
          className="btn primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await api.saveSettings(s);
            setSaving(false);
            onSaved();
          }}
        >
          {saving ? 'Saving…' : 'Save & re-analyse'}
        </button>
      </div>
    </section>
  );
}
