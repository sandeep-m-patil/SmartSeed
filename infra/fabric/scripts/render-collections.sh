#!/usr/bin/env bash
# Renders collections_config.json (one pdc_<tenantId> collection per tenant) from the template.
# Usage: scripts/render-collections.sh [-o OUTPUT] TENANT_ID [TENANT_ID...]
#   MEMBER_ORGS (env) overrides the collection membership, default:
#   'SmartSeedMSP.member','AuthorityMSP.member'
# Note: collections are part of the chaincode definition. Adding a tenant requires re-rendering,
# then approving + committing a NEW chaincode definition sequence (network.sh deploy-cc).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$HERE/collections_config.template.json"
OUTPUT="$HERE/collections_config.json"
MEMBER_ORGS="${MEMBER_ORGS:-'SmartSeedMSP.member','AuthorityMSP.member'}"
TENANT_PATTERN='^[A-Za-z0-9_-]{3,64}$'

if [[ "${1:-}" == "-o" ]]; then OUTPUT="$2"; shift 2; fi
if [[ $# -lt 1 ]]; then echo "usage: $0 [-o OUTPUT] TENANT_ID [TENANT_ID...]" >&2; exit 2; fi

entries=()
for tenant in "$@"; do
  if [[ ! "$tenant" =~ $TENANT_PATTERN ]]; then
    echo "invalid tenant id '$tenant' (must match $TENANT_PATTERN)" >&2; exit 2
  fi
  entry="$(sed -e "s/{{TENANT_ID}}/$tenant/g" -e "s/{{MEMBER_ORGS}}/$MEMBER_ORGS/g" "$TEMPLATE")"
  entries+=("$entry")
done

{
  echo "["
  for i in "${!entries[@]}"; do
    sep=","; [[ $i -eq $((${#entries[@]} - 1)) ]] && sep=""
    echo "${entries[$i]}$sep"
  done
  echo "]"
} > "$OUTPUT"
echo "rendered ${#entries[@]} collection(s) to $OUTPUT"
