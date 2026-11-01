#!/usr/bin/env bash
# Builds all MSP / TLS material from the three running Fabric CAs.
# Requires: CAs up (network.sh up does this), .env loaded. UNVERIFIED - never executed.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

NODE_OU_CLIENT=client; NODE_OU_PEER=peer; NODE_OU_ADMIN=admin; NODE_OU_ORDERER=orderer
CA_WAIT_SECONDS=60

wait_for_ca() {
  local waited=0
  while [[ ! -f "$CA_TLS_CERT" || ! -f "$ORGS_DIR/$ORG/ca/ca-cert.pem" ]]; do
    sleep 1; waited=$((waited + 1))
    [[ $waited -ge $CA_WAIT_SECONDS ]] && die "CA $CA_NAME did not produce its certificates in ${CA_WAIT_SECONDS}s"
  done
}

write_node_ou() { # $1 = msp dir; picks the CA cert file name found in cacerts/
  local cacert; cacert="$(basename "$(ls "$1"/cacerts/*.pem | head -n 1)")"
  cat > "$1/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/$cacert
    OrganizationalUnitIdentifier: $NODE_OU_CLIENT
  PeerOUIdentifier:
    Certificate: cacerts/$cacert
    OrganizationalUnitIdentifier: $NODE_OU_PEER
  AdminOUIdentifier:
    Certificate: cacerts/$cacert
    OrganizationalUnitIdentifier: $NODE_OU_ADMIN
  OrdererOUIdentifier:
    Certificate: cacerts/$cacert
    OrganizationalUnitIdentifier: $NODE_OU_ORDERER
EOF
}

ca_register() { # id type
  fabric-ca-client register --caname "$CA_NAME" --id.name "$1" --id.secret "$NODE_SECRET" \
    --id.type "$2" --tls.certfiles "$CA_TLS_CERT"
}

ca_enroll() { # id msp-dir [extra args...]
  local id="$1" dir="$2"; shift 2
  fabric-ca-client enroll -u "https://$id:$NODE_SECRET@localhost:$CA_PORT" --caname "$CA_NAME" \
    -M "$dir" --tls.certfiles "$CA_TLS_CERT" "$@"
}

enroll_node() { # kind(peers|orderers) name type ; uses ORG
  local kind="$1" name="$2" type="$3"
  local base="$ORGS_DIR/$ORG/$kind/$name" host="$name.$ORG.example.com"
  [[ "$name" == orderer3 ]] && host="orderer3.smartseed.example.com"
  ca_register "$name" "$type"
  ca_enroll "$name" "$base/msp" --csr.hosts "$host,localhost"
  cp "$ORGS_DIR/$ORG/msp/config.yaml" "$base/msp/config.yaml"
  ca_enroll "$name" "$base/tls-tmp" --enrollment.profile tls --csr.hosts "$host,localhost"
  mkdir -p "$base/tls"
  cp "$base"/tls-tmp/tlscacerts/* "$base/tls/ca.crt"
  cp "$base"/tls-tmp/signcerts/* "$base/tls/server.crt"
  cp "$base"/tls-tmp/keystore/* "$base/tls/server.key"
  rm -rf "$base/tls-tmp"
}

bootstrap_org() { # $1 = org, rest = list of "kind:name:type"
  org_vars "$1"; shift
  wait_for_ca
  export FABRIC_CA_CLIENT_HOME="$ORGS_DIR/$ORG/ca-client"
  fabric-ca-client enroll -u "https://$CA_ADMIN_USER:$CA_ADMIN_PASS@localhost:$CA_PORT" \
    --caname "$CA_NAME" --tls.certfiles "$CA_TLS_CERT"
  mkdir -p "$ORGS_DIR/$ORG/msp/cacerts" "$ORGS_DIR/$ORG/msp/tlscacerts"
  cp "$ORGS_DIR/$ORG/ca/ca-cert.pem" "$ORGS_DIR/$ORG/msp/cacerts/ca.pem"
  cp "$ORGS_DIR/$ORG/ca/ca-cert.pem" "$ORGS_DIR/$ORG/msp/tlscacerts/ca.pem"
  write_node_ou "$ORGS_DIR/$ORG/msp"
  ca_register orgadmin admin
  ca_enroll orgadmin "$ORGS_DIR/$ORG/users/admin/msp"
  cp "$ORGS_DIR/$ORG/msp/config.yaml" "$ORGS_DIR/$ORG/users/admin/msp/config.yaml"
  local spec
  for spec in "$@"; do IFS=: read -r kind name type <<< "$spec"; enroll_node "$kind" "$name" "$type"; done
}

main() {
  for org in smartseed authority manufacturer; do mkdir -p "$ORGS_DIR/$org/ca"; done
  bootstrap_org smartseed peers:peer0:peer orderers:orderer1:orderer orderers:orderer3:orderer
  bootstrap_org authority peers:peer0:peer orderers:orderer2:orderer
  bootstrap_org manufacturer peers:peer0:peer
  cat "$ORGS_DIR"/{smartseed,authority,manufacturer}/ca/ca-cert.pem > "$TLS_BUNDLE"
  log "crypto material written under $ORGS_DIR (contains private keys; git-ignored)"
}

main "$@"
