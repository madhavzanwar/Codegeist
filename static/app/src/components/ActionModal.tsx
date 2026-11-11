import { useEffect, useState } from 'react';
import { api, openUrl } from '../api';
import type { OpResult } from '../api';

export type ActionKind = 'add-risk-comment' | 'add-risk-label' | 'create-followup-subtask' | 'flag-issue' | 'publish-risk-report';

export interface ActionRequest {
  op: ActionKind;
  /** Pre-filled, editable arguments. */
  args: Record<string, string | number>;
  title: string;
}

const FIELDS: Record<ActionKind, Array<{ name: string; label: string; multiline?: boolean }>> = {
  'add-risk-comment': [{ name: 'comment', label: 'Comment', multiline: true }],
  'add-risk-label': [{ name: 'label', label: 'Label (no spaces)' }],
  'create-followup-subtask': [
    { name: 'summary', label: 'Sub-task summary' },
    { name: 'description', label: 'Description', multiline: true },
  ],
  'flag-issue': [{ name: 'reason', label: 'Reason (posted as a comment)', multiline: true }],
  'publish-risk-report': [{ name: 'spaceKey', label: 'Confluence space key' }],
};

type Phase = 'edit' | 'previewing' | 'confirm' | 'executing' | 'done' | 'error';

/**
 * Human-in-the-loop confirmation: edit → server preview (nothing written, single-use token)
 * → explicit Confirm → execute with token. Mirrors exactly what the Rovo agent and MCP tools do.
 */
export function ActionModal({ request, onClose, onDone, spaces }: { request: ActionRequest; onClose: () => void; onDone: () => void; spaces?: Array<{ key: string; name: string }> }) {
  const [args, setArgs] = useState<Record<string, string | number>>(request.args);
  const [phase, setPhase] = useState<Phase>('edit');
  const [result, setResult] = useState<OpResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const preview = async () => {
    setPhase('previewing');
    const r = await api.operation(request.op, args).catch((e: Error) => ({ status: 'rejected', operation: request.op, message: e.message }) as OpResult);
    setResult(r);
    setPhase(r.status === 'confirmation_required' ? 'confirm' : 'error');
  };

  const confirm = async () => {
    if (result?.status !== 'confirmation_required') return;
    setPhase('executing');
    const r = await api
      .operation(request.op, { ...result.arguments, confirmationToken: result.confirmationToken })
      .catch((e: Error) => ({ status: 'rejected', operation: request.op, message: e.message }) as OpResult);
    setResult(r);
    setPhase(r.status === 'done' ? 'done' : 'error');
    if (r.status === 'done') onDone();
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">{request.title}</h3>
        {phase === 'edit' || phase === 'previewing' ? (
          <>
            {FIELDS[request.op].map((f) => (
              <div key={f.name}>
                <label htmlFor={`f-${f.name}`}>{f.label}</label>
                {f.name === 'spaceKey' && spaces?.length ? (
                  <select id={`f-${f.name}`} value={String(args[f.name] ?? '')} onChange={(e) => setArgs({ ...args, [f.name]: e.target.value })}>
                    <option value="">Choose a space…</option>
                    {spaces.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name} ({s.key})
                      </option>
                    ))}
                  </select>
                ) : f.multiline ? (
                  <textarea id={`f-${f.name}`} value={String(args[f.name] ?? '')} onChange={(e) => setArgs({ ...args, [f.name]: e.target.value })} />
                ) : (
                  <input id={`f-${f.name}`} type="text" style={{ width: '100%' }} value={String(args[f.name] ?? '')} onChange={(e) => setArgs({ ...args, [f.name]: e.target.value })} />
                )}
              </div>
            ))}
            <div className="shield" style={{ marginTop: 12 }}>
              <span aria-hidden>🛡️</span>
              <span>Nothing is written yet. Sprint Sentinel first asks Jira for a preview and a single-use confirmation token.</span>
            </div>
            <div className="row">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={preview} disabled={phase === 'previewing'}>
                {phase === 'previewing' ? 'Preparing preview…' : 'Preview'}
              </button>
            </div>
          </>
        ) : null}
        {(phase === 'confirm' || phase === 'executing') && result?.status === 'confirmation_required' ? (
          <>
            <p className="muted">Please review exactly what will change:</p>
            <pre>{result.preview}</pre>
            <p className="small muted">Token expires in {result.expiresInMinutes} minutes and works once, for you, with these exact arguments.</p>
            <div className="row">
              <button className="btn" onClick={() => setPhase('edit')}>Back</button>
              <button className="btn primary" onClick={confirm} disabled={phase === 'executing'} autoFocus>
                {phase === 'executing' ? 'Applying…' : 'Confirm and apply'}
              </button>
            </div>
          </>
        ) : null}
        {phase === 'done' && result?.status === 'done' ? (
          <>
            <div className="banner ok">✅ {result.message}</div>
            <div className="row">
              {result.details?.url ? (
                <button className="btn" onClick={() => openUrl(result.details?.url as string)}>Open</button>
              ) : null}
              <button className="btn primary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : null}
        {phase === 'error' && result && result.status !== 'done' ? (
          <>
            <div className="banner err">{'message' in result ? result.message : 'Something went wrong.'}</div>
            <div className="row">
              <button className="btn" onClick={() => setPhase('edit')}>Back</button>
              <button className="btn primary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
