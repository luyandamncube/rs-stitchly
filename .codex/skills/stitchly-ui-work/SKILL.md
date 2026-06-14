---
name: stitchly-ui-work
description: Route Stitchly frontend UI work for React canvas screens, menu panels, run/history surfaces, design_lab samples, visual states, CSS, frontend tests, and production integration of approved UI patterns.
---

# Stitchly UI Work

Use this skill for frontend and design-lab changes. Keep context narrow: inspect the target surface, nearby tests, and only the UI docs that define the relevant behavior.

## Context Routing

- Canvas shell, side rail, node inspector, run control: start with `apps/web/src/components/CanvasWorkspace.jsx`.
- App shell, workspace screens, canvas menu popups, runs-history popup: start with `apps/web/src/App.jsx`.
- React Flow node rendering, handles, edge behavior: start with `apps/web/src/components/WorkflowCanvas.jsx`.
- Shared frontend helpers: inspect `apps/web/src/lib/*` by symbol name before reading component files.
- Styling: search the class prefix in `apps/web/src/styles.css`; read a narrow range around the match.
- Visual exploration: use `design_lab/<area>/README.md` and the matching `design_lab/<area>/v1/*` sample.
- Tests: inspect the matching `apps/web/src/**/*.test.jsx` file before changing behavior.

## Docs To Load

Load only the docs needed for the task:

- General frontend/canvas behavior: `docs/03_ui/00_frontend_canvas.md`.
- Node interaction, validation, runtime visual state: `docs/03_ui/01_node_state_model.md`.
- UI sequencing and sandbox-first workflow: `docs/03_ui/02_ui_roadmap.md`.
- Node visual language: `docs/03_ui/03_node_reference_analysis.md`.
- Design-lab process: `docs/03_ui/04_ui_lab_workflow.md`.
- Workflow management screens: `docs/03_ui/06_workflow_management_ui.md`.
- Run history/log UI: also use `docs/00_foundation/22_run_history_and_debugging_spec.md`.

Do not load `docs/02_build/00_llm_build_prompt.md` for normal UI work.

## Working Rules

1. Use `rg` to find the smallest relevant symbol, component, class, or test.
2. Prefer narrow `sed` ranges over opening large files completely.
3. Check design-lab precedents before inventing a new visual pattern.
4. Keep production UI aligned with approved lab patterns; do not wire backend behavior into `design_lab`.
5. For substantial UI changes, run `corepack pnpm --dir apps/web test --run` and `corepack pnpm --dir apps/web typecheck` when practical.

## Token Traps

- `App.jsx`, `CanvasWorkspace.jsx`, `WorkflowCanvas.jsx`, and `styles.css` are large. Read by symbol or class range.
- Avoid broad searches for common terms like `run`, `node`, or `menu` unless scoped to a directory or class prefix.
- Avoid loading every design sample; pick the matching area first.
