# SmartSeed — Blockchain Architecture (Phase 1)

## 1. Network topology
Hyperledger Fabric 2.5 LTS, Raft ordering, Fabric Gateway client (Node.js `@hyperledger/fabric-gateway`).

| Org (MSP) | Role | Dev | Production target |
|---|---|---|---|
| `SmartSeedMSP` | Platform operator | 1 peer, 1 CA, 1 orderer | Operator-run |
| `AuthorityMSP` | Independent agri authority / auditor | 1 peer, 1 CA, 1 orderer | Run by the authority |
| `ManufacturerMSP` | Consortium org for manufacturers | 1 peer, 1 CA | Large manufacturers may later run own peers |

Dev runs 3 orderers (Raft) so node-failure scenarios are testable. Production requires orderers and peers spread across ≥2 independent organizations so no single admin can rewrite history.

## 2. Channel and tenant isolation (design decision)
Channel-per-tenant does not scale to many SaaS tenants and breaks cross-tenant traceability (a distributor serves many manufacturers). Chosen design:

- **One shared channel `seedchannel`** for public-safe commitments (batch ID, event ID, event type, hashed party IDs, timestamp, quantity commitment, record hash, signature ref).
- **Private Data Collections (PDC)** per tenant (`pdc_<tenantId>`, created via collection config) for tenant-confidential fields (exact quantities, prices, facility details) when needed; only the hash lands on the shared ledger.
- **Identity:** each participant organization receives a Fabric identity (X.509 via Fabric CA) with attributes `tenantId`, `orgId`, `role`. Chaincode authorizes with `ClientIdentity.getAttributeValue`.
- If a tenant later demands full ledger separation, a dedicated channel can be added; the Gateway adapter selects channel per tenant via config (extension point, not built now).

## 3. What goes on-chain
Allowed: `batchId`, `eventId`, `eventType`, `fromOrgHash`, `toOrgHash`, `ts`, `quantityCommitment = H(qty‖salt)`, `recordHash = SHA-256(canonical JSON of off-chain record)`, `dbRecordRef`, `signatureRef`.
Forbidden: PII, farmer identity, prices, documents, free text. Farmer verifications record only an anonymised hash and coarse region.

Canonicalization: RFC 8785 JSON canonicalization before hashing so DB and chain hashes are reproducible.

## 4. Chaincode (`chaincode/smartseed-cc`, TypeScript)
State keys: `PRODUCT:{id}`, `BATCH:{id}`, `EVENT:{eventId}`, composite key `BATCH~EVENT~{batchId}~{seq}` for ordered history.

| Function | Who (attribute `role`) | Key checks |
|---|---|---|
| RegisterProduct | manufacturer | tenant attr = owner; ID unused |
| RegisterBatch | manufacturer | product exists & owned; expiry > mfg; ID unused |
| TransferBatch | current owner | caller org == owner; not revoked/held; not expired; qty commitment present; unique eventId |
| AcceptBatch / RejectBatch | designated receiver | transfer pending to caller; one-shot |
| RecordShipment | sender/carrier-role | linked to transfer |
| RecordRetailSale | retailer | owner; aggregate-sold check via commitments/PDC |
| RecordFarmerVerification | any authenticated gateway (service id) | rate-limited anonymised record |
| UpdateBatchStatus | owner, authority, admin (per status matrix) | legal transitions only |
| RecordCounterfeitReport | gateway service | creates report event |
| RecordInvestigationOutcome | authority/auditor/admin | role + MFA-backed attribute |

Rules: events are append-only; `PutState` on an existing `EVENT:` key is rejected; corrections are new events with `corrects: eventId`. Ownership is a function of accepted-transfer events. Duplicate `eventId` returns an idempotent "already committed" result rather than a second write.

**Endorsement policy:** `AND('SmartSeedMSP.peer','AuthorityMSP.peer')` for ownership-changing and outcome functions in staging/prod; dev may use `OR` explicitly flagged in config. 

## 5. Signatures
Two layers: (1) Fabric transaction signature by the submitting org identity (validated by peers per MSP); (2) application-level signature over `recordHash` by the acting user's key (ECDSA P-256, key held in KMS/HSM, never in browser/mobile) whose reference is stored in the event. Chaincode verifies the org-level identity; auditors can verify the app-level signature off-chain against published certs. Certificate revocation: Fabric CA CRL pushed to channel config; application keys revoked via cert registry table checked at signing time.

## 6. Key management
- Dev: Fabric CA enrollment, wallets on encrypted volume, `.env` references only.
- Prod: org private keys in cloud KMS/HSM via PKCS#11 or sign-callback in Gateway; no key material in images or repo; rotation runbook in Phase 10.

## 7. Backend integration (`blockchain` module)
- `OutboxRepository` (claim with `FOR UPDATE SKIP LOCKED`), `FabricGatewayClient` interface (real implementation only; test double lives under `test/` and is never wired in non-test builds).
- States: `PENDING → SUBMITTED → COMMITTED | FAILED`. Commit listener via `getCommitStatus`; block-event listener updates `blockchain_transactions` (block number, tx id, validation code).
- **Ledger verifier** job: for sampled/all batches recompute `recordHash` from Postgres and compare to chain; mismatches raise a Critical `LEDGER_MISMATCH` alert.

## 8. Insider-threat controls
Separate DB credentials for writers vs. audit role; audit logs hash-chained and anchored to the ledger periodically; independent backup of ledger by `AuthorityMSP` peer; chaincode upgrades require multi-org approval (lifecycle policy `MAJORITY`).

## 9. Chain tests (Phase 4)
Chaincode unit tests (mock stub) for every function and auth failure; duplicate event; double transfer; hash/signature mismatch; integration: kill peer/orderer, recover, verify no divergence.

## 10. Honest limits
Blockchain proves *integrity and ordering of what was entered*, not that the data entered was true. Mitigations: receiver confirmation, quantity-variance alerts, document hashing, authority co-endorsement, scan analytics.

---

## 11. As built (Phase 4) — decisions that supersede earlier sections

- **Party identity.** The chaincode's opaque `tenantId` attribute carries the **organization UUID** of every party, manufacturers included. Fabric identities are enrolled per organization with attributes `role`, `tenantId` (= org UUID) and `orgId`. `wholesaler` organizations are enrolled with the `distributor` chain role.
- **Holder model, not single owner.** The ledger tracks `HOLDING:{batch}:{party}` and many concurrent `PENDING:{batch}:{transfer}` records, because stock is split across holders (10,000 → 5,000 + 3,000 + 2,000 kept). Quantities are commitments only (`sha256("<qty>|<salt>")`; the salt stays in the off-chain event payload). Sums are enforced by the database, not the chain, and the chain proves who legitimately held and passed a batch on.
- **Event → chaincode mapping** (`apps/api/src/supply/events.ts`): `batch_registered`→`RegisterProduct`(once)+`RegisterBatch`; `transfer_created`→`TransferBatch`; `transfer_dispatched|in_transit`→`RecordShipment`; `transfer_received`→`AcceptBatch`; `transfer_rejected`→`RejectBatch`; `transfer_cancelled`→`CancelTransfer`; `retail_sale`→`RecordRetailSale`. Receipt variances (`discrepancy_recorded`) and operational holds are off-chain. QR scans are off-chain by design (volume); they are analysed by the AI engine, not committed.
- **Not wired yet:** `RecordFarmerVerification`, `RecordCounterfeitReport`, `RecordInvestigationOutcome` exist in the chaincode but the backend does not submit them (reports and outcomes are stored off-chain with audit). Investigation holds are database-level and are not mirrored as chain `HELD` status, because releasing a chain hold requires an authority identity.
- **Outbox.** `blockchain_transactions` rows are written in the same database transaction as the event. A worker claims rows per batch strictly in sequence (`FOR UPDATE SKIP LOCKED`; no later event is sent while an earlier one is uncommitted), re-derives the record hash before sending (a changed row is refused), signs the hash with the application key (ECDSA P-256; reference stored on-chain, signature in the database), submits through the Fabric Gateway client, and records tx id, block number and validation code only on real commit. Retryable errors (peer unavailable, MVCC conflict) back off; chaincode rejections fail permanently and block later events of that batch, which turns public verification RED.
- **Verification.** `verifyBatchLedger` recomputes each committed event's hash from the database and compares it with the ledger (`VerifyRecordHash`). A mismatch sets `ledger_status = mismatch` and raises a CRITICAL alert.
- **Verified vs unverified.** Chaincode logic (105 tests against a mock stub), hash parity with the chaincode test vectors, schema conformance of every call the backend builds, and the outbox/verifier logic (against a recording test double) are tested. The Fabric network scripts and the real Gateway client (`FabricGateway`) have **never been run against live peers**.
