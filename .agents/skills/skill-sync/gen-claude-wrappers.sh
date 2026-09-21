#!/usr/bin/env bash
#
# gen-claude-wrappers.sh — regenerate .claude/skills/<name>/SKILL.md delegating
# wrappers from the canonical .agents/skills/<name>/ definitions.
#
# This is the deterministic, mechanical half of the project-local `skill-sync`
# skill (convenience for POSIX shells; on Windows or when unavailable, run the
# skill-sync skill model-driven instead). It is idempotent and never deletes a
# canonical skill. Run from the project root.
#
# For each canonical skill it:
#   - copies the exact `name:` + `description:` frontmatter from the canonical
#     SKILL.md into the wrapper,
#   - lists every references/*.md file in the wrapper's step 2,
#   - writes the standard delegation body.
#
# It reports (does not delete) orphan wrappers whose canonical skill is gone.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AGENTS="$ROOT/.agents/skills"
CLAUDE="$ROOT/.claude/skills"

[ -d "$AGENTS" ] || { echo "No .agents/skills in $ROOT"; exit 1; }
mkdir -p "$CLAUDE"

created=0; updated=0; orphans=()

# Extract a single-line frontmatter field ("name" or "description") from a SKILL.md.
frontmatter_field() {
  awk -v key="$1" '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---" { exit }
    infm {
      if ($0 ~ "^"key":[[:space:]]*") { sub("^"key":[[:space:]]*",""); print; exit }
    }
  ' "$2"
}

titlecase() { echo "$1" | tr "-" " " | awk '{ for(i=1;i<=NF;i++){ $i=toupper(substr($i,1,1)) substr($i,2) } print }'; }

for dir in "$AGENTS"/*/; do
  [ -f "${dir}SKILL.md" ] || continue
  name="$(basename "$dir")"
  src="${dir}SKILL.md"
  desc="$(frontmatter_field description "$src")"
  [ -n "$desc" ] || desc="$name skill."
  title="$(titlecase "$name")"

  # Build the references bullet list.
  refs=""
  if [ -d "${dir}references" ]; then
    for r in "${dir}references"/*.md; do
      [ -e "$r" ] || continue
      refs="${refs} \`.agents/skills/${name}/references/$(basename "$r")\`,"
    done
  fi
  refs="${refs% ,}"; refs="${refs%,}"
  [ -n "$refs" ] && refline="2. Read the references it points to, including${refs}." \
                 || refline="2. Read any references it points to under \`.agents/skills/${name}/references/\`."

  out="$CLAUDE/$name/SKILL.md"
  [ -f "$out" ] && before="$(cat "$out")" || before=""
  mkdir -p "$CLAUDE/$name"
  cat > "$out" <<EOF
---
name: ${name}
description: ${desc}
---

# ${title} (Claude wrapper)

This is the Claude discovery wrapper for the **${name}** skill. The canonical
definition lives under \`.agents/\` so Codex and Claude share one source of truth.

When this skill runs:

1. Read and follow \`.agents/skills/${name}/SKILL.md\` exactly.
${refline}
3. Apply the project rules in \`CLAUDE.md\` / \`AGENTS.md\` and \`.agents/rules/\`.
4. Write any skill self-improvement back to \`.agents/skills/${name}/references/memory.md\` (the single canonical copy), never a Claude-side duplicate.

Do not duplicate the skill logic here. If this wrapper and the canonical file ever
disagree, \`.agents/skills/${name}/SKILL.md\` wins.
EOF
  if [ -z "$before" ]; then created=$((created+1)); echo "create  $name"
  elif [ "$before" != "$(cat "$out")" ]; then updated=$((updated+1)); echo "update  $name"
  fi
done

# Report orphan wrappers (canonical skill gone). Never delete automatically.
if [ -d "$CLAUDE" ]; then
  for wdir in "$CLAUDE"/*/; do
    [ -d "$wdir" ] || continue
    wname="$(basename "$wdir")"
    [ -f "$AGENTS/$wname/SKILL.md" ] || orphans+=("$wname")
  done
fi

echo "--- summary ---"
echo "created: $created  updated: $updated"
if [ "${#orphans[@]}" -gt 0 ]; then
  echo "ORPHAN wrappers (no canonical skill; resolve by hand): ${orphans[*]}"
fi
