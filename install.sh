#!/usr/bin/env bash
# Install joseph-no-skills into ~/.claude/skills/ via symlinks.
# Re-run safe: existing symlinks are replaced; existing real directories are
# refused (so we don't clobber a skill you've edited in place).

set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${HOME}/.claude/skills"

SKILLS=(
  interactive-plan
  codex-audit
  write-like-joseph
)

mkdir -p "${DEST_DIR}"
echo "Installing skills from ${SRC_DIR} -> ${DEST_DIR}"
echo

installed=0
skipped=0
for skill in "${SKILLS[@]}"; do
  src="${SRC_DIR}/${skill}"
  dest="${DEST_DIR}/${skill}"

  if [[ ! -d "${src}" ]]; then
    echo "  skip: ${skill} (source missing)"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ -L "${dest}" ]]; then
    rm "${dest}"
  elif [[ -e "${dest}" ]]; then
    echo "  skip: ${skill} (destination exists and is NOT a symlink — won't overwrite)"
    skipped=$((skipped + 1))
    continue
  fi

  ln -s "${src}" "${dest}"
  echo "  link: ${skill} -> ${src}"
  installed=$((installed + 1))
done

echo
echo "Done. Installed: ${installed}, Skipped: ${skipped}"
echo "Then in any repo, run: claude  (skills auto-load from ~/.claude/skills/)"
echo
echo "Per-skill requirements:"
echo "  interactive-plan : bun (https://bun.sh); first launch installs deps + builds the viewer."
echo "  codex-audit      : OpenAI Codex CLI (brew install codex; codex login) + a git repo."
echo "  write-like-joseph: populate the gitignored examples/ corpus locally (not distributed)."
