# SmartSeed — Production Readiness Assessment

Honest status as of this build. "Verified" means executed by an automated test or build in the development environment; it does not mean validated in production conditions.

## 1. Verdict
**Not production-ready.** The application logic is implemented and extensively tested against a real PostgreSQL, but several infrastructure-dependent pieces were never executed because the build environment had no running Docker engine, no Fabric network, no phone/emulator, no LLM or payment credentials. Those must be validated (section 3) before any real farmer or manufacturer data touches the system.

## 2. What is verified
- **Backend (Node/TS):** the integration suite runs the real migrations on a real Postgres and covers tenancy (RLS fail-closed, cross-tenant 404s), authentication (argon2id, JWT algorithm confusion, refresh rotation and reuse revocation, lockout, MFA replay), authorization matrix for every route × role, supply-chain rules (10,000 → 5,000 + 3,000 split, concurrency-safe oversell protection, idempotency, expiry, route and recipient rules, state machine), QR/public verification (never green before ledger commit; revoked/superseded/unknown/expired handling; no tenant/org ids or quantities leaked), ledger outbox (ordering, retry/backoff, permanent failure blocks later events, tamper refusal, idempotent resubmission), ledger verifier, scoring pipeline, investigation agent (unsupported facts are dropped), human-review workflow, alerts/dashboard scoping, notifications (dedupe, preferences, delivery retry), billing (limits, webhook signature, idempotent webhooks, trial/grace sweep), SSE, OWASP-style abuse tests. Exact counts and coverage: `docs/11-testing.md`.
- **Chaincode:** 105 unit tests on a hand-written mock stub (roles, ownership/holder rules, append-only events, idempotency, status transitions). Backend ↔ chaincode **hash parity** and **input-schema conformance** are tested with the real chaincode schemas.
- **AI service:** 136 tests (detectors for all six brief scenarios, risk levels at boundaries, anti-double-counting, HMAC auth, model registry, determinism, false-positive check on benign data).
- **Farmer app / web UI:** unit and component tests, strict typecheck, production bundles build.

## 3. Not verified — required before go-live
| Area | Gap | Required action |
|---|---|---|
| Fabric network | `infra/fabric` scripts never executed; real `FabricGateway` never connected to peers; chaincode never deployed; endorsement, MVCC retry, node-failure and recovery drills not performed | Stand up the 3-org dev network under WSL2/Linux, deploy chaincode, run the full journey, then the Raft/peer failure drills; pin image tags |
| Independent governance | Production needs ≥2 independent organizations running peers/orderers (an authority org). Not arranged. | Onboard an agricultural authority as a validator org; set endorsement policy to `AND(SmartSeed, Authority)` |
| Containers | Compose and Dockerfiles never built/run | `docker compose up`, fix any build issues, run image scans (Trivy in CI) |
| Mobile | Never run on a device: camera scanning, TTS (Telugu/Hindi voices), push (needs a dev build + EAS project id), font rendering, accessibility | Device test matrix; native-speaker review of Telugu/Hindi strings |
| Web UI | Never opened in a browser against a live API; responsive layout, SSE streaming, blob downloads untested | Manual QA + Playwright E2E |
| AI/ML quality | Thresholds are untuned defaults; ML runs on synthetic data only; **no accuracy has been measured** and none is claimed | Collect real scans/labels, evaluate, tune, monitor drift (PSI utility exists) |
| LLM investigations | `AnthropicProvider` never called live; the evidence-only fallback is what was tested | Run against the live API with a staging key; review report quality |
| Billing | Razorpay REST and webhook mapping untested against the real gateway (webhook signature logic is tested) | Test-mode account, end-to-end checkout and webhook |
| Email/push | SMTP and Expo senders untested live | Configure and send real test messages |
| Performance | Only a smoke test on a laptop with an embedded database; no capacity, soak or ledger-throughput testing | Load test on production-like infrastructure; set and verify budgets (API p95, verify p95, chain latency) |
| Security | No external penetration test; no WAF/TLS validation; web keeps tokens in memory only (reload = sign in again; cookie+CSRF refresh planned) | Third-party pen test; TLS/WAF config review; production web auth flow |
| Backup/DR | Backup scripts untested at scale; no restore drill performed; RPO/RTO unknown | Run the quarterly drill from `docs/09-operations.md` and record real RTO/RPO |
| Secrets/KMS | Dev signer reads an env PEM; Fabric identities are file-based | KMS/HSM-backed signer and identity provider (interfaces exist) |

## 4. Known functional limits (by design for this version)
- Ledger commits cover registration, transfers, shipments, receipts, rejections, cancellations and retail sales. Farmer verification records, counterfeit reports and investigation outcomes exist in the chaincode but are not submitted by the backend; they are stored off-chain and audited.
- Investigation holds (transfers + batch) are operational database states; they are not mirrored as on-chain `HELD`.
- A single Fabric endorsement policy applies to all functions (Fabric lifecycle limitation); state-based endorsement per function is not implemented.
- Partner organizations are created by a tenant (new orgs only); sharing one organization across tenants is a platform-admin action.
- Notification preferences are per user and event type; SMS is not implemented (interface point only).
- `GET /alerts` listing, dashboards and the SSE stream poll the database; they are correct across instances but not optimised for very high volume. `qr_scans` is a single table (partition by month before heavy use).
- Plan limits are enforced for batches and users; scans and investigations are metered, not blocked.
- MFA recovery codes and password reset flows are not built.
- Field-encryption key rotation is a manual maintenance job (documented, not automated).

## 5. Go-live checklist
1. Fabric network validated end-to-end including failure drills; independent authority org onboarded.
2. Containers built, scanned, deployed to staging; migrations rehearsed; rollback rehearsed.
3. Staging soak and load tests against budgets; record the results.
4. Pen test completed; findings fixed; WAF/TLS reviewed.
5. Restore drill completed with recorded RTO/RPO.
6. Device test of the farmer app in English, Telugu and Hindi; translations reviewed.
7. Monitoring and on-call alerts from `docs/09-operations.md` live.
8. Legal/privacy review (farmer pseudonymous data, consent, retention), Razorpay account compliance.
