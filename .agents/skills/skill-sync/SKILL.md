---
name: skill-sync
description: Manually synchronize this project's Codex (.agents) and Claude (.claude) configuration so both tools stay in lockstep around one source of truth. Use when the user asks to sync skills, sync Codex and Claude, reconcile skill wrappers, propagate a skill improvement to the other tool, after creating/editing/deleting a project skill, or after editing a root instruction file. It reconciles the skill inventory, regenerates or updates the Claude delegating wrappers and the Codex agents/openai.yaml from the canonical .agents/skills definitions, syncs name/description frontmatter plus reference lists, verifies the root docs (AGENTS.md is canonical; CLAUDE.md imports it), and reports orphans or conflicts for the user to resolve instead of deleting work. Manual only, never auto-run.
---

# Skill Sync

## Purpose

Keep this project's Codex and Claude configuration in lockstep so a skill or
instruction improved for one tool is instantly reflected for the other. This skill
does not invent or rewrite skill logic; it reconciles the two tools' entry points
around the single source of truth described in `.claude/README.md`.

## Source-of-truth model (read before changing anything)

- **Canonical skill logic + memory** live once under `.agents/skills/<name>/`
  (`SKILL.md`, `references/`). Both tools use these files.
- **Claude discovery wrappers** live under `.claude/skills/<name>/SKILL.md`. A
  wrapper is thin: it carries the matching `name` + `description` frontmatter and
  delegates to the canonical `.agents/skills/<name>/SKILL.md`. No real logic.
- **Codex discovery metadata** lives under `.agents/skills/<name>/agents/openai.yaml`.
- **Root instructions**: `AGENTS.md` is canonical; `CLAUDE.md` is just `@AGENTS.md`
  (a Claude import), so the two root docs never drift.

Invariant: logic and self-improving memory stay single-sourced in `.agents/`;
`.claude/skills/` holds only wrappers; the root docs stay single-sourced via import.

## Manual only

Run this only when the user explicitly asks for a sync. Never trigger it
automatically from another skill or as a side effect.

## Exemptions — never touch during a sync

`.agents/rules/`, `.agents/_shared/`, `projects/`, `.gstack/`, any vendored
`browse` skill, and binary assets. Those are not part of the Codex/Claude
entry-point layer.

## Templates

**Claude wrapper** (frontmatter copied verbatim from the canonical skill;
reference bullets list every file in the canonical `references/` folder):

```markdown
---
name: <name>
description: <verbatim copy of the canonical description>
---

# <Title> (Claude wrapper)

This is the Claude discovery wrapper for the **<name>** skill. The canonical
definition lives under `.agents/` so Codex and Claude share one source of truth.

When this skill runs:

1. Read and follow `.agents/skills/<name>/SKILL.md` exactly.
2. Read the references it points to, including <list each `.agents/skills/<name>/references/*.md`>.
3. Apply the project rules in `CLAUDE.md` / `AGENTS.md` and `.agents/rules/`.
4. Write any skill self-improvement back to `.agents/skills/<name>/references/memory.md` (the single canonical copy), never a Claude-side duplicate.

Do not duplicate the skill logic here. If this wrapper and the canonical file ever
disagree, `.agents/skills/<name>/SKILL.md` wins.
```

**Codex metadata** (generate from frontmatter when `agents/openai.yaml` is missing):

```yaml
interface:
  display_name: '<Title Case name>'
  short_description: '<one-line summary derived from the description>'
  default_prompt: 'Use $<name> to <short action>.'
```

## Workflow (report every action)

### 1. Build the inventory

- Canonical skills = every subdir of `.agents/skills/` containing a `SKILL.md`,
  minus exemptions.
- Claude wrappers = every subdir of `.claude/skills/` containing a `SKILL.md`.
- Record each skill's canonical `name` + `description` and its `references/` files.

### 2. Reconcile each canonical skill (agents → claude)

1. No `.claude/skills/<name>/SKILL.md` → create it from the wrapper template.
2. Exists and is a proper wrapper → if `name`/`description` differs from canonical,
   update the wrapper frontmatter to match exactly; if the reference bullets don't
   list every current `references/*.md`, update them.
3. The Claude file is **not** a wrapper (holds real instructions / lacks the
   delegation pointer) → treat it as a Claude-side improvement: show the user a
   diff of what it has that canonical lacks, and on confirmation merge those
   improvements into `.agents/skills/<name>/` then restub the wrapper. Never
   overwrite canonical logic without showing the change first.

### 3. Reconcile Codex metadata

Ensure every canonical skill has `agents/openai.yaml`; generate from the template
if missing; leave hand-tuned values alone.

### 4. Handle orphans (claude → agents)

For every Claude wrapper with no matching canonical skill, report it (never
auto-delete). Offer: (a) remove the orphan wrapper, or (b) promote it into a new
canonical `.agents/skills/<name>/` skill (logic + references + `openai.yaml`) and
restub the wrapper.

### 5. Verify the root docs

Confirm `CLAUDE.md` is `@AGENTS.md` (or otherwise imports it). If `CLAUDE.md`
contains hand-written content that diverges from `AGENTS.md`, stop and ask the
user which side is authoritative before changing anything. If `AGENTS.md` lists
skills, refresh that list to match the canonical inventory.

### 6. Report

Print a summary table: created / updated / generated / flagged / awaiting user
decision. If nothing was out of sync, say so explicitly.

## Output format

```markdown
## Skill Sync Report

### Inventory

- Canonical skills: <list>
- Claude wrappers: <list>

### Actions Taken

| Item | Type | Action |
| ---- | ---- | ------ |

### Needs Your Decision

- <orphans, content-bearing Claude files to migrate, divergent root docs>

### Result

- In sync: <yes/no>. <one-line summary>
```

## Safety

- Manual only; never auto-run.
- Never delete user work silently — orphans and conflicts are reported, not removed.
- Never overwrite canonical skill logic or root-doc prose without showing the
  change and getting confirmation.
- Keep edits scoped to the entry-point layer: wrappers, `openai.yaml`, and the
  root docs. Never touch the exemptions.

## Self-improvement

Read `references/memory.md` every run. Update it when the sync model changes (new
file type to keep in lockstep, new exemption), a recurring drift pattern appears,
or the user corrects how a conflict should be resolved.
