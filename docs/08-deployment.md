# SmartSeed — Deployment Guide

## 1. Components and scaling

| Component | Image / entry | Scales | State |
|---|---|---|---|
| `api` | `apps/api/Dockerfile` → `dist/server.js` | horizontally (stateless) | none |
| `worker` | same image, `dist/worker.js` | horizontally (`SKIP LOCKED` claims; per-batch ordering enforced in SQL) | none |
| `web` | `apps/web/Dockerfile` (nginx, static + `/v1` proxy) | horizontally | none |
| `ai` | `services/ai/Dockerfile` (FastAPI) | horizontally | model files (shared volume/object store) |
| PostgreSQL 16 | managed service recommended | vertical + read replicas | all business data |
| Redis 7 | managed | — | rate-limit counters only |
| Fabric peers/orderers/CAs | `infra/fabric` (UNVERIFIED scripts) | per Fabric topology | ledger |

Cloud-agnostic reference (Kubernetes or ECS): stateless tiers behind a TLS-terminating load balancer/WAF; Postgres with PITR; secrets from the cloud secret manager; Fabric on dedicated nodes with each independent organization running its own peer/orderer in production.

## 2. Environments
`NODE_ENV` ∈ development | test | staging | production. Configuration is environment variables only (`apps/api/.env.example` lists every variable). Never reuse secrets across environments. Production requirements the code enforces or expects:
- `JWT_PRIVATE_KEY/JWT_PUBLIC_KEY` (ES256), `FIELD_ENCRYPTION_KEY` (32 bytes base64), `AI_SHARED_SECRET`, `METRICS_TOKEN` from the secret manager.
- `CORS_ORIGINS` set to the exact web origin(s); `PUBLIC_VERIFY_BASE_URL` set to the public verification host used in QR codes.
- `SMTP_URL`/`EMAIL_FROM` (without it production email delivery fails loudly instead of pretending to send).
- Ledger: `FABRIC_PEER_ENDPOINT`, `FABRIC_PEER_TLS_CA_PATH`, `FABRIC_WALLET_DIR` (per-org identities), `APP_SIGNING_PRIVATE_KEY`. Without them the worker logs an error and ledger records stay `pending`.
- Optional: `ANTHROPIC_API_KEY` (LLM investigations; otherwise an evidence-only rule report), `RAZORPAY_*` (billing), Expo push needs no key for basic use.
- Database roles: migrations run as an owner role (`MIGRATE_DATABASE_URL`); the application connects as a non-owner role **without** `BYPASSRLS` (`infra/docker/postgres/init.sh` shows the dev role; provision the same in production).

## 3. First deployment
1. Provision Postgres, create the app role, run migrations (`docker compose run --rm migrate`, or `npm run db:migrate`).
2. Bootstrap the platform admin: `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run create-platform-admin -w @smartseed/api` (MFA enrolment is forced at first login).
3. Start `api`, `worker`, `ai`, `web`. Check `/readyz`, `/metrics` (with token) and that `smartseed_chain_oldest_pending_seconds` stays small once Fabric is connected.
4. Create plans (`POST /v1/platform/plans`); pricing lives in the database.
5. Register a tenant, approve it as platform admin, and run the journey from the README.

## 4. CI/CD
`.github/workflows/ci.yml` runs: API/web/shared typecheck, tests and build; chaincode tests; AI service lint-type-tests; mobile typecheck/tests; dependency audit, gitleaks, pip-audit; container builds with a Trivy scan. Deploy by promoting the built images; run migrations as a separate, reviewed step before rolling the application (migrations are forward-compatible by convention: add before use, remove after).

## 5. Rolling back
- **Application:** redeploy the previous image tag. Because migrations are additive, the previous version runs against the newer schema.
- **Database:** `down` migrations exist but destructive; prefer a forward fix. For corruption use point-in-time recovery (see operations runbook).
- **Chaincode:** Fabric lifecycle upgrades are versioned by sequence; roll back by committing the previous package as a new sequence (requires the multi-org approval policy).

## 6. Known gaps before production
See `docs/10-production-readiness.md`.
