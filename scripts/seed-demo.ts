/**
 * Seed a realistic demo sprint into a Jira Cloud site from your terminal.
 *
 *   export JIRA_SITE=https://your-site.atlassian.net
 *   export JIRA_EMAIL=you@example.com
 *   export JIRA_API_TOKEN=...            # https://id.atlassian.com/manage-profile/security/api-tokens
 *   npm run seed -- --project SEN --create-project
 *
 * Without --create-project the project must already exist and use the Scrum template.
 * The same seeder also runs inside the app ("Load demo sprint data" button) without any token.
 * Credentials are read from the environment only and never written anywhere.
 */
import type { HttpResponse, Requester } from '../src/jira/http';
import { requestJson } from '../src/jira/http';
import { initialState, runNextStep } from '../src/seed/executor';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const site = process.env.JIRA_SITE?.replace(/\/$/, '');
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const projectKey = (arg('project') ?? process.env.PROJECT_KEY ?? 'SEN').toUpperCase();
  if (!site || !email || !token) {
    console.error('Set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN (see the header of this file).');
    process.exit(1);
  }
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  const req: Requester = async (path, init) =>
    (await fetch(`${site}${path}`, { ...init, headers: { ...init?.headers, Authorization: auth } })) as unknown as HttpResponse;

  if (process.argv.includes('--create-project')) {
    const me = await requestJson<{ accountId: string }>(req, '/rest/api/3/myself');
    try {
      await requestJson(req, '/rest/api/3/project', {
        method: 'POST',
        body: {
          key: projectKey,
          name: `Sprint Sentinel Demo (${projectKey})`,
          projectTypeKey: 'software',
          projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-scrum-classic',
          leadAccountId: me.accountId,
          assigneeType: 'UNASSIGNED',
        },
      });
      console.log(`Created Scrum project ${projectKey}.`);
    } catch (e) {
      console.warn(`Could not create project ${projectKey} (${(e as Error).message.slice(0, 160)}). Continuing with the existing project.`);
    }
  }

  let state = initialState(projectKey, new Date());
  while (!state.done) {
    const step = await runNextStep(req, state, new Date());
    state = step.state;
    console.log(`[${Math.round(step.progress * 100)}%] ${step.message}`);
  }
  console.log(`\nDone. Open ${site}/jira/software/projects/${projectKey} → "Sprint Sentinel" tab, or ask the agent: "Is the ${projectKey} sprint on track?"`);
}

main().catch((e: unknown) => {
  console.error(`Seeding failed: ${(e as Error).message}`);
  process.exit(1);
});
