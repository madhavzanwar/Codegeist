import { kindTitle } from './analyze';
import type { Severity, SignalKind, SprintRiskResult, TrendReport } from './types';

/** Builds the "Sprint Risk Report" Confluence page in storage format (XHTML). Pure. */

export function escapeXml(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_COLOUR: Record<Severity, string> = { low: 'Green', medium: 'Yellow', high: 'Red', critical: 'Red' };

function statusMacro(title: string, colour: string): string {
  return `<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">${escapeXml(title)}</ac:parameter><ac:parameter ac:name="colour">${colour}</ac:parameter></ac:structured-macro>`;
}

function panel(type: 'info' | 'note' | 'warning' | 'tip', body: string): string {
  return `<ac:structured-macro ac:name="${type}"><ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;
}

function issueLink(siteUrl: string | undefined, key: string): string {
  return siteUrl ? `<a href="${escapeXml(`${siteUrl.replace(/\/$/, '')}/browse/${key}`)}">${escapeXml(key)}</a>` : escapeXml(key);
}

function arrow(delta: number | null): string {
  if (delta === null) return '—';
  if (delta === 0) return '±0';
  return delta > 0 ? `▲ +${delta}` : `▼ ${delta}`;
}

export function reportTitle(result: SprintRiskResult): string {
  const stamp = result.generatedAt.slice(0, 16).replace('T', ' ');
  return `Sprint Risk Report — ${result.project.key} — ${result.sprint.name} — ${stamp} UTC`;
}

export function buildReportStorage(result: SprintRiskResult, trend: TrendReport, siteUrl?: string): string {
  const parts: string[] = [];
  const m = result.metrics;
  if (result.status === 'no_data') {
    parts.push(panel('note', `<p>${escapeXml(result.message ?? 'No data.')}</p>`));
    return parts.join('');
  }
  const band = result.band ?? 'low';
  parts.push(
    `<h2>Summary</h2>`,
    `<p><strong>Sprint risk:</strong> ${statusMacro(`${result.riskScore}/100 ${band.toUpperCase()}`, STATUS_COLOUR[band])} &nbsp; <strong>Health:</strong> ${result.healthScore}/100 &nbsp; <strong>Confidence:</strong> ${statusMacro(result.confidence.level.toUpperCase(), result.confidence.level === 'high' ? 'Green' : result.confidence.level === 'medium' ? 'Yellow' : 'Grey')}</p>`,
    `<p>Project <strong>${escapeXml(result.project.name)}</strong> (${escapeXml(result.project.key)}) · Sprint <strong>${escapeXml(result.sprint.name)}</strong>${result.sprint.goal ? ` · Goal: <em>${escapeXml(result.sprint.goal)}</em>` : ''}</p>`,
    `<table><tbody>`,
    `<tr><th>Issues done</th><td>${m.doneIssues} / ${m.totalIssues}</td><th>Points done</th><td>${m.donePoints} / ${m.totalPoints}</td></tr>`,
    `<tr><th>Time elapsed</th><td>${m.elapsedFraction === null ? 'n/a' : `${Math.round(m.elapsedFraction * 100)}%`}</td><th>Days remaining</th><td>${m.daysRemaining ?? 'n/a'}</td></tr>`,
    `<tr><th>Added after start</th><td>${m.addedIssues} issues / ${m.addedPoints} pts</td><th>Blocked issues</th><td>${m.blockedIssues}</td></tr>`,
    `</tbody></table>`,
  );

  // Trend
  parts.push(`<h2>Trend vs last run</h2>`);
  if (!trend.hasPrevious) {
    parts.push(`<p>This is the first recorded run for this sprint, so there is no trend yet. The next report will compare against this one.</p>`);
  } else {
    const deltas = Object.entries(trend.findingCountDeltas) as Array<[SignalKind, number]>;
    parts.push(
      `<p>Compared with the run at ${escapeXml(trend.previousAt ?? '')}: risk <strong>${arrow(trend.riskDelta)}</strong> (${escapeXml(trend.direction)}).</p>`,
      `<ul>`,
      `<li>Newly at risk: ${trend.newAtRisk.length ? trend.newAtRisk.map((k) => issueLink(siteUrl, k)).join(', ') : 'none'}</li>`,
      `<li>No longer at risk: ${trend.noLongerAtRisk.length ? trend.noLongerAtRisk.map((k) => issueLink(siteUrl, k)).join(', ') : 'none'}</li>`,
      `<li>Finding changes: ${deltas.length ? deltas.map(([k, d]) => `${escapeXml(kindTitle(k))} ${d > 0 ? `+${d}` : d}`).join('; ') : 'none'}</li>`,
      `</ul>`,
    );
    if (trend.history.length > 1) {
      parts.push(
        `<table><tbody><tr><th>Run</th>${trend.history.map((h) => `<td>${escapeXml(h.at.slice(5, 16).replace('T', ' '))}</td>`).join('')}</tr><tr><th>Risk</th>${trend.history.map((h) => `<td>${h.riskScore ?? '—'}</td>`).join('')}</tr></tbody></table>`,
      );
    }
  }

  // Score breakdown
  parts.push(
    `<h2>How the score was calculated</h2>`,
    `<table><tbody><tr><th>Component</th><th>Weight</th><th>Risk (0–100)</th><th>Detail</th></tr>`,
    ...result.components.map(
      (c) => `<tr><td>${escapeXml(c.name)}</td><td>${Math.round(c.weight * 100)}%</td><td>${c.value}</td><td>${escapeXml(c.detail)}</td></tr>`,
    ),
    `</tbody></table>`,
  );

  // Top risks
  const top = result.issues.filter((i) => i.score > 0).slice(0, 15);
  parts.push(`<h2>Top risks</h2>`);
  if (!top.length) {
    parts.push(`<p>No open issue currently carries a risk signal.</p>`);
  } else {
    parts.push(
      `<table><tbody><tr><th>Issue</th><th>Risk</th><th>Status</th><th>Assignee</th><th>Signals and evidence</th></tr>`,
      ...top.map(
        (i) =>
          `<tr><td>${issueLink(siteUrl, i.key)}<br/>${escapeXml(i.summary)}</td><td>${statusMacro(String(i.score), STATUS_COLOUR[i.band])}</td><td>${escapeXml(i.status)}</td><td>${escapeXml(i.assignee ?? 'Unassigned')}</td><td><ul>${i.signals.map((s) => `<li>${escapeXml(s.message)}</li>`).join('')}</ul></td></tr>`,
      ),
      `</tbody></table>`,
    );
  }

  // Findings
  parts.push(`<h2>Findings</h2>`);
  if (!result.findings.length) parts.push(`<p>No findings.</p>`);
  else
    parts.push(
      `<table><tbody><tr><th>Severity</th><th>Finding</th><th>Confidence</th><th>Issues</th></tr>`,
      ...result.findings.slice(0, 30).map(
        (f) =>
          `<tr><td>${statusMacro(f.severity.toUpperCase(), STATUS_COLOUR[f.severity])}</td><td><strong>${escapeXml(f.title)}</strong><br/>${escapeXml(f.explanation)}</td><td>${escapeXml(f.confidence)}</td><td>${f.issueKeys.slice(0, 12).map((k) => issueLink(siteUrl, k)).join(', ')}</td></tr>`,
      ),
      `</tbody></table>`,
    );

  // Load
  parts.push(
    `<h2>Assignee load</h2>`,
    `<table><tbody><tr><th>Person</th><th>Open</th><th>In progress</th><th>Remaining pts</th><th>Done pts</th><th>Status</th></tr>`,
    ...result.assignees.map(
      (a) =>
        `<tr><td>${escapeXml(a.displayName)}${a.teams.length ? `<br/><em>${escapeXml(a.teams.join(', '))}</em>` : ''}</td><td>${a.openIssues}</td><td>${a.inProgress}</td><td>${a.remainingPoints}</td><td>${a.donePoints}</td><td>${a.overloaded ? `${statusMacro('OVERLOADED', 'Red')} ${escapeXml(a.reasons.join('; '))}` : statusMacro('OK', 'Green')}</td></tr>`,
    ),
    `</tbody></table>`,
  );

  // Confidence & method
  parts.push(
    `<h2>Data confidence</h2>`,
    `<ul>${result.confidence.reasons.map((r) => `<li>${escapeXml(r)}</li>`).join('')}</ul>`,
    panel(
      'info',
      `<p>Generated by Sprint Sentinel at ${escapeXml(result.generatedAt)} from live Jira data${result.graph.used ? ' and Atlassian Teamwork Graph' : ''}. Every finding is backed by the issue keys, dates and counts shown; nothing is inferred without data.</p>`,
    ),
  );
  return parts.join('\n');
}
