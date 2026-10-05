#!/usr/bin/env bash
set -euo pipefail
lecture_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
lecture_tools="${lecture_root}/.sites-runtime/toolchain"
lecture_node=""
lecture_npm=""
while IFS='=' read -r lecture_setting lecture_value; do
  lecture_value="${lecture_value%$'\r'}"
  case "${lecture_setting}" in
    NODE_MIRROR) lecture_primary="${lecture_value}";;
    NODE_FALLBACK) lecture_fallback="${lecture_value}";;
  esac
done < "${lecture_root}/scripts/download-sources.conf"
lecture_mirrors=("${lecture_primary}" "${lecture_fallback}")
if [[ -n "${LECTUREFLOW_NODE_MIRROR:-}" ]]; then lecture_mirrors=("${LECTUREFLOW_NODE_MIRROR%/}"); fi
for lecture_mirror in "${lecture_mirrors[@]}"; do
  [[ "${lecture_mirror}" =~ ^https://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$ ]] || { printf '%s\n' 'LECTUREFLOW_NODE_MIRROR must be an HTTPS URL without credentials or query parameters.' >&2; exit 1; }
done
if command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22 || a===22&&b>=13 ? 0:1)' && command -v npm >/dev/null 2>&1; then
  lecture_node="$(command -v node)"
  # npm is a JavaScript entry point on Unix; resolving symlinks works with Homebrew and system packages.
  lecture_npm="$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$(command -v npm)")"
fi
if [[ -z "${lecture_node}" && -f "${lecture_tools}/node-path.txt" ]]; then
  lecture_saved="$(cat "${lecture_tools}/node-path.txt")"
  if [[ "${lecture_saved}" =~ ^node-v24\.[0-9]+\.[0-9]+-(darwin|linux)-(x64|arm64)/bin/node$ && -x "${lecture_tools}/${lecture_saved}" ]]; then
    lecture_node="${lecture_tools}/${lecture_saved}"
    lecture_npm="$(dirname "${lecture_node}")/../lib/node_modules/npm/bin/npm-cli.js"
  fi
fi
if [[ -z "${lecture_node}" ]]; then
  printf '%s\n' 'Installing a project-local Node.js 24 runtime (no sudo needed)...' >&2
  command -v curl >/dev/null || { printf '%s\n' 'Please install curl first.' >&2; exit 1; }
  case "$(uname -s)" in Darwin) lecture_os=darwin;; Linux) lecture_os=linux;; *) printf '%s\n' 'Supported systems: Windows, macOS and Linux.' >&2; exit 1;; esac
  case "$(uname -m)" in x86_64|amd64) lecture_arch=x64;; aarch64|arm64) lecture_arch=arm64;; *) printf '%s\n' 'An x64 or ARM64 computer is required.' >&2; exit 1;; esac
  mkdir -p "${lecture_tools}"
  lecture_downloaded=false
  for lecture_mirror in "${lecture_mirrors[@]}"; do
    printf 'Node.js mirror: %s\n' "${lecture_mirror}" >&2
    if ! lecture_manifest="$(curl --fail --location --retry 1 --connect-timeout 15 --max-time 30 "${lecture_mirror}/latest-v24.x/SHASUMS256.txt")"; then continue; fi
    lecture_entry="$(printf '%s\n' "${lecture_manifest}" | awk -v suffix="-${lecture_os}-${lecture_arch}.tar.gz" '$1 ~ /^[a-f0-9]+$/ && length($1)==64 && $2 ~ /^node-v24\.[0-9]+\.[0-9]+-/ && substr($2,length($2)-length(suffix)+1)==suffix {print $1 " " $2; exit}')"
    [[ -n "${lecture_entry}" ]] || continue
    lecture_hash="${lecture_entry%% *}"
    lecture_archive="${lecture_entry#* }"
    [[ "${lecture_archive}" =~ ^node-v24\.[0-9]+\.[0-9]+-(darwin|linux)-(x64|arm64)\.tar\.gz$ ]] || continue
    lecture_version="${lecture_archive#node-}"; lecture_version="${lecture_version%%-${lecture_os}-*}"
    if ! curl --fail --location --retry 1 --connect-timeout 15 --max-time 300 "${lecture_mirror}/${lecture_version}/${lecture_archive}" --output "${lecture_tools}/${lecture_archive}"; then continue; fi
    if command -v sha256sum >/dev/null 2>&1; then lecture_actual="$(sha256sum "${lecture_tools}/${lecture_archive}")"; else lecture_actual="$(shasum -a 256 "${lecture_tools}/${lecture_archive}")"; fi
    if [[ "${lecture_actual%% *}" != "${lecture_hash}" ]]; then printf '%s\n' 'Node.js checksum mismatch; trying the next source.' >&2; continue; fi
    lecture_downloaded=true
    break
  done
  [[ "${lecture_downloaded}" == true ]] || { printf '%s\n' 'All Node.js mirrors failed. Retry or set LECTUREFLOW_NODE_MIRROR.' >&2; exit 1; }
  tar -xzf "${lecture_tools}/${lecture_archive}" -C "${lecture_tools}"
  lecture_saved="${lecture_archive%.tar.gz}/bin/node"
  lecture_node="${lecture_tools}/${lecture_saved}"
  lecture_npm="$(dirname "${lecture_node}")/../lib/node_modules/npm/bin/npm-cli.js"
  "${lecture_node}" --version >&2
  printf '%s\n' "${lecture_saved}" > "${lecture_tools}/node-path.txt"
  rm -- "${lecture_tools}/${lecture_archive}"
fi
export LECTUREFLOW_NPM_CLI="${lecture_npm}"
export PATH="$(dirname "${lecture_node}"):${PATH}"
cd -- "${lecture_root}"
exec "${lecture_node}" "${lecture_root}/scripts/local.mjs" "$@"
