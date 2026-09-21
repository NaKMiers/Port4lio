---
name: skill-sync
description: Manually synchronize this project's Codex (.agents) and Claude (.claude) configuration so both tools stay in lockstep around one source of truth. Use when the user asks to sync skills, sync Codex and Claude, reconcile skill wrappers, propagate a skill improvement to the other tool, after creating/editing/deleting a project skill, or after editing a root instruction file. It reconciles the skill inventory, regenerates or updates the Claude delegating wrappers and the Codex agents/openai.yaml from the canonical .agents/skills definitions, syncs name/description frontmatter plus reference lists, verifies the root docs (AGENTS.md is canonical; CLAUDE.md imports it), and reports orphans or conflicts for the user to resolve instead of deleting work. Manual only, never auto-run.
---

# Skill Sync (Claude wrapper)

This is the Claude discovery wrapper for the **skill-sync** skill. The canonical
definition — full source-of-truth model, workflow, templates, and self-improving
memory — lives under `.agents/` so Codex and Claude share one source of truth.

When this skill runs:

1. Read and follow `.agents/skills/skill-sync/SKILL.md` exactly.
2. Read the references it points to, including `.agents/skills/skill-sync/references/memory.md`.
3. Apply the project rules in `CLAUDE.md` / `AGENTS.md` and `.agents/rules/`.
4. Write any skill self-improvement back to `.agents/skills/skill-sync/references/memory.md` (the single canonical copy), never a Claude-side duplicate.

Do not duplicate the skill logic here. If this wrapper and the canonical file ever
disagree, `.agents/skills/skill-sync/SKILL.md` wins.
