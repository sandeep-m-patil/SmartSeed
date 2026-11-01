#!/usr/bin/env bash
# Packages, installs, approves (3 orgs) and commits the SmartSeed chaincode (Node, docker builder).
# Usage: deploy-cc.sh [--dev-endorsement] [--tenants id1,id2,...]
# UNVERIFIED - never executed.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

POLICY_FILE="$FABRIC_DIR/endorsement-policy.prod.txt"
COLLECTIONS="$FABRIC_DIR/collections_config.json"
PACKAGE="$FABRIC_DIR/$CC_NAME.tar.gz"
ORDERER_ARGS=(-o localhost:7050 --ordererTLSHostnameOverride orderer1.smartseed.example.com --tls --cafile "$TLS_BUNDLE")
COMMIT_ORGS=(smartseed authority)

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dev-endorsement)
        POLICY_FILE="$FABRIC_DIR/endorsement-policy.dev.txt"
        warn "DEV ENDORSEMENT POLICY (OR) SELECTED - a single org can endorse. NOT for staging/production." ;;
      --tenants) IFS=, read -r -a TENANTS <<< "$2"; shift ;;
      *) die "unknown option $1" ;;
    esac
    shift
  done
}

build_chaincode() {
  log "building chaincode (npm ci && npm run build)"
  (cd "$CC_DIR" && npm ci && npm run build)
}

package_chaincode() {
  use_peer_admin smartseed
  peer lifecycle chaincode package "$PACKAGE" --path "$CC_DIR" --lang node --label "${CC_NAME}_${CC_VERSION}"
  PACKAGE_ID="$(peer lifecycle chaincode calculatepackageid "$PACKAGE")"
  log "package id: $PACKAGE_ID"
}

install_and_approve() { # org
  use_peer_admin "$1"
  peer lifecycle chaincode install "$PACKAGE"
  peer lifecycle chaincode approveformyorg "${ORDERER_ARGS[@]}" --channelID "$CHANNEL_NAME" \
    --name "$CC_NAME" --version "$CC_VERSION" --package-id "$PACKAGE_ID" --sequence "$CC_SEQUENCE" \
    --signature-policy "$ENDORSEMENT_POLICY" --collections-config "$COLLECTIONS"
}

commit_definition() {
  use_peer_admin smartseed
  local peer_args=() org
  for org in "${COMMIT_ORGS[@]}"; do
    org_vars "$org"; peer_args+=(--peerAddresses "localhost:$PEER_PORT" --tlsRootCertFiles "$TLS_BUNDLE")
  done
  use_peer_admin smartseed
  peer lifecycle chaincode checkcommitreadiness --channelID "$CHANNEL_NAME" --name "$CC_NAME" \
    --version "$CC_VERSION" --sequence "$CC_SEQUENCE" --signature-policy "$ENDORSEMENT_POLICY" \
    --collections-config "$COLLECTIONS" --output json
  peer lifecycle chaincode commit "${ORDERER_ARGS[@]}" --channelID "$CHANNEL_NAME" --name "$CC_NAME" \
    --version "$CC_VERSION" --sequence "$CC_SEQUENCE" --signature-policy "$ENDORSEMENT_POLICY" \
    --collections-config "$COLLECTIONS" "${peer_args[@]}"
}

TENANTS=()
parse_args "$@"
if [[ ${#TENANTS[@]} -gt 0 ]]; then "$FABRIC_DIR/scripts/render-collections.sh" "${TENANTS[@]}"; fi
ENDORSEMENT_POLICY="$(read_policy "$POLICY_FILE")"
log "endorsement policy: $ENDORSEMENT_POLICY"
build_chaincode
package_chaincode
for org in smartseed authority manufacturer; do install_and_approve "$org"; done
commit_definition
log "chaincode $CC_NAME v$CC_VERSION (sequence $CC_SEQUENCE) committed on $CHANNEL_NAME"
