#!/usr/bin/env bash
# Restores a dump into a SCRATCH database to prove it is usable, then prints timings.
# Never point TARGET_URL at production.
#
#   DUMP=/mnt/backups/smartseed-....dump TARGET_URL=postgres://postgres@scratch/smartseed_drill ./pg-restore-drill.sh
set -euo pipefail
: "${DUMP:?set DUMP}"
: "${TARGET_URL:?set TARGET_URL (scratch database)}"
sha256sum -c "${DUMP}.sha256"
start=$(date +%s)
pg_restore --no-owner --clean --if-exists --dbname="${TARGET_URL}" "${DUMP}"
end=$(date +%s)
echo "restore completed in $((end - start))s (record this as the measured RTO component)"
psql "${TARGET_URL}" -Atc "select 'tenants', count(*) from tenants union all select 'seed_batches', count(*) from seed_batches union all select 'audit_logs', count(*) from audit_logs;"
echo "next: run verifyAuditChain per tenant and verifyBatchLedger on a sample of batches"
