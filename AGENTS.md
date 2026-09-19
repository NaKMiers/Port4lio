# Port4lio - Codex agent instructions

Agent configuration for [OpenAI Codex](https://developers.openai.com/codex/). gstack skills live in `.agents/skills/`.

## Skill routing

When the user's request matches an available skill, ALWAYS run that skill as your **first** action (for example `/ship`, `/investigate`, `/qa`). Read and follow `.agents/skills/<skill-name>/SKILL.md`. Do NOT answer directly and do NOT use other tools first. Skills encode specialized workflows that work better than ad-hoc answers.

Key routing rules:

- Product ideas, "is this worth building", brainstorming → `office-hours`
- Bugs, errors, "why is this broken", 500 errors → `investigate`
- Ship, deploy, push, create PR → `ship`
- QA, test the site, find bugs → `qa`
- Code review, check my diff → `review`
- Update docs after shipping → `document-release`
- Weekly retro → `retro`
- Design system, brand → `design-consultation`
- Visual audit, design polish → `design-review`
- Architecture review → `plan-eng-review`
- Save progress, checkpoint, resume → `checkpoint`
- Code quality, health check → `health`

## Conventions

- Dropdowns: use `SelectField` (`src/components/settings/SelectField.tsx`), not a native
  `<select>`. Exception: a long/dynamic option list on a public, mobile-heavy page, where the
  native picker is worth more than visual consistency. See `CLAUDE.md` and `SelectField`'s own
  doc comment for the reasoning.
