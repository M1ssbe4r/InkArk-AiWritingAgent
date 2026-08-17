#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?usage: $0 <tag>   e.g. v0.9.5}"
PKG_DIR="${PKG_DIR:-/var/www/pkg}"
REPO="${GITHUB_REPO:-M1ssbe4r/InkArk-AiWritingAgent}"
PLATFORM="${PLATFORM:-all}"
SKIP_UNCHANGED="${SKIP_UNCHANGED:-1}"
PARALLEL="${PARALLEL:-6}"
: "${GITHUB_TOKEN:?set GITHUB_TOKEN (PAT with repo read access)}"

OWNER="${REPO%%/*}"
NAME="${REPO#*/}"

api_get() {
  curl -fsSL \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

asset_install_path() {
  case "$1" in
    InkArk_Setup.exe) echo "${PKG_DIR}/InkArk_Setup.exe" ;;
    InkArk_Setup.dmg) echo "${PKG_DIR}/InkArk_Setup.dmg" ;;
    latest.yml) echo "${PKG_DIR}/update/win/latest.yml" ;;
    latest-mac.yml) echo "${PKG_DIR}/update/mac/latest-mac.yml" ;;
    InkArk_Setup.exe.blockmap) echo "${PKG_DIR}/update/win/InkArk_Setup.exe.blockmap" ;;
    InkArk_Setup.dmg.blockmap) echo "${PKG_DIR}/update/mac/InkArk_Setup.dmg.blockmap" ;;
    *) return 1 ;;
  esac
}

verify_download() {
  local asset_name="$1" dest="$2"
  case "$asset_name" in
    latest.yml|latest-mac.yml)
      if head -c1 "$dest" | grep -q '{'; then
        echo "error: ${asset_name} download returned JSON metadata, not file content" >&2
        return 1
      fi
      ;;
    *.exe|*.dmg)
      if head -c2 "$dest" | grep -q '{'; then
        echo "error: ${asset_name} download returned JSON metadata, not binary" >&2
        return 1
      fi
      ;;
  esac
}

download_asset() {
  local asset_name="$1" dest="$2"
  read -r asset_id digest size < <(printf '%s' "$RELEASE_JSON" | python3 -c "
import json, sys
name = sys.argv[1]
data = json.load(sys.stdin)
for a in data.get('assets', []):
    if a.get('name') == name:
        print(a['id'], a.get('digest') or '', a.get('size') or 0)
        break
" "$asset_name")

  if [ -z "$asset_id" ]; then
    echo "error: asset not found on release ${VERSION}: ${asset_name}" >&2
    exit 1
  fi

  local installed
  installed=$(asset_install_path "$asset_name")
  if [ "$SKIP_UNCHANGED" = "1" ] && [ -f "$installed" ] && [ -n "$digest" ]; then
    local expected="${digest#sha256:}"
    local actual
    actual=$(sha256sum "$installed" | awk '{print $1}')
    if [ "$actual" = "$expected" ]; then
      echo "↷ ${asset_name} (unchanged, ${size} bytes)"
      cp "$installed" "$dest"
      verify_download "$asset_name" "$dest"
      return 0
    fi
  fi

  echo "↓ ${asset_name} (${size} bytes) ..."
  local t0 dt human_speed bps
  local url="https://api.github.com/repos/${OWNER}/${NAME}/releases/assets/${asset_id}"
  local curl_args=(
    -fsSL
    --connect-timeout 30
    --retry 3
    --retry-delay 5
    -H "Authorization: Bearer ${GITHUB_TOKEN}"
    -H "Accept: application/octet-stream"
    -H "X-GitHub-Api-Version: 2022-11-28"
  )
  t0=$(date +%s.%N)

  # progress=1 + TTY:后台每 1s 轮询文件大小,实时打印 [百分比] [速度] [ETA]
  # (无横条) — 不依赖 pv,避免不同发行版 pv 版本差异
  # progress=0 或非 TTY:静默走 -o
  if [ "${3:-0}" = "1" ] && [ -t 2 ] && [ -n "$size" ] && [ "$size" -gt 0 ]; then
    local monitor_pid
    (
      while true; do
        sleep 1
        local current=0
        [ -f "$dest" ] && current=$(stat -c %s "$dest" 2>/dev/null || echo 0)
        [ "$current" -le 0 ] && continue
        local elapsed
        elapsed=$(awk "BEGIN { printf \"%.0f\", $(date +%s.%N) - $t0 }")
        [ "${elapsed:-0}" -lt 1 ] && continue
        local pct rate eta
        pct=$(awk "BEGIN { printf \"%.0f\", ($current * 100.0) / $size }")
        rate=$(awk "BEGIN { printf \"%.1f\", $current / $elapsed / 1048576 }")
        if [ "$current" -lt "$size" ] && [ "$current" -gt 0 ]; then
          eta=$(awk "BEGIN { printf \"%d\", ($size - $current) * $elapsed / $current }")
        else
          eta=0
        fi
        printf "\r  %3d%%  %5.1f MB/s  ETA %3ds        " "$pct" "$rate" "$eta" >&2
        [ "$current" -ge "$size" ] && break
      done
    ) &
    monitor_pid=$!

    if ! curl "${curl_args[@]}" -o "$dest" "$url"; then
      kill "$monitor_pid" 2>/dev/null
      wait "$monitor_pid" 2>/dev/null
      printf "\n" >&2
      echo "error: download failed for ${asset_name}" >&2
      exit 1
    fi
    kill "$monitor_pid" 2>/dev/null
    wait "$monitor_pid" 2>/dev/null
    printf "\n" >&2
  else
    if ! curl "${curl_args[@]}" -o "$dest" "$url"; then
      echo "error: download failed for ${asset_name}" >&2
      exit 1
    fi
  fi
  verify_download "$asset_name" "$dest"

  dt=$(awk "BEGIN { printf \"%.1f\", $(date +%s.%N) - $t0 }")
  if [ -n "$size" ] && [ "$size" -gt 0 ] \
      && awk "BEGIN { exit !($dt > 0) }"; then
    bps=$(awk "BEGIN { printf \"%.0f\", $size / $dt }")
    human_speed=$(numfmt --to=si --suffix=B/s "$bps" 2>/dev/null || echo "${bps} B/s")
  else
    human_speed="? B/s"
  fi
  printf "  ✓ %s done: %ss, %s\n" "$asset_name" "$dt" "$human_speed"
}

echo "fetching release ${VERSION} from ${REPO}..."
RELEASE_JSON=$(api_get "https://api.github.com/repos/${OWNER}/${NAME}/releases/tags/${VERSION}") || {
  echo "error: release ${VERSION} not found (check tag name and token repo access)" >&2
  exit 1
}

REQUIRED_ASSETS=()
case "$PLATFORM" in
  all)
    REQUIRED_ASSETS=(
      InkArk_Setup.exe
      InkArk_Setup.dmg
      latest.yml
      latest-mac.yml
      InkArk_Setup.exe.blockmap
      InkArk_Setup.dmg.blockmap
    )
    ;;
  win)
    REQUIRED_ASSETS=(
      InkArk_Setup.exe
      latest.yml
      InkArk_Setup.exe.blockmap
    )
    ;;
  mac)
    REQUIRED_ASSETS=(
      InkArk_Setup.dmg
      latest-mac.yml
      InkArk_Setup.dmg.blockmap
    )
    ;;
  *)
    echo "error: PLATFORM must be all, win, or mac (got: ${PLATFORM})" >&2
    exit 1
    ;;
esac

echo "platform: ${PLATFORM} (${#REQUIRED_ASSETS[@]} assets)"

sudo mkdir -p "${PKG_DIR}/update/win" "${PKG_DIR}/update/mac"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 大文件(>= LARGE_SIZE_THRESHOLD)串行跑,pv 实时显示 [速度][百分比][ETA] (无横条)
# 小文件(< LARGE_SIZE_THRESHOLD)并行静默 — 并发 pv 会互相挤乱 stderr
LARGE_SIZE_THRESHOLD="${LARGE_SIZE_THRESHOLD:-1048576}"
LARGE_ASSETS=()
SMALL_ASSETS=()
for asset in "${REQUIRED_ASSETS[@]}"; do
  asset_size=$(printf '%s' "$RELEASE_JSON" | python3 -c "
import json, sys
name = sys.argv[1]
data = json.load(sys.stdin)
for a in data.get('assets', []):
    if a.get('name') == name:
        print(int(a.get('size') or 0))
        break
" "$asset")
  if [ -n "$asset_size" ] && [ "$asset_size" -ge "$LARGE_SIZE_THRESHOLD" ]; then
    LARGE_ASSETS+=("$asset")
  else
    SMALL_ASSETS+=("$asset")
  fi
done

# 小文件:并行静默
if [ "${#SMALL_ASSETS[@]}" -gt 0 ]; then
  running=0
  pids=()
  for asset in "${SMALL_ASSETS[@]}"; do
    download_asset "$asset" "${TMP}/${asset}" 0 &
    pids+=("$!")
    running=$((running + 1))
    if [ "$running" -ge "$PARALLEL" ]; then
      wait "${pids[0]}" || exit 1
      pids=("${pids[@]:1}")
      running=$((running - 1))
    fi
  done
  for pid in "${pids[@]}"; do
    wait "$pid" || exit 1
  done
fi

# 大文件:SKIP_LARGE=1 时跳过下载(等手动上传);否则串行 + 实时进度轮询
if [ "${#LARGE_ASSETS[@]}" -gt 0 ]; then
  if [ "${SKIP_LARGE:-0}" = "1" ]; then
    echo ""
    echo "skipping ${#LARGE_ASSETS[@]} large asset(s) (SKIP_LARGE=1),请手动上传:"
    for asset in "${LARGE_ASSETS[@]}"; do
      asset_size=$(printf '%s' "$RELEASE_JSON" | python3 -c "
import json, sys
name = sys.argv[1]
data = json.load(sys.stdin)
for a in data.get('assets', []):
    if a.get('name') == name:
        print(int(a.get('size') or 0))
        break
" "$asset")
      human_size=$(numfmt --to=si --suffix=B "$asset_size" 2>/dev/null || echo "${asset_size} B")
      case "$asset" in
        InkArk_Setup.exe) dest_paths="/var/www/pkg/InkArk_Setup.exe
/var/www/pkg/update/win/InkArk_Setup.exe" ;;
        InkArk_Setup.dmg) dest_paths="/var/www/pkg/InkArk_Setup.dmg
/var/www/pkg/update/mac/InkArk_Setup.dmg" ;;
        *)                dest_paths="/var/www/pkg/${asset}" ;;
      esac
      echo "  - ${asset} (${human_size})"
      echo "    下载: https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
      echo "    目标路径:"
      echo "$dest_paths" | sed 's/^/      /'
    done
    echo ""
  else
    for asset in "${LARGE_ASSETS[@]}"; do
      download_asset "$asset" "${TMP}/${asset}" 1
    done
  fi
fi

install_if_exists() {
  local src="$1" dest="$2"
  [ -f "$src" ] || return 0
  sudo install -m 644 "$src" "$dest"
}

install_if_exists "${TMP}/InkArk_Setup.exe"          "${PKG_DIR}/InkArk_Setup.exe"
install_if_exists "${TMP}/InkArk_Setup.dmg"          "${PKG_DIR}/InkArk_Setup.dmg"
install_if_exists "${TMP}/latest.yml"                "${PKG_DIR}/update/win/latest.yml"
install_if_exists "${TMP}/InkArk_Setup.exe"          "${PKG_DIR}/update/win/InkArk_Setup.exe"
install_if_exists "${TMP}/InkArk_Setup.exe.blockmap" "${PKG_DIR}/update/win/InkArk_Setup.exe.blockmap"
install_if_exists "${TMP}/latest-mac.yml"            "${PKG_DIR}/update/mac/latest-mac.yml"
install_if_exists "${TMP}/InkArk_Setup.dmg"          "${PKG_DIR}/update/mac/InkArk_Setup.dmg"
install_if_exists "${TMP}/InkArk_Setup.dmg.blockmap" "${PKG_DIR}/update/mac/InkArk_Setup.dmg.blockmap"

if id caddy &>/dev/null; then
  sudo chown -R caddy:caddy "${PKG_DIR}"
fi

echo "done: ${VERSION} → ${PKG_DIR}"
cat "${PKG_DIR}/update/win/latest.yml"
