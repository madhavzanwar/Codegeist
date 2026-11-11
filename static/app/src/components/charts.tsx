import { useState } from 'react';
import type { ReactNode } from 'react';

export type Band = 'low' | 'medium' | 'high' | 'critical';

export function bandOf(score: number): Band {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

const GAUGE_VAR: Record<Band, string> = { low: 'var(--gauge-low)', medium: 'var(--gauge-medium)', high: 'var(--gauge-high)', critical: 'var(--gauge-critical)' };

export function Lozenge({ band, children }: { band: Band | 'neutral' | 'info'; children: ReactNode }) {
  const cls = band === 'neutral' ? 'lz-neutral' : band === 'info' ? 'lz-info' : `sev-${band}`;
  return <span className={`lozenge ${cls}`}>{children}</span>;
}

/** Semicircle health gauge: health = 100 - risk. Colour follows the risk band; number + label carry the meaning. */
export function HealthGauge({ risk, size = 180 }: { risk: number; size?: number }) {
  const health = 100 - risk;
  const band = bandOf(risk);
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const len = Math.PI * r;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <svg width={size} height={size / 2 + 26} viewBox={`0 0 ${size} ${size / 2 + 26}`} role="img" aria-label={`Sprint health ${health} of 100, risk ${band}`}>
      <path d={arc} fill="none" stroke="var(--track)" strokeWidth={14} strokeLinecap="round" />
      <path d={arc} fill="none" stroke={GAUGE_VAR[band]} strokeWidth={14} strokeLinecap="round" strokeDasharray={`${(health / 100) * len} ${len}`} />
      <text x={cx} y={cy - 14} textAnchor="middle" fontSize={size / 4.2} fontWeight={700} fill="var(--text)" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {health}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize={12} fill="var(--text-subtlest)">
        health / 100
      </text>
    </svg>
  );
}

export function ScorePill({ score }: { score: number }) {
  const b = bandOf(score);
  return (
    <span className={`score-pill sev-${b}`} title={`Risk ${score}/100 (${b})`}>
      {score}
    </span>
  );
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

export function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const node = tip ? (
    <div className="tooltip" style={{ left: tip.x + 12, top: tip.y + 12 }} role="tooltip">
      {tip.content}
    </div>
  ) : null;
  return {
    node,
    bind: (content: ReactNode) => ({
      onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
      onMouseLeave: () => setTip(null),
      onFocus: (e: React.FocusEvent) => {
        const r = (e.target as HTMLElement).getBoundingClientRect();
        setTip({ x: r.left, y: r.bottom, content });
      },
      onBlur: () => setTip(null),
    }),
  };
}

/** Risk trend sparkline (single series, so no legend; hover shows each run). */
export function TrendLine({ points, height = 70 }: { points: Array<{ at: string; riskScore: number | null }>; height?: number }) {
  const tt = useTooltip();
  const data = points.filter((p) => p.riskScore !== null) as Array<{ at: string; riskScore: number }>;
  if (data.length < 2) return <p className="muted small">The trend line appears after a second run (the daily snapshot or another analysis).</p>;
  const w = 320;
  const pad = 6;
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - v / 100) * (height - pad * 2);
  const d = data.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.riskScore).toFixed(1)}`).join(' ');
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label={`Risk over ${data.length} runs, latest ${data[data.length - 1]?.riskScore}`}>
        {[30, 60, 80].map((t) => (
          <line key={t} x1={pad} x2={w - pad} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 4" />
        ))}
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((p, i) => (
          <g key={p.at} {...tt.bind(<><b>Risk {p.riskScore}</b><br />{new Date(p.at).toLocaleString()}</>)} tabIndex={0}>
            <circle cx={x(i)} cy={y(p.riskScore)} r={10} fill="transparent" />
            <circle cx={x(i)} cy={y(p.riskScore)} r={i === data.length - 1 ? 4 : 3} fill="var(--series-1)" stroke="var(--card)" strokeWidth={2} />
          </g>
        ))}
      </svg>
      {tt.node}
    </div>
  );
}

/** Horizontal stacked bar: remaining vs done points per person, with a capacity marker. */
export function LoadBar({ remaining, done, max, capacity }: { remaining: number; done: number; max: number; capacity: number }) {
  const tt = useTooltip();
  const scale = (v: number) => `${Math.max(0, (v / Math.max(1, max)) * 100)}%`;
  return (
    <div style={{ position: 'relative', height: 14 }} {...tt.bind(<><b>{remaining} pts remaining</b> · {done} pts done<br />Capacity line: {capacity} pts</>)} tabIndex={0}>
      <div style={{ position: 'absolute', inset: '3px 0', background: 'var(--track)', borderRadius: 4 }} />
      <div style={{ position: 'absolute', top: 3, bottom: 3, left: 0, width: scale(remaining), background: 'var(--series-1)', borderRadius: 4 }} />
      <div
        style={{ position: 'absolute', top: 3, bottom: 3, left: `calc(${scale(remaining)} + 2px)`, width: scale(done), background: 'var(--series-muted)', borderRadius: 4 }}
      />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: scale(capacity), width: 2, background: 'var(--text-subtlest)' }} aria-hidden />
      {tt.node}
    </div>
  );
}
