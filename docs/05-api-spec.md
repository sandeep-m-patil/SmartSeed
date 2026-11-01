# SmartSeed — API Specification (as built)

Base `/v1`. JSON envelope `{ "data", "meta", "error" }`; errors are `{ code, message, details? }`. Lists are cursor-paginated (`?limit=1..100&cursor=`; next cursor in `meta.nextCursor`). Auth: `Authorization: Bearer <JWT>` (ES256, ≤15 min); the tenant and organization come only from the verified token. Stock-moving calls require an `Idempotency-Key` header (8–100 chars). Rate limits return `429` + `Retry-After`. Machine-readable schemas live in `packages/shared/src/schemas.ts` (Zod) and are the source of truth for request validation. The role/permission matrix is `packages/shared/src/rbac.ts`.

| Permission → who | |
|---|---|
| `platform:*`, `alert/investigation:decide` | platform_admin |
| user/org/billing/QR/risk management | company_admin |
| product/batch/QR | manufacturer (+ read for company_admin) |
| transfer:receive, inventory | distributor, wholesaler, retailer (`sale:record` retailer only) |

## Auth
`POST /auth/login` → session, or `{mfaRequired, mfaEnrollmentRequired, mfaToken}` · `POST /auth/mfa/enroll` · `POST /auth/mfa/verify` · `POST /auth/refresh` (rotating; reuse revokes the family) · `POST /auth/logout` · `GET /auth/me` → `{id,email,fullName,tenantId,orgId,orgType,orgName,roles}` · `POST /tenants/register` (public; tenant starts `pending`).

## Platform administration
`GET /platform/tenants` · `PATCH /platform/tenants/:id {status: active|suspended}` · `POST /platform/tenants/:id/organizations {orgId}` (link a shared org) · `GET /platform/audit-logs` · `GET/POST /platform/plans` · `PUT /platform/tenants/:id/subscription {planCode,status}` · `POST /platform/tenants/:id/billing/checkout {planCode}` (Razorpay; 501 until configured).

## Tenant administration
`GET/POST /users` (role ∈ company_admin, manufacturer) · `GET /audit-logs` · `GET/POST /organizations` (create a **new** partner distributor/wholesaler/retailer with its first user) · `GET /subscription` · `GET /usage` · `GET /invoices`.

## Catalogue and inventory
`POST/GET /products`, `GET/PATCH /products/:id` · `POST/GET /batches`, `GET /batches/:id` (holdings), `GET /batches/:id/timeline`, `GET /batches/:id/passport` (full) · `GET /inventory` (own holdings) · `GET /inventory/:batchId/movements`.

## Transfers and sales
`POST /transfers` · `GET /transfers?status=&direction=incoming|outgoing` · `GET /transfers/:id` · `POST /transfers/:id/dispatch|transit|cancel` (sender) · `POST /transfers/:id/accept {receivedQuantity?}` · `/reject {reason}` (receiver) · `POST /sales` (retailer). Transfer lifecycle: created → dispatched → in_transit → received | rejected | cancelled; `underInvestigation` blocks progress. Allowed routes: manufacturer→distributor; distributor→distributor|wholesaler|retailer; wholesaler→retailer; the recipient must be a partner of the batch's tenant.
Every state-changing response is followed by ledger work; chain state is visible on `GET /batches/:id/timeline` as `chainStatus: pending|submitted|committed|failed` with `chainTxId` only when committed.

## QR and passports
`POST /batches/:id/qr` · `POST /batches/:id/packages {count≤5000}` · `GET /batches/:id/qr` · `GET /qr/:id/download?format=png|svg|label` · `POST /qr/:id/revoke|regenerate {reason}` · `GET /qr/:id/scans`.

## Public (no account; rate limited)
| Method | Path | Notes |
|---|---|---|
| GET | `/public/verify/:token[?lat&lon]` + optional `X-Device-Id` (UUID) | Simplified passport + four independent statuses. Logs a scan, queues scoring. Unknown token → HTTP 200, `digitalIdentity: UNKNOWN`, RED. |
| POST | `/public/devices` | pseudonymous device + optional push token + language (`en|te|hi`) |
| POST | `/public/reports {token, description?, region?}` | raises/refreshes one MEDIUM alert for human review |
| GET | `/public/notifications?deviceId=` | |

Verify `data`: `product|null, manufacturer|null, batch|null, package|null, certifications[], journey[{step,orgType,at,status: CONFIRMED|PENDING|FAILED}], verification{digitalIdentity, blockchain, scanActivity, investigation}, risk{score,level,assessed}, indicator, warnings[codes], asOf`.
`indicator` is `GREEN` only if identity VALID ∧ blockchain VERIFIED ∧ scanActivity NORMAL ∧ investigation NONE ∧ risk LOW ∧ not expired. `blockchain` is VERIFIED only when **every** ledger-bound event of the batch is committed and the ledger verifier has not flagged a mismatch.

## Risk, alerts, investigations
`GET /risk/overview`, `GET /risk/analytics` (platform admin = all tenants; others = own tenant; org users without a tenant get 403) · `GET /alerts?level=&status=&from=&to=&productId=&batchId=&orgId=&investigationStatus=` · `GET /alerts/:id` · `PATCH /alerts/:id {assigneeId}` · `GET /investigations?status=` · `GET /investigations/:id` · `POST /investigations/:id/actions {action, note?, outcome?}` with actions `mark_under_investigation | request_verification | confirm_suspicious | dismiss_false_positive | escalate_manufacturer | escalate_authority | mark_resolved` (resolve requires `outcome: confirmed_counterfeit|cleared|inconclusive`).
Investigation reports separate `observed_fact` (must cite retrieved record ids), `model_interpretation` and `hypothesis`; unsupported facts are dropped server-side and counted in `droppedFindings`.

## Notifications, events, billing
`GET /notifications` · `POST /notifications/:id/read` · `GET/PUT /notification-preferences` · `GET /events` (SSE: `alert.created`, `notification.created`) · `POST /billing/webhook` (signature-verified gateway webhook).

## Operations
`GET /healthz` (liveness) · `GET /readyz` (database) · `GET /metrics` (only when `METRICS_TOKEN` is set; bearer-protected).

## Internal contract: API → AI service
`POST {AI_SERVICE_URL}/v1/score` with `X-Signature` = hex HMAC-SHA256(raw body, `AI_SHARED_SECRET`) and `X-Timestamp` (epoch s, ±5 min). Schema: `services/ai/app/schemas.py`. The service reports `mode: rules+unsupervised` until a supervised model is loaded.
