# SmartSeed — Testing, Measurements and Acceptance

All figures below come from real runs on the development machine (Windows 11, Node 24, Python 3.11, **embedded PostgreSQL 18** — production targets PostgreSQL 16). They are evidence of correctness, not capacity claims.

## Test inventory (last full run)
| Suite | Command | Result |
|---|---|---|
| API integration + unit (real migrations, real Postgres) | `npm test -w @smartseed/api` | **191 passed** in 13 files |
| API coverage (`--coverage`) | thresholds 80% lines / 75% branches | **92.2% lines, 78.9% branches, 89.7% statements, 91.1% functions** |
| Chaincode | `cd chaincode/smartseed-cc && npm test` | **105 passed** (98.8% lines / 95.9% branches, per its own run) |
| AI service | `cd services/ai && .venv/Scripts/python -m pytest` | **136 passed** (99% coverage per its own run) |
| Web | `npm test -w @smartseed/web` | **84 passed** in 12 files; `vite build` succeeds |
| Farmer app | `cd apps/mobile && npx jest` | **115 passed** in 6 suites; `tsc` clean; Android bundle export succeeded (agent run) |

Coverage notes: API coverage excludes the two process entrypoints (`src/server.ts`, `src/worker.ts`, which only wire configuration and need a live stack). `src/blockchain/fabricGateway.ts` live-network methods remain largely uncovered (≈34%): only error classification and identity loading are tested, because there is no Fabric network in the test environment.

## What each area proves (acceptance criteria → tests)
| Requirement | Acceptance criterion | Test file(s) |
|---|---|---|
| FR-TEN tenancy | tenant A can never read/write tenant B; RLS fails closed; suspended tenants blocked; plan limits enforced (402) | `tenancy`, `supply`, `security`, `ops` |
| FR-AUTH | refresh reuse revokes family; MFA mandatory and non-replayable; lockout; alg=none/forged/expired tokens rejected | `auth`, `security` |
| FR-AUTH-3 RBAC | every route × every role returns exactly the expected status; DB permission seed equals the code matrix | `authz` |
| FR-CAT / inventory | 10,000 → 5,000 + 3,000 leaves 2,000; concurrent oversell impossible; duplicate (idempotent) requests collapse; no negative stock; expired/held batches cannot move | `supply` |
| FR-SC lifecycle | illegal transitions return 409; only the designated receiver can accept; variance becomes a discrepancy | `supply` |
| FR-BC | outbox ordering, retry, permanent failure blocks later events, tamper refusal, hash/signature checks, ledger verifier flags mismatches; chain statuses never "confirmed" before commit | `blockchain`, `chaincodeContract` |
| Ledger/DB parity | canonical hashing and commitments equal the chaincode vectors; every built call satisfies the chaincode's strict input schemas | `chaincodeContract` |
| FR-QR | 192-bit tokens stored hashed; batch/package QR; download png/svg/label; revoke/regenerate; scans logged with rounded location and hashed identifiers | `qr` |
| Verification honesty | GREEN only if all checks clean; valid QR alone ≠ genuine; unknown/revoked/expired/mismatch handled; no tenant/org ids or quantities leak | `qr`, `blockchain` |
| FR-AI / risk | all six brief scenarios, level boundaries, double-counting guard, HMAC auth, no accuracy claims | AI service pytest |
| Scoring integration | real records sent to the AI service; predictions + score history stored; alerts deduplicated; only HIGH/CRITICAL alert | `risk` |
| FR-INV | every observed fact cites retrieved records (unsupported facts dropped); model failure falls back to evidence-only; all seven human actions audited; Critical cases need a human; closed investigations immutable | `risk`, `clients` |
| FR-RISK dashboards | figures computed from live data and scoped per tenant; org users without a tenant denied | `risk` |
| FR-NOT | dedupe per recipient/channel, preferences honoured, delivery retry, farmer push on critical batches, expiry warnings once per window, SSE tenant-scoped | `ops` |
| Billing | limits, usage, plan CRUD, signed idempotent webhooks, trial→past_due→suspended policy | `ops`, `clients` |
| Security (OWASP) | injection strings inert, XSS stored as inert data with nosniff/CSP, no stack traces, mass assignment ignored, IDOR probes 404, CORS allow-list, body limit 413, rate limits, audit of failures, metrics endpoint protected | `security` |

## Measured latency (smoke test)
`npm run perf -w @smartseed/api` (single API process, embedded Postgres, 20 concurrent clients, laptop):

| Endpoint | n / concurrency | p50 | p95 | p99 | throughput |
|---|---|---|---|---|---|
| `GET /v1/public/verify/:token` | 400 / 20 | 119 ms | 249 ms | 434 ms | 149 req/s |
| `GET /v1/batches` (authenticated list) | 400 / 20 | 78 ms | 108 ms | 118 ms | 250 req/s |
| `POST /v1/transfers` (all on **one** batch) | 200 / 10 | 62 ms | 409 ms | 1288 ms | 82 req/s |

Interpretation: results include the machine running the load generator, the database and the API together, so they are pessimistic for the API alone and meaningless as capacity numbers. Transfers on a single batch serialise on the per-batch advisory/row locks by design (that is what prevents oversell); the p99 reflects that queueing. Budgets from the requirements (verify p95 ≤ 500 ms, API read p95 ≤ 300 ms) were met in this smoke test only; **they are not verified for production**. Not yet measured: blockchain commit latency/throughput, AI inference latency under load, concurrent-user capacity, query plans at realistic data volumes.

## Not tested (see `docs/10-production-readiness.md`)
Live Fabric network and failure drills, container builds, real devices/browsers, live LLM/Razorpay/SMTP/Expo, penetration testing, load/soak testing, restore drills.

## Process smoke test
`npm run build -w @smartseed/api && npm run smoke -w @smartseed/api` boots the **built** `dist/server.js` and `dist/worker.js` against a throwaway Postgres: `/readyz` 200, tenant registration 201, bearer-protected `/metrics` 200, the worker completes its scheduled sweeps and logs that Fabric is not configured (ledger records stay pending). This covers the entrypoint wiring excluded from coverage.
