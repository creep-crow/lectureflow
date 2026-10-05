#!/usr/bin/env bash
set -euo pipefail
lecture_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
lecture_tools="${lecture_root}/.sites-runtime/toolchain"
lecture_node=""
lecture_npm=""
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
  lecture_manifest="$(curl --fail --location --retry 2 --max-time 60 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt')"
  lecture_entry="$(printf '%s\n' "${lecture_manifest}" | awk -v suffix="-${lecture_os}-${lecture_arch}.tar.gz" '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-/ && substr($2,length($2)-length(suffix)+1)==suffix {print $1 " " $2; exit}')"
  [[ -n "${lecture_entry}" ]] || { printf '%s\n' 'Cannot find the official Node.js checksum.' >&2; exit 1; }
  lecture_hash="${lecture_entry%% *}"
  lecture_archive="${lecture_entry#* }"
  lecture_version="${lecture_archive#node-}"; lecture_version="${lecture_version%%-${lecture_os}-*}"
  curl --fail --location --retry 2 --max-time 300 "https://nodejs.org/dist/${lecture_version}/${lecture_archive}" --output "${lecture_tools}/${lecture_archive}"
  if command -v sha256sum >/dev/null 2>&1; then lecture_actual="$(sha256sum "${lecture_tools}/${lecture_archive}")"; else lecture_actual="$(shasum -a 256 "${lecture_tools}/${lecture_archive}")"; fi
  [[ "${lecture_actual%% *}" == "${lecture_hash}" ]] || { printf '%s\n' 'Node.js checksum mismatch. Run again to retry.' >&2; exit 1; }
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
