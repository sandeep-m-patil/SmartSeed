# SmartSeed — Requirements Specification (Phase 1)

Status: **DRAFT for architecture review**. Each requirement has an ID and an acceptance criterion (AC).

## 1. Scope and actors

| Actor | Tenant-scoped | Surface | Purpose |
|---|---|---|---|
| Platform Admin | No | Web | Org approval, subscriptions, network health, global risk |
| Company Admin (per tenant) | Yes | Web | Users, policies, risk dashboard for own tenant |
| Manufacturer | Yes | Web | Products, batches, QR, transfers |
| Distributor / Wholesaler / Retailer | Yes (own org) | Web | Receive, inventory, transfer, sell |
| Farmer | No account required | Mobile + public web | Scan, verify, report |
| Auditor / Authority | Cross-tenant, read-mostly | Web | Provenance, investigations, compliance |

**Tenant model decision.** A *tenant* is a seed manufacturing company. Downstream parties (distributors, wholesalers, retailers) are *organizations* that may trade with several tenants. They are therefore modelled as `organizations` with relationship rows to tenants (see `04-database.md`), and they only ever see batches/transfers in which they are a party.

## 2. Functional requirements

### FR-TEN Tenancy and subscriptions
- **FR-TEN-1** Tenant registration with platform-admin approval/suspension. *AC:* an unapproved tenant cannot log in; a suspended tenant gets 403 on all writes and reads except billing.
- **FR-TEN-2** Tenant isolation at DB (Postgres RLS), API (tenant from verified token, never from body), and chain (channel/private data). *AC:* automated test where tenant A's token requesting tenant B resources by valid ID returns 404 for every endpoint.
- **FR-TEN-3** Configurable plans, trials, usage metering (batches, scans, users, AI investigations, storage), limits, invoices, Razorpay integration interface. *AC:* exceeding a plan limit returns `402/403` with a machine-readable code; pricing lives in DB, not code.

### FR-AUTH Identity and access
- **FR-AUTH-1** Email+password (argon2id), JWT access ≤15 min, rotating refresh tokens with reuse detection. *AC:* replaying a used refresh token revokes the token family.
- **FR-AUTH-2** TOTP MFA mandatory for Platform Admin, Company Admin, Auditor. *AC:* these roles cannot obtain a full-scope token without MFA.
- **FR-AUTH-3** RBAC with permission matrix enforced server-side; deny by default. *AC:* matrix-driven test hits every route with every role.

### FR-CAT Products and batches
- **FR-CAT-1** Product registration (all fields in brief §6) with certification and documents (object storage). 
- **FR-CAT-2** Batch creation with unique IDs, quantity, unit, dates, facility, certificate docs, QR identity. *AC:* expiry ≤ manufacture date rejected.
- **FR-CAT-3** Inventory ledger: every quantity movement is an append-only row; balance derived/verified. *AC:* concurrent transfers totalling > available never succeed (row-level lock + CHECK ≥ 0); 10,000 → 5,000 + 3,000 leaves 2,000.
- **FR-CAT-4** Validation: duplicate transfer (idempotency key), negative inventory, unauthorized transfer, invalid batch/product, expired dispatch, quantity mismatch. *AC:* one test per rule.

### FR-SC Supply chain
- **FR-SC-1** Shipment lifecycle: Created → Dispatched → In Transit → Received | Rejected | Cancelled; Under Investigation as an orthogonal hold flag that blocks progress. *AC:* illegal transitions return 409; state machine unit-tested exhaustively.
- **FR-SC-2** Only the designated receiver can accept/reject; receipt with quantity variance creates a discrepancy event and alert.
- **FR-SC-3** Corrections are new events referencing the corrected event; no UPDATE/DELETE on events.
- **FR-SC-4** Visual timeline: full for stakeholders, simplified for farmers.

### FR-BC Blockchain
- **FR-BC-1** All ownership-changing and compliance-relevant events are committed to Hyperledger Fabric via chaincode (list in brief §7).
- **FR-BC-2** Outbox pattern; status `PENDING → SUBMITTED → COMMITTED | FAILED`. UI shows "confirmed" only on `COMMITTED` with a chain tx ID. *AC:* kill the peer mid-flow → record stays `PENDING/SUBMITTED`, never "confirmed"; recovery worker reconciles.
- **FR-BC-3** Ledger verification job recomputes record hashes from Postgres and compares to chain commitments. *AC:* tampering a DB row is detected and alerted.
- **FR-BC-4** No PII or documents on chain; only hashes/commitments and IDs.

### FR-QR QR and verification
- **FR-QR-1** Batch-level and package-level QR with ≥128-bit random public tokens; URL `…/verify/{token}`. Download, printable labels, regeneration policy, revocation.
- **FR-QR-2** Every scan logged (coarse geo, device fingerprint hash, timestamp, result). 
- **FR-QR-3** Verification result separates four independent statuses: *Digital identity valid*, *Blockchain history verified*, *Suspicious scan activity*, *Confirmed counterfeit (investigation outcome)*. *AC:* a valid QR with failed chain verification never shows green; no screen says "genuine" based on QR existence alone.
- **FR-QR-4** Public verify endpoint returns only the simplified passport.

### FR-AI Detection and risk
- **FR-AI-1** Separate FastAPI service; hybrid detection (rules + Isolation Forest + statistical; XGBoost only when labelled data exists). Output schema: score, category, indicators, severity, confidence, evidence, recommended action.
- **FR-AI-2** Six brief scenarios (burst scans, impossible travel, invalid receipt, oversell, dormant QR spike, expired movement) each have a deterministic rule test.
- **FR-AI-3** Unified risk score 0–100 (Low 0–24, Medium 25–49, High 50–74, Critical 75–100), configurable weights, normalized signals, correlation-group caps, score history.
- **FR-AI-4** Model versions and predictions persisted. System reports mode "rules + unsupervised" until labelled data passes a documented threshold. No invented accuracy figures.
- **FR-AI-5** Never auto-declare counterfeit; Critical may trigger a *proposed* hold requiring authorized approval.

### FR-INV Investigation agent
- **FR-INV-1** Tool-calling LLM service restricted to read-only retrieval tools (scans, chain history, batch, ownership, indicators). Report sections tagged `OBSERVED_FACT | MODEL_INTERPRETATION | HYPOTHESIS`, each fact citing a record ID. *AC:* a fact with no citation fails schema validation and is dropped.
- **FR-INV-2** Human review actions (seven in brief §12), all audited; Critical cases cannot be closed without admin/auditor action.

### FR-RISK Dashboard and alerts
- **FR-RISK-1** Dashboards backed by real queries/materialised views; metrics in brief §13. Alerts with filters; real-time via WebSocket/SSE.
- **FR-RISK-2** Dedupe: one open alert per (batch, type, window).

### FR-NOT Notifications
- In-app, email, push (Expo), optional SMS; per-user preferences; dedupe key; events listed in brief §16.

### FR-MOB Farmer app
- Expo/React Native, 12 screens, EN/TE/HI via locale files, large touch targets, TTS guidance, offline cache of last verified results labelled **"may be outdated — recheck online"**, minimal registration (anonymous device ID allowed).

### FR-WEB Web app
- Role-specific navigation (brief §19), real data only, loading/empty/error states, pagination, search/filters, confirmation dialogs.

## 3. Non-functional requirements
Targets below are **budgets to be measured, not claims**.

| ID | Area | Budget (to verify in Phase 10) |
|---|---|---|
| NFR-1 | Public verify p95 latency (cached) | ≤ 500 ms |
| NFR-2 | API read p95 | ≤ 300 ms |
| NFR-3 | Chain commit latency | measure; report p50/p95 |
| NFR-4 | AI inference | ≤ 200 ms/scan sync path; heavy scoring async |
| NFR-5 | Availability design | no SPOF in stateless tiers; documented RPO/RTO |
| NFR-6 | Coverage | ≥80% line, ≥75% branch |
| NFR-7 | Accessibility | WCAG 2.1 AA web; mobile large-type support |

## 4. Out of scope for now / assumptions
- Packet authenticity of the physical item is never claimed from the QR alone; tamper-evident packaging is an optional integration point.
- Real LLM, Razorpay, SMS, and FCM credentials are supplied via env; interfaces and mocks-for-test only (clearly labelled).
- Production multi-org Fabric governance is designed for, but dev runs several orgs on one Docker host.
