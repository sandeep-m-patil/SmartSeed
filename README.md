# SmartSeed

Blockchain-based seed supply-chain traceability, counterfeit detection and AI risk management — a multi-tenant SaaS.

A manufacturer registers a product and batch → unique QR identities are issued → the batch moves manufacturer → distributor → (wholesaler) → retailer → farmer, with every step recorded in an append-only database ledger and committed to Hyperledger Fabric through a transactional outbox → farmers scan the QR in a mobile app and see four **independent** statuses (digital identity, blockchain history, scan activity, investigation) → an anomaly engine scores scans and transactions → an investigation agent explains flagged batches from retrieved records only → humans decide, and every decision is audited.

## What exists and how far it is verified

| Component | Location | Verification (what was actually run) |
|---|---|---|
| Backend API + worker (Node/TS, Postgres RLS tenancy, auth/MFA, RBAC, supply chain, QR, passport, risk, alerts, investigations, notifications, billing) | `apps/api` | Automated integration suite against a real Postgres (embedded): see `docs/11-testing.md`. Production bundle builds. |
| Web app (React/Vite/Tailwind) | `apps/web` | Unit/component tests + production build. **Not exercised in a browser against a live backend.** |
| Chaincode (Fabric, TypeScript) | `chaincode/smartseed-cc` | 105 unit tests on a mock stub; hash parity and call-schema conformance verified from the backend tests. **Never deployed to a real peer.** |
| Fabric network scripts | `infra/fabric` | Syntax-checked only. **Never run (Docker was unavailable).** |
| AI detection service (Python/FastAPI) | `services/ai` | 136 pytest tests (rules, risk engine, auth, model registry). Runs rules + statistics; ML parts use **synthetic** data and report no accuracy figures. Docker image not built. |
| Farmer app (Expo/React Native, EN/TE/HI) | `apps/mobile` | Jest tests, `tsc`, Android bundle export. **Not run on a device or emulator**; Telugu/Hindi strings need native-speaker review. |
| Docker Compose, Dockerfiles, CI | root, `.github` | Written; **not run** (no Docker engine in the build environment). |

Anything marked "never run" must be validated on a real environment before production — see [`docs/10-production-readiness.md`](docs/10-production-readiness.md).

## Documents
[Requirements](docs/01-requirements.md) · [Architecture](docs/02-architecture.md) · [Blockchain](docs/03-blockchain.md) (incl. as-built decisions) · [Database](docs/04-database.md) · [API (as built)](docs/05-api-spec.md) · [Security](docs/06-security.md) · [Roadmap](docs/07-roadmap.md) · [Deployment](docs/08-deployment.md) · [Operations](docs/09-operations.md) · [Production readiness](docs/10-production-readiness.md) · [Testing & acceptance](docs/11-testing.md)

## Layout
```
apps/api          Express+TS API (src/<module>), worker (src/worker.ts), SQL migrations
apps/web          Web app
apps/mobile       Farmer app (standalone Expo project, not an npm workspace)
packages/shared   Zod schemas + RBAC matrix shared by api/web
services/ai       FastAPI detection + risk-scoring service
chaincode/        Fabric chaincode (standalone package)
infra/            docker (postgres init), fabric (network scripts, UNVERIFIED)
scripts/backup    pg backup + restore drill
docs/             architecture, API, operations, readiness
```

## Run locally
Prerequisites: Node 20+, Docker Desktop (for the full stack), Python 3.11 (AI service).

```bash
npm install
docker compose up -d postgres redis            # Postgres on host port 5433
cd apps/api && cp .env.example .env && node scripts/genKeys.mjs   # paste the 3 lines into .env
export MIGRATE_DATABASE_URL=postgres://postgres:postgres@localhost:5433/smartseed
npm run migrate -- up
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='Your-Strong-Pass1' npm run create-platform-admin
npm run dev            # API :4000        (new terminals:)
npm run worker         # background jobs, ledger outbox, notifications
npm run dev:web        # from repo root; web :5173
```
AI service: `cd services/ai && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt && set AI_SHARED_SECRET=… && .venv\Scripts\python -m uvicorn app.main:app --port 8000` (set the same secret in `apps/api/.env`). Fabric: follow `infra/fabric/README.md` (WSL2/Linux + Docker); without it ledger events stay **pending** and the product never shows anything as blockchain-confirmed. Mobile: `cd apps/mobile && npm install && npx expo start` (see its README).

### Demonstrating the journey (also covered by automated tests)
1. Register a tenant (`POST /v1/tenants/register`), approve it as platform admin, log in (MFA enrolment is forced for admins).
2. As company admin create a manufacturer user and partner organizations (distributor, retailer) — `POST /v1/users`, `POST /v1/organizations`.
3. As manufacturer: create a product and a batch, generate the batch QR, download the label.
4. Transfer to the distributor; dispatch; the distributor accepts; transfer onward to the retailer; the retailer records a sale.
5. Scan the QR (`GET /v1/public/verify/:token` or the mobile app). With the ledger connected the batch becomes **VERIFIED** and the indicator can turn green; without it the indicator stays yellow.
6. Repeated scans from distant places raise a risk score → alert → investigation report → human decision under **Investigations**.

## Tests
```bash
npm test -w @smartseed/api          # full backend suite; boots an embedded Postgres, no Docker needed
npm test -w @smartseed/web
(cd chaincode/smartseed-cc && npm test)
(cd services/ai && .venv/Scripts/python -m pytest -q)
(cd apps/mobile && npx jest)
npm run perf -w @smartseed/api       # opt-in latency smoke test (not a capacity claim)
```

## Key design rules (enforced in code and tests)
- Tenant isolation: Postgres RLS (forced) + tenant derived from the verified token only; cross-tenant ids return 404.
- Never show "blockchain confirmed" before a real commit; public GREEN requires identity valid ∧ chain verified ∧ scans normal ∧ no investigation ∧ low risk ∧ not expired.
- Inventory: append-only ledger, row locks, idempotency keys; no negative stock, no oversell, no expired dispatch.
- Corrections are new events; events, audit and decisions are append-only; audit is hash-chained.
- No PII or documents on the ledger; quantities are salted commitments.
- The AI never declares a product counterfeit; reports cite only retrieved records; humans decide.
