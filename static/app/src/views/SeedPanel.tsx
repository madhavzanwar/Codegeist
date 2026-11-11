import { useState } from 'react';
import { api } from '../api';

/** One-click demo data: runs the resumable seeder step by step with a progress bar. */
export function SeedPanel({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setLog([]);
    try {
      for (let i = 0; i < 40; i++) {
        const r = await api.seedStep(i === 0 && !!error);
        setLog((l) => [...l, r.message]);
        setProgress(r.progress);
        if (!r.ok) {
          setError(r.message);
          break;
        }
        if (r.state.done) {
          onDone();
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <button className="btn primary" onClick={run} disabled={running}>
        {running ? 'Creating demo sprint…' : '🧪 Load demo sprint data'}
      </button>
      <p className="small muted" style={{ marginTop: 8 }}>
        Creates ~40 labelled issues (<code>sentinel-demo</code>), blockers, a started sprint and mid-sprint scope creep in this project, as you.
      </p>
      {running || log.length ? (
        <>
          <div className="progress" aria-label="Seeding progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <ul className="reasons small" style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto' }}>
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </>
      ) : null}
      {error ? <div className="banner err" style={{ marginTop: 12 }}>{error}</div> : null}
    </div>
  );
}
