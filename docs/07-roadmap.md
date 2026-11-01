# SmartSeed — Development Roadmap

Each phase ends with: passing tests, updated docs, demo script, and a review gate. Effort figures are rough relative sizing (S/M/L/XL), not commitments.

| Phase | Size | Key deliverables | Exit criteria (acceptance) |
|---|---|---|---|
| 1 Requirements & architecture | M | docs/01–07 | Architecture review approved |
| 2 Foundation | L | npm-workspaces monorepo, Express+TS API skeleton, Postgres + migrations, auth (argon2id, JWT, refresh rotation, MFA), RBAC matrix, RLS tenancy, Compose env, CI skeleton | Authz matrix + tenant-isolation tests green; `docker compose up` works |
| 3 Supply chain core | XL | Products, batches, inventory ledger, transfers/shipments state machine, org workflows, web UI (React/Vite/Tailwind/React Query) | 10,000→5,000/3,000/2,000 scenario test; all validation rules tested |
| 4 Blockchain | XL | Fabric network (3 orgs, Raft), CAs, chaincode + tests, outbox worker, gateway adapter, ledger verifier | Tamper + node-failure tests; nothing shown "confirmed" before commit |
| 5 QR & passport | L | QR gen (batch/package), labels, revoke/regenerate, public verify API, scan log, passports | Four-part status logic tested incl. never-green-on-failed-chain |
| 6 Farmer app | L | Expo app, 12 screens, EN/TE/HI, offline cache w/ staleness label, push, TTS | Device tests for invalid/expired/offline/locale |
| 7 AI detection | L | Feature pipeline, rules (6 scenarios), Isolation Forest, stats, risk engine, model registry, drift job | Scenario tests; evaluation on synthetic data *labelled as synthetic* |
| 8 Investigation agent | L | Tool-calling agent, evidence schema, report generation, review actions | No-citation facts rejected; actions audited |
| 9 Risk management | L | Dashboard, alerts, SSE, analytics, reports, subscription metering + Razorpay interface | Dashboards from real queries only |
| 10 Hardening | L | Full test suites, perf tests, security tests, monitoring, backup/restore drill, CI/CD, deploy docs, readiness assessment | Coverage ≥80/75; perf results measured and recorded |

## Cross-cutting rules
- Every feature has an AC in `docs/01-requirements.md` and a test.
- PRs ≤ 400 lines diff, conventional commits, feature branches.
- Files ≤ 300 lines, functions ≤ 40 lines, ≤ 3 params.
- No placeholder critical workflows; third-party integrations ship an interface plus documented env config.

## Open questions for review
See the end of the chat summary / README "Decisions needed".

## Status (end of build session)
| Phase | Status |
|---|---|
| 1 Requirements & architecture | Done |
| 2 Foundation | Done, tested |
| 3 Supply chain core | Done, tested |
| 4 Blockchain | Chaincode + backend outbox/verifier/gateway done and tested against doubles; **Fabric network and live gateway unverified** |
| 5 QR infrastructure | Done, tested |
| 6 Farmer mobile app | Built and unit-tested; **not run on a device** |
| 7 AI/ML detection | Built and tested; synthetic-data ML, untuned thresholds; no accuracy claims |
| 8 Investigation agent | Built and tested (evidence-only path); live LLM path untested |
| 9 Risk management | Backend + web UI built; UI not run in a browser |
| 10 Hardening | Tests, coverage, security tests, smoke/perf, docs, CI written; load/pen/restore drills and container builds **not done** — see `docs/10-production-readiness.md` |
