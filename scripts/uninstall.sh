#!/usr/bin/env bash
set -euo pipefail
lecture_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
lecture_dry=false
if [[ "${1:-}" == '--dry-run' ]]; then lecture_dry=true; shift; fi
[[ $# -eq 0 ]] || { printf '%s\n' 'Usage: bash uninstall.sh [--dry-run]' >&2; exit 1; }
[[ -f "${lecture_root}/scripts/local.mjs" && -f "${lecture_root}/package.json" ]] || { printf '%s\n' 'This is not a LectureFlow project.' >&2; exit 1; }
grep -Eq '"name"[[:space:]]*:[[:space:]]*"lectureflow"' "${lecture_root}/package.json" || exit 1
lecture_paths=()
while IFS= read -r lecture_relative; do
  lecture_relative="${lecture_relative%$'\r'}"
  [[ -n "${lecture_relative}" ]] || continue
  [[ "${lecture_relative}" != /* && "${lecture_relative}" != *'..'* ]] || { printf '%s\n' 'Refusing an unsafe uninstall path.' >&2; exit 1; }
  lecture_target="${lecture_root}/${lecture_relative}"
  lecture_parent="$(dirname -- "${lecture_target}")"
  while [[ "${lecture_parent}" != "${lecture_root}" ]]; do
    [[ "${lecture_parent}" == "${lecture_root}/"* && ! -L "${lecture_parent}" ]] || { printf '%s\n' 'A parent folder is a link; use the original project folder.' >&2; exit 1; }
    lecture_parent="$(dirname -- "${lecture_parent}")"
  done
  lecture_paths+=("${lecture_target}")
done < "${lecture_root}/scripts/uninstall-targets.txt"
if [[ "${lecture_dry}" == true ]]; then
  printf '%s\n' 'Preview only. These generated files/folders would be removed:' "${lecture_paths[@]}"
  printf '%s\n' 'Classrooms, .env, backups, source files and browser settings are preserved.'
  exit 0
fi
# PID records cover serving, dependency setup and MCP sessions, including relative commands.
for lecture_lease in "${lecture_root}/.sites-runtime/processes/"*.json "${lecture_root}/.sites-runtime/local-setup.lock"; do
  [[ -f "${lecture_lease}" ]] || continue
  lecture_pid="$(sed -nE 's/.*"pid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "${lecture_lease}")"
  if [[ -n "${lecture_pid}" ]] && kill -0 "${lecture_pid}" 2>/dev/null; then
    printf '%s\n' 'Close this project startup window and MCP clients before uninstalling.' >&2; exit 1
  fi
done
# Detect older entry points too. No process is killed by this script.
while IFS= read -r lecture_command; do
  case "${lecture_command}" in
    *"${lecture_root}/scripts/local.mjs"*|*"${lecture_root}/scripts/local-worker.mjs"*|*"${lecture_root}/scripts/bootstrap.sh"*)
      printf '%s\n' 'This project is still running. Close it before uninstalling.' >&2; exit 1;;
  esac
done < <(ps -ax -o command=)
lecture_ports=(5173)
lecture_instance=''
if command -v sha256sum >/dev/null 2>&1; then lecture_instance="$(printf '%s' "${lecture_root}" | sha256sum)";
elif command -v shasum >/dev/null 2>&1; then lecture_instance="$(printf '%s' "${lecture_root}" | shasum -a 256)"; fi
lecture_instance="${lecture_instance:0:24}"
if [[ -f "${lecture_root}/.sites-runtime/local-preferences.json" ]]; then
  lecture_saved_port="$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "${lecture_root}/.sites-runtime/local-preferences.json")"
  [[ "${lecture_saved_port}" =~ ^[0-9]+$ ]] && lecture_ports+=("${lecture_saved_port}")
fi
if command -v curl >/dev/null 2>&1; then
  for lecture_port in "${lecture_ports[@]}"; do
    [[ "${lecture_port}" -ge 1024 && "${lecture_port}" -le 65535 ]] || continue
    lecture_health="$(curl --silent --fail --max-time 2 --noproxy '*' "http://127.0.0.1:${lecture_port}/api/health" 2>/dev/null || true)"
    if [[ -n "${lecture_instance}" && "${lecture_health}" == *'"application":"lectureflow"'* && "${lecture_health}" == *"\"instance\":\"${lecture_instance}\""* ]]; then
      printf '%s\n' 'This local classroom is still running. Stop it before uninstalling.' >&2; exit 1
    fi
  done
fi
for lecture_target in "${lecture_paths[@]}"; do
  [[ "${lecture_target}" == "${lecture_root}/"* && "${lecture_target}" != "${lecture_root}" ]] || exit 1
  printf 'Removing: %s\n' "${lecture_target#"${lecture_root}/"}"
  # rm never follows directory symlinks; target paths have no trailing slash.
  rm -rf -- "${lecture_target}"
done
printf '%s\n' 'Dependencies, project-local Node.js and generated caches were removed.'
printf '%s\n' 'Classrooms, .env, backups, source files and browser settings were preserved.'
printf '%s\n' 'Run bash start.sh to reinstall. Remove the lectureflow entry in your Agent settings if no longer needed.'
