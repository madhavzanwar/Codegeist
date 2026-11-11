import { useEffect, useState } from 'react';
import { api, askAgent } from '../api';
import type { Overview } from '../api';
import { Lozenge, TrendLine, bandOf } from '../components/charts';

/** Confluence global page: portfolio view of every sprint Sprint Sentinel watches on this site. */
export function ConfluenceOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.overview().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div className="app">
      <div className="toolbar">
        <h1>
          <img src="./sentinel.svg" alt="" /> Sprint Sentinel <span className="subtitle">· delivery risk across projects</span>
        </h1>
        <button className="btn discovery" onClick={() => askAgent('Which of our sprints is most at risk right now, and why?')}>✨ Ask Sentinel</button>
      </div>
      {error ? <div className="banner err">{error}</div> : null}
      {!data ? <div className="skeleton" style={{ height: 120 }} /> : null}
      {data && !data.projects.length ? (
        <div className="card empty">
          <h2>No sprints analysed yet</h2>
          <p>Open the Sprint Sentinel tab in a Jira project (or ask the agent) to start tracking a sprint. Reports you publish land in the space you choose.</p>
        </div>
      ) : null}
      <div className="grid">
        {data?.projects.map((p) => (
          <section key={p.projectKey} className="card col-4">
            <h2>
              {p.projectKey} <span className="count">{p.sprintName}</span>
            </h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span className="stat">
                <span className="value">{p.healthScore ?? '—'}</span>
                <span className="label">health</span>
              </span>
              {p.riskScore !== null ? <Lozenge band={bandOf(p.riskScore)}>risk {p.riskScore}</Lozenge> : null}
            </div>
            <TrendLine points={p.history} height={50} />
            <div className="small muted">Updated {new Date(p.at).toLocaleString()}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
