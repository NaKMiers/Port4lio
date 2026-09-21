# .claude — Claude compatibility layer

This project is shared by **Codex** and **Claude Code**. To avoid two diverging
copies of the rules, skills, and self-improving memory, there is exactly **one
source of truth**, and it lives under `.agents/`:

```text
.agents/
  rules/     operating + coding rules for all agents and skills   (canonical)
  _shared/   durable project memory + reusable systems + assets    (canonical, optional)
  skills/    canonical skill definitions: SKILL.md + references/ + agents/openai.yaml
.claude/
  skills/    thin discovery wrappers that delegate to .agents/skills (this folder)
```

## How the two tools load instructions

| Concern              | Codex                                              | Claude                                                |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Root instructions    | `AGENTS.md`                                        | `CLAUDE.md` (imports `AGENTS.md`)                     |
| Skill discovery      | `.agents/skills/*/agents/openai.yaml` + `SKILL.md` | `.claude/skills/*/SKILL.md` (wrapper)                 |
| Skill logic + memory | `.agents/skills/*/SKILL.md` + `references/`        | same canonical files, via the wrapper                 |
| Rules / shared brain | `.agents/rules/` + `.agents/_shared/`              | `.agents/rules/` + `.agents/_shared/` (read directly) |

## Why wrappers instead of symlinks

At the machine level (`~/.codex/skills` → `~/.claude/skills`) skills are mirrored
with **symlinks** because that dir is local and never committed. Inside a project
that is **committed to git and may travel to Windows**, symlinks are fragile — so
the project mirror uses **thin wrapper files** instead.

Claude only auto-discovers skills under `.claude/skills/`. Each wrapper here
carries the matching `name` + `description` frontmatter so Claude can find and
select the skill, then delegates to the canonical
`.agents/skills/<name>/SKILL.md` for the actual instructions. Nothing else is
duplicated: rules, the shared brain, binary assets, and each skill's
self-improving `references/memory.md` stay single-sourced under `.agents/`, so a
lesson learned in a Claude session and a Codex session lands in the same file.

## The root docs

`AGENTS.md` is Codex's auto-loaded entry point. `CLAUDE.md` is Claude's — and it
is just `@AGENTS.md` (a Claude import), so the two never drift: both tools read
the same root instructions from one file.

## Keeping things in sync

Run the **skill-sync** skill (canonical: `.agents/skills/skill-sync/`) whenever
you add, edit, or remove a skill, or edit a root doc. It reconciles the skill
inventory, regenerates/updates the Claude delegating wrappers and Codex
`agents/openai.yaml` from the canonical `.agents/skills` definitions, syncs
`name`/`description` frontmatter plus reference lists, and reports orphans or
conflicts for you to resolve — it never deletes your work. Manual only.

Rules it enforces:

- Edit skill logic, workflow, and memory **only** under `.agents/skills/`.
- If you change a skill's `name`/`description`, copy the new frontmatter into the
  matching `.claude/skills/<name>/SKILL.md` wrapper (skill-sync does this).
- Root instructions stay single-sourced: edit `AGENTS.md`; `CLAUDE.md` imports it.
- New canonical skill → add a matching wrapper here (+ `openai.yaml` for Codex).
