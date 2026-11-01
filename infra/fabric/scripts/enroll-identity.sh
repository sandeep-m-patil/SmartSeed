#!/usr/bin/env bash
# Registers + enrolls an application identity whose X.509 cert carries role/tenantId/orgId
# attributes (all ':ecert', i.e. always embedded in the enrollment certificate).
# Usage: enroll-identity.sh --org smartseed|authority|manufacturer --name ID --role ROLE \
#          --tenant-id TENANT --org-id ORG [--type client]
# Output: wallets/<name>/msp (signcert + private key). Treat as a secret; never commit.
# UNVERIFIED - never executed.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

VALID_ROLES="manufacturer distributor retailer carrier authority admin gateway"
VALUE_PATTERN='^[A-Za-z0-9_-]{3,64}$'
ID_TYPE=client

while [[ $# -gt 0 ]]; do
  case "$1" in
    --org) IDENT_ORG="$2" ;; --name) NAME="$2" ;; --role) ROLE="$2" ;;
    --tenant-id) TENANT_ID="$2" ;; --org-id) APP_ORG_ID="$2" ;; --type) ID_TYPE="$2" ;;
    *) die "unknown option $1" ;;
  esac
  shift 2
done
for v in IDENT_ORG NAME ROLE TENANT_ID APP_ORG_ID; do [[ -n "${!v:-}" ]] || die "missing --${v}"; done
[[ " $VALID_ROLES " == *" $ROLE "* ]] || die "role must be one of: $VALID_ROLES"
for v in NAME TENANT_ID APP_ORG_ID; do [[ "${!v}" =~ $VALUE_PATTERN ]] || die "$v must match $VALUE_PATTERN"; done

org_vars "$IDENT_ORG"
[[ -d "$ORGS_DIR/$ORG/ca-client" ]] || die "registrar not enrolled; run network.sh up first"
SECRET="$(openssl rand -hex 16)"
WALLET="$FABRIC_DIR/wallets/$NAME"

export FABRIC_CA_CLIENT_HOME="$ORGS_DIR/$ORG/ca-client"
fabric-ca-client register --caname "$CA_NAME" --id.name "$NAME" --id.secret "$SECRET" --id.type "$ID_TYPE" \
  --id.attrs "role=$ROLE:ecert,tenantId=$TENANT_ID:ecert,orgId=$APP_ORG_ID:ecert" --tls.certfiles "$CA_TLS_CERT"

export FABRIC_CA_CLIENT_HOME="$(mktemp -d)"
fabric-ca-client enroll -u "https://$NAME:$SECRET@localhost:$CA_PORT" --caname "$CA_NAME" \
  -M "$WALLET/msp" --tls.certfiles "$CA_TLS_CERT"
rm -rf "$FABRIC_CA_CLIENT_HOME"
cp "$ORGS_DIR/$ORG/msp/config.yaml" "$WALLET/msp/config.yaml"
log "identity $NAME enrolled in $MSP_ID with role=$ROLE tenantId=$TENANT_ID orgId=$APP_ORG_ID -> $WALLET/msp"
