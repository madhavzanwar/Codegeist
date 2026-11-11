/**
 * Runs the Forge CLI's own *client-side* linters (manifest schema, handlers, permissions/scopes,
 * Teamwork Graph, storage, timeouts, ...) without needing `forge login`.
 * `forge lint` additionally runs server-side checks once you are logged in — run both before deploying.
 *
 * Usage: node scripts/forge-lint-offline.cjs
 */
const path = require('path');
const { execSync } = require('child_process');

const globalRoot = execSync('npm root -g').toString().trim();
const cliModules = path.join(globalRoot, '@forge', 'cli', 'node_modules');
const req = (m) => require(path.join(cliModules, m));
const shared = req('@forge/cli-shared');
const lintPkg = req('@forge/lint');
const { LintService } = require(path.join(globalRoot, '@forge', 'cli', 'out', 'service', 'lint-service.js'));

const statsig = {
  checkGate: async () => false,
  getDynamicConfig: async () => null,
  getDeprecatedRuntimes: async () => [],
};
const logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
  debug: () => undefined,
  trace: () => undefined,
};

(async () => {
  process.chdir(path.join(__dirname, '..'));
  const reader = new shared.FileSystemReader();
  const writer = new shared.FileSystemWriter();
  const configFile = new shared.ConfigFile(reader, writer);
  const service = new LintService(configFile, reader, statsig, undefined);
  const { lintResults } = await service.run('production', { linterMode: 'client-side' }, logger);
  lintPkg.reportLintResults(logger, lintResults, true);
  const count = lintPkg.problemCount(lintResults);
  console.log(`\nForge client-side lint: ${count.errors} error(s), ${count.warnings} warning(s)`);
  process.exit(count.errors > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
