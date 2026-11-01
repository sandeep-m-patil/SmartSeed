# SmartSeed Hyperledger Fabric network (dev)

> **STATUS: UNVERIFIED.** The network scripts (`network.sh`, `scripts/*.sh`), `docker-compose.yaml` and
> `configtx.yaml` were written on a machine where Docker was **not running**. They have **not been
> executed** against real Fabric binaries or images. Only these were checked: `bash -n` syntax of the
> scripts, `docker compose config` parsing of the compose file (no containers started), and
> `scripts/render-collections.sh` output. Expect to fix small issues on the first real run. The chaincode
> itself *is* unit-tested (see `chaincode/smartseed-cc`), but never against a real peer.

Topology (per `docs/03-blockchain.md`): Fabric 2.5, Raft, 3 orgs (`SmartSeedMSP`, `AuthorityMSP`,
`ManufacturerMSP`), one Fabric CA and one peer per org, 3 Raft orderers (orderer1 + orderer3 run by
SmartSeed, orderer2 by Authority — dev only; production needs >= 2 independent orgs), channel
`seedchannel`, optional CouchDB. No system channel (channel participation API / `osnadmin`).

## Prerequisites
- Windows: **WSL2** (Ubuntu) with Docker Desktop WSL integration enabled, or native Linux/macOS. Run everything
  from inside WSL2 (bash), with the repo on the Linux filesystem or a drive mounted with metadata.
- Docker Engine + Docker Compose v2 (`docker compose`), daemon running.
- Node.js 20+ and npm (the chaincode is built on the host before packaging).
- `openssl`, `curl`, `bash` 4+.
- Fabric 2.5.x binaries and Fabric CA 1.5.x client in `infra/fabric/bin` plus `infra/fabric/config`:
  ```bash
  cd infra/fabric
  curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
  chmod +x install-fabric.sh
  ./install-fabric.sh --fabric-version 2.5.9 binary   # pick a current 2.5.x / CA 1.5.x; check the script's --help
  ```
  Needed binaries: `peer`, `configtxgen`, `osnadmin`, `fabric-ca-client`. Review the downloaded script before
  running it. (`bin/` and `config/` are git-ignored.)

## Files
| File | Purpose |
|---|---|
| `configtx.yaml` | Orgs, Raft consenters, `MAJORITY` lifecycle/endorsement policies, `SeedChannel` profile |
| `docker-compose.yaml` | 3 CAs, 3 orderers, 3 peers, 3 optional CouchDB (`couchdb` profile) |
| `network.sh` | `up [--couchdb]`, `down`, `deploy-cc`, `enroll-identity`, `render-collections` |
| `scripts/bootstrap-crypto.sh` | Fabric-CA enrollment of org admins, peers, orderers, NodeOU config |
| `scripts/channel.sh` | genesis block, `osnadmin channel join` x3, `peer channel join` x3 |
| `scripts/deploy-cc.sh` | package / install / approve (3 orgs) / commit with policy + collections |
| `scripts/enroll-identity.sh` | register + enroll an identity with `role`/`tenantId`/`orgId` attributes |
| `scripts/render-collections.sh`, `collections_config.template.json` | per-tenant PDC renderer |
| `collections_config.json` | sample rendered output (`pdc_tenant-mfr`, `pdc_tenant-dist`) - dev placeholders |
| `endorsement-policy.prod.txt` / `endorsement-policy.dev.txt` | policy files (dev one is loudly flagged) |

## How to run
```bash
cd infra/fabric
./network.sh up                 # add --couchdb for CouchDB state DB
./network.sh deploy-cc          # prod-style AND policy
./network.sh deploy-cc --dev-endorsement   # DEV ONLY: OR policy, prints a warning
./network.sh down               # destroys containers, volumes, crypto, wallets
```
`up` generates a git-ignored `.env` with random CA/node/CouchDB secrets on first run; no credentials live in
the repo (`.env.example` only lists variable names). Generated key material under `organizations/` and
`wallets/` is git-ignored: never commit it.

Chaincode is launched by the peers' Docker builder (peers mount the host Docker socket). `deploy-cc.sh` runs
`npm ci && npm run build` in `chaincode/smartseed-cc`, packages that directory (`--lang node`), and the peer
builds an image with `npm install --production`. Chaincode-as-a-service is the recommended production
alternative and is not wired up here.

### Per-tenant private data collections
```bash
./network.sh render-collections tenant-aaa tenant-bbb      # writes collections_config.json
./network.sh deploy-cc --tenants tenant-aaa,tenant-bbb     # render + deploy
```
The chaincode writes to `pdc_<tenantId>`; the collection must exist in the committed definition, so adding a
tenant means re-rendering and committing a **new definition sequence** (`CC_SEQUENCE=2 ./network.sh deploy-cc`).
Membership defaults to `SmartSeedMSP` + `AuthorityMSP` (override via `MEMBER_ORGS`), because a tenant is not a
Fabric org; confidentiality *between tenants* therefore relies on the chaincode/gateway, not on peer
membership. Plaintext quantities are optional and travel only in transient data (`quantity`, `salt`).

### Endorsement policy
`endorsement-policy.prod.txt` = `AND('SmartSeedMSP.peer','AuthorityMSP.peer')`, applied to the **whole**
chaincode definition (Fabric lifecycle has one policy per chaincode; per-function policies would require
state-based endorsement, not implemented). The OR variant is `endorsement-policy.dev.txt`, only used with
`--dev-endorsement`; with it a single org can endorse, so a single operator could rewrite history.

## Identity attributes for the Node backend
Chaincode authorises from certificate attributes read by `ClientIdentity.getAttributeValue`:
`role` (`manufacturer|distributor|retailer|carrier|authority|admin|gateway`), `tenantId`, `orgId`.
They must be registered with the `:ecert` suffix so Fabric CA embeds them in the enrollment certificate.
The registrar (CA bootstrap admin) must be allowed to set them (`hf.Registrar.Attributes=*`, the bootstrap default).
Suggested CAs: manufacturer/distributor/retailer/carrier tenants -> `ca-manufacturer`
(`ManufacturerMSP`); gateway/admin service identities -> `ca-smartseed`; authority/auditor -> `ca-authority`.

Exact CLI form (values must not contain commas):
```bash
export FABRIC_CA_CLIENT_HOME=infra/fabric/organizations/manufacturer/ca-client   # registrar (CA admin) home
fabric-ca-client register --caname ca-manufacturer \
  --id.name mfr-acme-svc --id.secret "$(openssl rand -hex 16)" --id.type client \
  --id.attrs 'role=manufacturer:ecert,tenantId=<TENANT_UUID>:ecert,orgId=<ORG_UUID>:ecert' \
  --tls.certfiles infra/fabric/organizations/manufacturer/ca/tls-cert.pem

fabric-ca-client register --caname ca-smartseed --id.name gateway-svc --id.secret "$(openssl rand -hex 16)" \
  --id.type client --id.attrs 'role=gateway:ecert,tenantId=smartseed-gw:ecert,orgId=smartseed:ecert' \
  --tls.certfiles infra/fabric/organizations/smartseed/ca/tls-cert.pem

fabric-ca-client register --caname ca-authority --id.name auditor-1 --id.secret "$(openssl rand -hex 16)" \
  --id.type client --id.attrs 'role=authority:ecert,tenantId=authority-main:ecert,orgId=authority:ecert' \
  --tls.certfiles infra/fabric/organizations/authority/ca/tls-cert.pem
```
Helper that registers and enrolls in one step: 
`./network.sh enroll-identity --org manufacturer --name mfr-acme-svc --role manufacturer --tenant-id <id> --org-id <id>`.

From the Node backend (`fabric-ca-client` npm package), same semantics:
```ts
await ca.register(
  { enrollmentID: name, enrollmentSecret: secret, role: 'client', affiliation: '',
    attrs: [
      { name: 'role', value: 'manufacturer', ecert: true },
      { name: 'tenantId', value: tenantId, ecert: true },
      { name: 'orgId', value: orgId, ecert: true },
    ] },
  registrar,
);
const { certificate, key } = await ca.enroll({ enrollmentID: name, enrollmentSecret: secret });
```
Store the key in KMS/HSM (Gateway sign callback) for anything beyond dev; keep secrets out of the repo.
`orgId`/`tenantId` values must match `^[A-Za-z0-9_-]{3,64}$` where they are echoed as chaincode input
(`ownerTenantId`, `toTenantId`).

## Chaincode state model: holders, not a single owner
A batch can be split across many parties, so the chain records *who legitimately held and who passed it on*,
not a single owner or per-holder quantities.
- `BATCH:{id}` - `originTenantId` (registrant), status, expiry, original quantity commitment, event counter. No owner, no pending transfer.
- `HOLDING:{batchId}:{tenantId}` = `{tenantId, orgId, quantityCommitment, sinceSeq}`. Created by `RegisterBatch` (for the registrant) and by `AcceptBatch` (for the receiver). A sender's holding is **kept** after a transfer is accepted.
- `PENDING:{batchId}:{transferEventId}` = `{fromTenantId, toTenantId, quantityCommitment}`. Many may coexist per batch; the `TransferBatch` eventId is the transfer id. `AcceptBatch`/`RejectBatch` (receiver only) and `CancelTransfer` (sender only, emits `TRANSFER_CANCELLED`) are one-shot and delete the pending record.
- `TransferBatch` and `RecordRetailSale` require the caller to hold the batch; `RecordShipment` requires the caller to be the pending transfer's sender (or have the `carrier` role). A holder may set `SOLD_OUT` only when it is the sole holder.
- `GetBatch` returns the batch plus `holders` as pseudonymous hashes (`sha256("smartseed:org:"+tenantId)`, identical to event `fromOrgHash`/`toOrgHash`), never raw ids.
- The `tenantId` identity attribute is an opaque **party id** (the backend passes the organization UUID for every party, manufacturers included). Wholesalers are enrolled with the `distributor` role attribute (the backend maps wholesaler -> `distributor`).
- Not modelled on-chain: per-holder quantities and the "sum of transfers <= held" invariant (only commitments; optional plaintext in `pdc_<tenantId>` where received quantities accumulate for the retail-sale aggregate check), and which holder a shipped/sold unit came from.

## Known limitations
- Nothing in this directory has been run (see banner). Version tags default to floating `2.5` / `1.5`
  images; pin them via `.env` once validated.
- Dev topology has two orderers run by SmartSeed.
- Collection membership is org-level; tenant-level confidentiality is enforced by chaincode/gateway only.
- Single chaincode-level endorsement policy (no per-function policy / SBE).
- CA admin and node secrets are shared random values in `.env`; production needs HSM/KMS-backed keys.
- Raft recovery drills (kill peer/orderer) from `docs/03-blockchain.md` section 9 are not scripted.
