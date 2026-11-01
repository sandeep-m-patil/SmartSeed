#!/usr/bin/env bash
# Creates the channel genesis block, joins the 3 orderers (osnadmin) and the 3 peers.
# UNVERIFIED - never executed.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

JOIN_RETRIES=10
JOIN_DELAY_SECONDS=3
# "<ordererName>:<org>:<adminPort>"
ORDERERS=("orderer1:smartseed:7053" "orderer2:authority:8053" "orderer3:smartseed:9053")

create_block() {
  mkdir -p "$ARTIFACTS_DIR"
  FABRIC_CFG_PATH="$FABRIC_DIR" configtxgen -profile SeedChannel \
    -outputBlock "$ARTIFACTS_DIR/$CHANNEL_NAME.block" -channelID "$CHANNEL_NAME"
}

join_orderers() {
  local spec name org port tls
  for spec in "${ORDERERS[@]}"; do
    IFS=: read -r name org port <<< "$spec"
    tls="$ORGS_DIR/$org/orderers/$name/tls"
    osnadmin channel join --channelID "$CHANNEL_NAME" --config-block "$ARTIFACTS_DIR/$CHANNEL_NAME.block" \
      -o "localhost:$port" --ca-file "$TLS_BUNDLE" --client-cert "$tls/server.crt" --client-key "$tls/server.key"
  done
}

join_peer() { # org
  use_peer_admin "$1"
  local attempt
  for attempt in $(seq 1 "$JOIN_RETRIES"); do
    peer channel join -b "$ARTIFACTS_DIR/$CHANNEL_NAME.block" && return 0
    log "peer join retry $attempt/$JOIN_RETRIES for $1 (waiting for Raft leader)"; sleep "$JOIN_DELAY_SECONDS"
  done
  die "peer of $1 could not join $CHANNEL_NAME"
}

create_block
join_orderers
sleep "$JOIN_DELAY_SECONDS"
for org in smartseed authority manufacturer; do join_peer "$org"; done
log "channel $CHANNEL_NAME created; orderers and peers joined"
