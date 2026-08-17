#!/usr/bin/env bash
# EdgeOne CDN purge via TencentCloud API 3.0 (TC3-HMAC-SHA256).
# Usage: edgeone-purge.sh <ZONE_ID> <URL> [URL ...]
# Env: TENCENTCLOUD_SECRET_ID, TENCENTCLOUD_SECRET_KEY

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <ZONE_ID> <URL> [URL ...]" >&2
  exit 1
fi

ZONE_ID="$1"; shift
URLS=("$@")

: "${TENCENTCLOUD_SECRET_ID:?missing TENCENTCLOUD_SECRET_ID}"
: "${TENCENTCLOUD_SECRET_KEY:?missing TENCENTCLOUD_SECRET_KEY}"

SERVICE="teo"
HOST="${SERVICE}.tencentcloudapi.com"
ACTION="CreatePurgeTask"
VERSION="2022-09-01"
ALGO="TC3-HMAC-SHA256"

TS=$(date +%s)
DATE=$(date -u +%Y-%m-%d)

TARGETS_JSON=$(printf '"%s",' "${URLS[@]}")
TARGETS_JSON="[${TARGETS_JSON%,}]"
PAYLOAD=$(printf '{"ZoneId":"%s","Type":"purge","Targets":%s}' "$ZONE_ID" "$TARGETS_JSON")

HASH_PAYLOAD=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hex | awk '{print $NF}')

CANONICAL_REQUEST="POST
/
content-type:application/json; charset=utf-8
host:${HOST}

content-type;host
${HASH_PAYLOAD}"

CRED_SCOPE="${DATE}/${SERVICE}/tc3_request"
HASH_CANONICAL=$(printf '%s' "$CANONICAL_REQUEST" | openssl dgst -sha256 -hex | awk '{print $NF}')
STRING_TO_SIGN="${ALGO}
${TS}
${CRED_SCOPE}
${HASH_CANONICAL}"

SECRET_DATE=$(printf '%s' "$DATE" | openssl dgst -sha256 -hmac "$TENCENTCLOUD_SECRET_KEY" -hex | awk '{print $NF}')
SECRET_SERVICE=$(printf '%s' "$SERVICE" | openssl dgst -sha256 -hmac "$SECRET_DATE" -hex | awk '{print $NF}')
SECRET_SIGNING=$(printf '%s' "tc3_request" | openssl dgst -sha256 -hmac "$SECRET_SERVICE" -hex | awk '{print $NF}')
SIGNATURE=$(printf '%s' "$STRING_TO_SIGN" | openssl dgst -sha256 -hmac "$SECRET_SIGNING" -hex | awk '{print $NF}')

AUTH="${ALGO} Credential=${TENCENTCLOUD_SECRET_ID}/${CRED_SCOPE}, SignedHeaders=content-type;host, Signature=${SIGNATURE}"

curl -sS -X POST "https://${HOST}" \
  -H "Authorization: ${AUTH}" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Host: ${HOST}" \
  -H "X-TC-Action: ${ACTION}" \
  -H "X-TC-Version: ${VERSION}" \
  -H "X-TC-Timestamp: ${TS}" \
  -d "$PAYLOAD"
echo