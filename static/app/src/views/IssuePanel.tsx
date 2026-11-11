import { useEffect, useState } from 'react';
import { api, askAgent } from '../api';
import type { IssuePanelData } from '../api';
import { Lozenge, ScorePill, bandOf } from '../components/charts';
import { ActionModal } from '../components/ActionModal';
import type { ActionRequest } from '../components/ActionModal';
import { buildRequest } from './Dashboard';

export function IssuePanel() {
  const [data, setData] = useState<IssuePanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<ActionRequest | null>(null);
  const load = () => api.issueRisk().then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  if (error) return <div className="panel-app banner err">Could not load sprint risk: {error}</div>;
  if (!data) return <div className="panel-app"><div className="skeleton" style={{ height: 64 }} /></div>;
  if (!data.inSprint || !data.found || !data.issue)
    return <div className="panel-app muted">{data.message ?? 'This issue is not in the analysed sprint, so there is no risk score. Nothing was inferred.'}</div>;

  const i = data.issue;
  const top = i.signals.slice().sort((a, b) => b.points - a.points)[0];
  return (
    <div className="panel-app">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <ScorePill score={i.score} />
        <b>{i.score === 0 ? 'No risk signals' : `${bandOf(i.score)} risk`}</b>
        <span className="muted small">
          #{data.sprintContext?.rank} of {data.sprintContext?.of} in {data.sprint} · sprint risk {data.sprintRisk ?? '—'}/100
        </span>
      </div>
      <div className="signals" style={{ marginLeft: 0 }}>
        {i.signals.map((s, n) => (
          <div className="signal" key={n}>
            <div className="msg">
              <Lozenge band={s.severity}>{s.severity}</Lozenge> {s.message}
            </div>
            <div className="evidence">
              {s.evidence.map((e, k) => (
                <span key={k}>
                  {e.label}: <b>{String(e.value)}</b>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="actions" style={{ marginLeft: 0 }}>
        {i.score > 0 ? (
          <>
            <button className="btn small" onClick={() => setRequest(buildRequest('add-risk-comment', i.key, top))}>Comment</button>
            <button className="btn small" onClick={() => setRequest(buildRequest('flag-issue', i.key, top))}>Flag</button>
            <button className="btn small" onClick={() => setRequest(buildRequest('add-risk-label', i.key, top))}>Label</button>
          </>
        ) : null}
        <button className="btn small discovery" onClick={() => askAgent(`Explain the delivery risk of ${i.key} and what I should do about it.`)}>
          ✨ Ask Sentinel
        </button>
      </div>
      {request ? <ActionModal request={request} onClose={() => setRequest(null)} onDone={() => void load()} /> : null}
    </div>
  );
}
