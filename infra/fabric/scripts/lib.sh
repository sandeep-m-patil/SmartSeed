#!/usr/bin/env bash
# Shared helpers for network.sh and friends. Sourced, not executed.
# UNVERIFIED: written without access to a running Docker daemon.

FABRIC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$FABRIC_DIR/../.." && pwd)"
CC_DIR="$REPO_ROOT/chaincode/smartseed-cc"
ORGS_DIR="$FABRIC_DIR/organizations"
ARTIFACTS_DIR="$FABRIC_DIR/channel-artifacts"
CHANNEL_NAME="${CHANNEL_NAME:-seedchannel}"
CC_NAME="${CC_NAME:-smartseed}"
CC_VERSION="${CC_VERSION:-1.0}"
CC_SEQUENCE="${CC_SEQUENCE:-1}"
TLS_BUNDLE="$ORGS_DIR/tls-ca-bundle.pem"

export PATH="$FABRIC_DIR/bin:$PATH"

log()  { printf '\033[1;34m[fabric]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing prerequisite: $1 (see README.md)"; }

check_prereqs() {
  for cmd in docker peer configtxgen osnadmin fabric-ca-client openssl; do require_cmd "$cmd"; done
  docker info >/dev/null 2>&1 || die "Docker daemon is not reachable. Start Docker Desktop / dockerd (WSL2 integration on)."
  [[ -f "$FABRIC_DIR/config/core.yaml" ]] || die "config/core.yaml missing - run install-fabric.sh in infra/fabric (see README.md)"
}

# Generates .env with random secrets on first use. Nothing secret is stored in the repo.
ensure_env() {
  local env_file="$FABRIC_DIR/.env"
  [[ -f "$env_file" ]] && return 0
  log "generating $env_file with random secrets (git-ignored)"
  {
    echo "FABRIC_IMAGE_TAG=2.5"
    echo "CA_IMAGE_TAG=1.5"
    echo "COUCHDB_IMAGE_TAG=3.3"
    echo "CA_ADMIN_USER=caadmin"
    echo "CA_ADMIN_PASS=$(openssl rand -hex 16)"
    echo "NODE_SECRET=$(openssl rand -hex 16)"
    echo "COUCHDB_USER=couchadmin"
    echo "COUCHDB_PASSWORD=$(openssl rand -hex 16)"
    echo "STATE_DB=goleveldb"
  } > "$env_file"
  chmod 600 "$env_file" 2>/dev/null || true
}

load_env() { ensure_env; set -a; source "$FABRIC_DIR/.env"; set +a; }

compose() { (cd "$FABRIC_DIR" && docker compose --env-file .env "$@"); }

# Prints the first non-comment, non-blank line of a policy file.
read_policy() { grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$1" | head -n 1; }

# Per-org constants. Usage: org_vars smartseed|authority|manufacturer
org_vars() {
  ORG="$1"
  case "$ORG" in
    smartseed)    MSP_ID=SmartSeedMSP;    CA_PORT=7054; PEER_PORT=7051 ;;
    authority)    MSP_ID=AuthorityMSP;    CA_PORT=8054; PEER_PORT=9051 ;;
    manufacturer) MSP_ID=ManufacturerMSP; CA_PORT=9054; PEER_PORT=11051 ;;
    *) die "unknown org '$ORG'" ;;
  esac
  CA_NAME="ca-$ORG"
  CA_TLS_CERT="$ORGS_DIR/$ORG/ca/tls-cert.pem"
}

# Points the peer CLI at an org's admin identity and peer (host-side, via localhost).
use_peer_admin() {
  org_vars "$1"
  export FABRIC_CFG_PATH="$FABRIC_DIR/config"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="$MSP_ID"
  export CORE_PEER_TLS_ROOTCERT_FILE="$TLS_BUNDLE"
  export CORE_PEER_MSPCONFIGPATH="$ORGS_DIR/$ORG/users/admin/msp"
  export CORE_PEER_ADDRESS="localhost:$PEER_PORT"
}
