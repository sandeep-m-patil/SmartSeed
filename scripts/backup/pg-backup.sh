#!/usr/bin/env bash
# Logical backup of the SmartSeed database. Run from a host/job that can reach Postgres and has
# write access to a SEPARATE backup location. UNTESTED against production: run the restore drill
# in docs/09-operations.md before relying on it.
#
#   DATABASE_URL=postgres://backup_role@host/smartseed BACKUP_DIR=/mnt/backups RETENTION_DAYS=30 ./pg-backup.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL (a read-only backup role)}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="${BACKUP_DIR}/smartseed-${stamp}.dump"
mkdir -p "${BACKUP_DIR}"
pg_dump --format=custom --no-owner --file="${file}" "${DATABASE_URL}"
sha256sum "${file}" > "${file}.sha256"
find "${BACKUP_DIR}" -name 'smartseed-*.dump*' -mtime "+${RETENTION_DAYS}" -delete
echo "backup written: ${file}"
