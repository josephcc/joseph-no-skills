#!/usr/bin/env bash
# Extract the Braun & Clarke (2006) PDF into plain text for the skill to read.
#
# The paper is copyrighted, so neither the PDF nor the text is distributed with
# this repo (`thematic-analysis/source/` is gitignored). Obtain the PDF through
# your library or the publisher and drop it in `source/`; this script turns it
# into `source/braun-clarke-2006.txt`, which SKILL.md reads in full at load time.
#
#   Braun, V. & Clarke, V. (2006). Using thematic analysis in psychology.
#   Qualitative Research in Psychology, 3(2), 77-101. doi:10.1191/1478088706qp063oa
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${HERE}/source"
OUT="${SRC_DIR}/braun-clarke-2006.txt"

mkdir -p "${SRC_DIR}"
pdf="${1:-}"
if [[ -z "${pdf}" ]]; then
  pdf="$(ls "${SRC_DIR}"/*.pdf 2>/dev/null | head -1 || true)"
fi
if [[ -z "${pdf}" || ! -f "${pdf}" ]]; then
  echo "No PDF found. Put the Braun & Clarke 2006 PDF in ${SRC_DIR}/ (or pass its path) and re-run." >&2
  exit 1
fi
if ! command -v pdftotext >/dev/null 2>&1; then
  echo "pdftotext not found: brew install poppler" >&2
  exit 1
fi

# Reading order, not -layout: the paper is two-column and -layout interleaves the columns.
pdftotext "${pdf}" "${OUT}"
words="$(wc -w < "${OUT}" | tr -d ' ')"
echo "wrote ${OUT} (${words} words)"
if [[ "${words}" -lt 10000 ]]; then
  echo "warning: expected ~13-14k words; check that this is the full 25-page article" >&2
fi
