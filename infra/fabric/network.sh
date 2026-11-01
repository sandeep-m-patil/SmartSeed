#!/usr/bin/env bash
# SmartSeed Fabric dev network driver (Fabric 2.5).
#   ./network.sh up [--couchdb]          start CAs, build crypto, start orderers/peers, create channel
#   ./network.sh down                    stop everything and delete generated crypto/artifacts/volumes
#   ./network.sh deploy-cc [opts]        package/install/approve/commit chaincode (see scripts/deploy-cc.sh)
#   ./network.sh enroll-identity [opts]  register+enroll an identity with role/tenantId/orgId attributes
#   ./network.sh render-collections IDS  render collections_config.json for the given tenant ids
# UNVERIFIED: these scripts have NOT been run. Docker was not available when they were written.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/scripts/lib.sh"

CA_SERVICES=(ca.smartseed.example.com ca.authority.example.com ca.manufacturer.example.com)

cmd_up() {
  local use_couch=false
  [[ "${1:-}" == "--couchdb" ]] && use_couch=true
  check_prereqs
  ensure_env
  if $use_couch; then
    sed -i.bak 's/^STATE_DB=.*/STATE_DB=CouchDB/' "$FABRIC_DIR/.env" && rm -f "$FABRIC_DIR/.env.bak"
    export COMPOSE_PROFILES=couchdb
  fi
  load_env
  mkdir -p "$ORGS_DIR"/{smartseed,authority,manufacturer}/ca
  log "starting certificate authorities"
  compose up -d "${CA_SERVICES[@]}"
  "$HERE/scripts/bootstrap-crypto.sh"
  log "starting orderers and peers"
  compose up -d
  sleep 5
  "$HERE/scripts/channel.sh"
}

cmd_down() {
  log "stopping network and removing volumes, generated crypto and artifacts"
  compose --profile couchdb down --volumes --remove-orphans || true
  docker ps -aq --filter "name=dev-peer" | xargs -r docker rm -f
  docker images -q "dev-peer*" | xargs -r docker rmi -f
  rm -rf "$ORGS_DIR" "$ARTIFACTS_DIR" "$FABRIC_DIR/wallets" "$FABRIC_DIR"/*.tar.gz
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    up) cmd_up "$@" ;;
    down) cmd_down ;;
    deploy-cc) check_prereqs; "$HERE/scripts/deploy-cc.sh" "$@" ;;
    enroll-identity) check_prereqs; "$HERE/scripts/enroll-identity.sh" "$@" ;;
    render-collections) "$HERE/scripts/render-collections.sh" "$@" ;;
    *) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 2 ;;
  esac
}

main "$@"
