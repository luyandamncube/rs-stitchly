# Design Lab Contract

## Purpose

`design_lab` contains isolated static UI studies for Stitchly. It is a review and pattern-approval surface, not the production app.

## Rules

- Use static/mock data only.
- Do not add backend integration, production routing, auth, persistence, or build-system coupling.
- Keep each sample focused on one surface, state family, or interaction question.
- Review the area `README.md` before changing or adding samples.
- When graduating a pattern, implement it in `apps/web` separately and keep the production change scoped.

## Area Map

- `nodes`: node card visual language and node families.
- `runs`, `runs_history`, `runs_node`: run lifecycle, run history, and node runtime states.
- `menu`: canvas rail/menu treatments.
- `canvas`: canvas control and node-management panels.
- `dashboard`, `data_sources`, `integrations`, `login`: broader app surfaces.

Use `.codex/skills/stitchly-ui-work` for design-lab work.
