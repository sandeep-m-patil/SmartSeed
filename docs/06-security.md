# SmartSeed — Security Architecture (Phase 1)

## 1. Threat model (STRIDE highlights)
| Threat | Example | Control |
|---|---|---|
| Spoofing | Stolen token, forged farmer scans | Short JWT, refresh rotation + reuse detection, MFA for privileged roles, device attestation hash, scan rate limits |
| Tampering | Admin edits DB history | Append-only tables + revoked grants, hash-chained audit log, ledger verifier, independent backups, multi-org endorsement |
| Repudiation | "I never sent that batch" | Dual signatures (Fabric org identity + app-level), audit log |
| Information disclosure | Tenant A reads tenant B | RLS forced, tenant from token only, 404 not 403 on foreign IDs, cross-tenant leakage test suite; public API returns minimal passport |
| DoS | QR scan flood | Redis token-bucket per IP/token/device, WAF, queue-backed scan logging |
| Elevation | Role escalation | Deny-by-default permission matrix, server-side checks, chaincode attribute checks |
| Cloned QR on fake packet | Valid QR copied | Duplicate/geo/frequency analytics, package-level IDs, revocation, never claim "genuine" from QR alone |
| Prompt injection | Malicious text in reports/notes reaching the agent | Retrieved text treated as data; read-only tools; schema-validated output; no execution of output |

## 2. Authentication and sessions
argon2id (memory ≥ 64 MiB, t ≥ 3), constant-time compare, breached-password check, lockout/backoff. Access JWT (ES256, 10–15 min, `kid` rotation). Refresh tokens opaque, hashed at rest, rotated each use, httpOnly+Secure+SameSite=Strict cookie on web (CSRF double-submit for cookie-authed routes), secure storage on mobile. TOTP with encrypted secret and recovery codes.

## 3. Authorization
`permission = f(role, tenant, org, resource state)`. Layers: route middleware (permission), service (ownership/state), DB (RLS), chain (attributes). Every sensitive endpoint has a negative test per role.

## 4. Data protection
TLS 1.2+ everywhere (HSTS), mTLS between internal services in staging/prod. Encryption at rest (DB, object storage); field-level encryption (AES-256-GCM, KMS data keys) for MFA secrets, phone numbers. Farmer data minimised and pseudonymous; IP stored hashed with rotating salt; precise geolocation never stored (rounded to ~1 km). Retention policy configurable; DPDP Act-style consent and deletion flows for farmer profiles.

## 5. Application hardening
Zod validation at boundary; parameterised SQL only (lint rule forbids template-string queries); output encoding in React + CSP (no inline script); helmet; strict CORS allowlist per env; request size limits; file upload type/size sniffing + AV scan hook, pre-signed URLs; SSRF guard on outbound fetches; structured error responses without stack traces; dependency scanning (npm audit, pip-audit, Trivy, Dependabot), SAST (CodeQL), secret scanning (gitleaks) in CI.

## 6. Secrets and keys
Env vars locally via `.env` (git-ignored, `.env.example` committed); cloud secret manager in staging/prod; Fabric and signing keys in KMS/HSM; separate keys per environment; rotation runbook.

## 7. Separation of duties
Roles for DB: `app_rw` (RLS-bound), `migrator`, `audit_ro`, `analytics_ro`. Platform admin cannot alter chain data (no chain write path for admins except via defined chaincode functions with co-endorsement). Production changes via CI only; break-glass access logged and alerted.

## 8. Audit and monitoring
Audit event for every auth event, permission denial, state change, admin action, auditor access, investigation decision. Hash-chained; periodic anchor hash committed to Fabric. Alerts on: failed-login spikes, refresh reuse, RLS-bypass usage, ledger mismatch, outbox stall.

## 9. Backup and recovery
Postgres PITR + daily snapshot to a separate account; object storage versioning; Fabric ledger and wallet backups by a second org; quarterly restore drills. RPO/RTO targets set in Phase 10 and proved by drill, not asserted.

## 10. Security testing plan
OWASP Top 10 checklist mapped to tests; authz matrix test; tenant-leak fuzz across all list/get endpoints; auth attack tests (brute force, refresh replay, JWT alg confusion); rate-limit tests; ZAP baseline in CI; chaincode negative tests.
