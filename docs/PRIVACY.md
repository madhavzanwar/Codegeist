# Sprint Sentinel — Privacy & Security

**Runs on Atlassian.** Sprint Sentinel is a Forge app with no egress: it calls only Atlassian APIs (Jira, Confluence,
Teamwork Graph) from Atlassian-hosted functions. No data leaves the Atlassian platform and no third-party services,
analytics or trackers are used.

## Data processed
- Jira issues in the analysed sprint (summary, status, assignee, dates, story points, labels, links, description text,
  comments, changelog sprint entries), read **as the requesting user**.
- Teamwork Graph: the teams of each assignee and their assigned work-item keys/resolution state (read as the user;
  only if the admin grants the graph scopes).

## Data stored (Forge KVS, in your site's data-residency location)
- Per-project settings (thresholds, report space key).
- Sprint snapshots for the trend (scores, per-issue scores, counts; last 30 runs per sprint).
- Single-use confirmation tokens (operation, argument hash, account id; expire after 15 minutes, deleted on use).
- A short-lived analysis cache (≤ 5 minutes freshness) and demo-seeder progress.
No credentials or secrets are stored. Uninstalling the app deletes its storage per Forge policy.

## Writes
The app writes to Jira/Confluence only after a user previews and explicitly confirms the change, using a token that
is bound to that user, the operation and the exact arguments. Every comment it posts carries an attribution footer.

## Contact
Open an issue on the project repository for support or security reports.
