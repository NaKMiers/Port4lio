# .agents — canonical agent layer (Codex + Claude source of truth)

This folder is the single source of truth for how AI agents operate in this
project. Both **Codex** and **Claude** read from here; `.claude/skills/` holds
only thin wrappers that delegate back here (see `.claude/README.md`).

```text
.agents/
  rules/     coding + operating rules (project-style, framework, api-security,
             data-and-state, frontend-ui, testing-quality). Read the focused
             rule file before changing matching code.
  _shared/   durable project memory + reusable systems + approved assets.
             Keep it small; anything that belongs to one feature lives with
             that feature, not here. (Optional — create when the project grows.)
  skills/    executable project-local skills. Each skill is:
               <name>/
                 SKILL.md              full logic, workflow, self-check
                 references/memory.md  self-improving notes (single canonical copy)
                 agents/openai.yaml    Codex discovery metadata
```

## Editing rules

- Skill logic, workflow, and self-improving memory are edited **only** here,
  under `.agents/skills/<name>/`.
- After adding/renaming/removing a skill or changing its frontmatter, run the
  **skill-sync** skill to regenerate the Claude wrappers and Codex metadata.
- Rules in `.agents/rules/` and the shared brain in `.agents/_shared/` are read
  directly by both tools — never copy them into `.claude/`.
