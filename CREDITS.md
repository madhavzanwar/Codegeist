# Credits

Sprint Sentinel is original work written for Codegeist 2026. No code was copied from other hackathon entries.

## Atlassian references (studied, not copied)
| Source | License | How it helped |
|---|---|---|
| [atlassian-labs/forge-inspired](https://github.com/atlassian-labs/forge-inspired) — `sprint-ready-agent`, `team-pulse-board` | Apache-2.0 | Write-after-confirm Rovo agent pattern; why a Jira module is needed for cross-product calls |
| [Forge documentation](https://developer.atlassian.com/platform/forge/) — Rovo Agent/Skill/MCP/Action, App compatibility, Distribution | — | Manifest syntax and platform rules (see `docs/RESEARCH.md`) |
| [Teamwork Graph docs](https://developer.atlassian.com/platform/teamwork-graph/) — curated queries, scopes | — | Query shape and scope model |
| Atlassian Design System tokens (`--ds-*`) | — | Colours/elevation via `view.theme.enable()` |

## Runtime libraries
| Package | License | Use |
|---|---|---|
| `@forge/api`, `@forge/kvs`, `@forge/resolver`, `@forge/bridge` | Atlassian (see package LICENSE) | Forge runtime, storage, resolvers, UI bridge |
| `zod` | MIT | Input validation for write operations |
| `react`, `react-dom` | MIT | Custom UI |

## Tooling
| Package | License | Use |
|---|---|---|
| `@forge/cli` | Atlassian | Deploy/install; its client-side linters are reused offline by `scripts/forge-lint-offline.cjs` |
| `vite`, `@vitejs/plugin-react` | MIT | UI build and mock dev server |
| `typescript` | Apache-2.0 | Types |
| `vitest`, `@vitest/coverage-v8` | MIT | Unit tests and coverage |
| `eslint`, `typescript-eslint`, `@eslint/js`, `globals` | MIT | Linting |
| `tsx` | MIT | Runs the seed CLI |
| `playwright` | Apache-2.0 | Screenshot script |

## Method
- Cycle detection uses Tarjan's strongly connected components algorithm (1972).
- Chart design follows a colour-blind-safe categorical palette and "thin marks, recessive axes" guidance.

The icon (`static/app/public/sentinel.svg`) and all copy were created for this project.
