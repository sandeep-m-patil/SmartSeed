# SmartSeed — Operations Runbook

## Monitoring (what to alert on)
Metrics at `/metrics` (bearer `METRICS_TOKEN`), logs are structured JSON (pino) with `requestId`.

| Signal | Alert when | Meaning / first action |
|---|---|---|
| `smartseed_chain_oldest_pending_seconds` | > 600 for 10 min | Ledger not committing. Check worker logs, Fabric peer health, identity wallet. Public verification stays YELLOW (never green) meanwhile. |
| `smartseed_chain_records{status="failed"}` | > 0 | A chaincode rejection blocks that batch's later events. Inspect `blockchain_transactions.last_error`; resolve cause; reset the row to `pending` only after the cause is fixed. |
| `smartseed_jobs{status="failed"}` / queued growth | rising | Worker or AI service down; see below. |
| `smartseed_open_alerts{severity="CRITICAL"}` | > 0 | Human investigation required (dashboard). |
| `http_request_duration_seconds` p95, 5xx rate | SLO breach | Standard API triage; check Postgres. |
| Audit/ledger: alert type `LEDGER_MISMATCH` | any | Treat as a security incident (possible tampering). |

## Runbooks
**Ledger mismatch.** 1) Do not edit rows. 2) Pull `verifyBatchLedger` result (which event, `database_hash` vs `ledger_hash`). 3) `database_hash`: compare with the independent backup and the audit chain (`verifyAuditChain`); determine who changed the row. 4) `ledger_hash`: investigate the submitting identity and the chaincode history for that event. 5) Record the outcome through the investigation workflow.

**Blockchain outage.** Business operations continue; events queue as `pending` and commit in order after recovery. Nothing is shown as confirmed meanwhile. After recovery watch the oldest-pending gauge fall to zero and run ledger verification.

**AI service outage.** `score_batch` jobs retry with backoff (6 attempts) then fail; scans and verification keep working with the last stored score. Restore the service, then re-enqueue scoring for affected batches (insert `score_batch` jobs).

**Notification failures.** Delivery jobs retry with backoff; failed rows keep `sent_at` NULL. Fix SMTP/Expo configuration and re-queue.

**Tenant suspended unexpectedly.** The daily subscription sweep suspends tenants whose subscription has been `past_due`/`cancelled` beyond `BILLING_GRACE_DAYS`. Reactivate via `PATCH /v1/platform/tenants/:id {status: active}` after fixing billing.

## Backup and recovery
- **PostgreSQL:** continuous WAL archiving / managed PITR plus a daily logical dump (`scripts/backup/pg-backup.sh`) to a **separate account/bucket** with versioning and a retention policy. The application role cannot delete audit rows (append-only trigger + no DELETE grant).
- **Ledger:** peers of at least two independent organizations hold full copies; back up each peer's ledger volume and the CA databases independently.
- **Keys/wallets:** per-org Fabric identities and the application signing key live in the secret manager/KMS with versioning; document the rotation procedure and test restore.
- **Object storage / AI models:** versioned bucket; models are reproducible from `scripts/train_baseline.py` + data.
- **Restore drill (quarterly):** restore the latest dump into a scratch instance, run `npm run db:migrate` (no-op), run `verifyAuditChain` for every tenant and `verifyBatchLedger` for a sample of batches, and record the elapsed time as the measured RTO. RPO/RTO targets are **not asserted** until a drill has produced them.

## Key and secret rotation
JWT signing key: introduce a new key pair, deploy, wait one access-token lifetime (≤15 min) and refresh-token TTL, retire the old. Field-encryption key: re-encrypt `users.mfa_secret_enc`, `qr_codes.token_enc`, `public_devices.push_token_enc` with a new key in a maintenance job before switching (not automated yet). Fabric/app signing keys: enrol the new identity, register its certificate, revoke the old (CA CRL).

## Access and change control
Production changes only via CI-built images; no shared admin accounts; break-glass database access must be logged and reviewed. Platform admins cannot change ledger history; privileged actions are in the hash-chained audit log.
