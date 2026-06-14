---
name: git-quick-save
description: Safely stage, commit, and push repository changes when the user asks to quick save, dump to git, git add/commit/push, commit and push, save current work, or provides a commit message for the current diff.
---

# Git Quick Save

Use this skill for fast git handoff flows. Support both explicit commit messages and generated messages.

## Message Handling

- If the user provides quoted text after phrases like `message`, `commit message`, `commit as`, `quick save:`, or `commit this as`, use that text exactly as the commit message.
- If the user gives an unquoted but clear message, use it exactly after trimming surrounding command words.
- If no clear message is provided, inspect the diff and generate a concise imperative commit message.
- If the diff mixes unrelated work or the generated message would be vague, stop and ask for the commit message or scope.

Good generated messages:

- `add agent routing and local Codex skills`
- `fix run detail panel overflow`
- `update workspace catalog API handling`

Avoid vague messages like `update files`, `changes`, or `work in progress` unless the user explicitly asks for one.

## Workflow

1. Run `git status --short`.
2. Run `git diff --stat`.
3. Inspect changed paths enough to identify risky, generated, or unrelated files.
4. If needed, inspect focused diffs with `git diff -- <path>` or staged diffs with `git diff --cached -- <path>`.
5. Decide the commit message:
   - explicit user message wins
   - otherwise generate one from the intended diff
6. Stage only intended files:
   - use `git add <paths>` when the intended scope is specific
   - use `git add -A` only when all changed files are clearly intended and safe
7. Run `git status --short` again and confirm staged files match the intended scope.
8. Run `git commit -m "<message>"`.
9. Run `git push`.
10. Report the branch, commit hash, message, pushed status, and any validation that was run or skipped.

## Safety Rules

- Never use `git add *`; use explicit paths or `git add -A`.
- Never stage unrelated user changes.
- Never stage secrets, credentials, tokens, or local environment files.
- Stop and ask before committing if suspicious paths are changed.
- Never amend, force-push, reset, clean, or checkout unless the user explicitly asks for that operation.
- Do not run tests automatically unless the user asked or the repo context makes validation necessary before commit.
- If tests were not run, say so in the final handoff.

Suspicious paths and patterns include:

- `.env`, `.env.*`, `*.env`, `apps/web/.env.local`, `apps/web/env.local`
- `.stitchly/**`, `*.sqlite`, `*.sqlite3`, local DB files
- `target/**`, `node_modules/**`, build output, dependency caches
- `vite-dev*.log`, `*.log`, runtime logs
- private keys, certificates, credential JSON, token dumps

## Staging Guidance

Use explicit paths when:

- the repo has unrelated dirty files
- only docs/skills should be committed
- generated files or logs are present
- the user names a feature area

Use `git add -A` when:

- `git status --short` shows only intentional files
- no suspicious paths are present
- the user clearly asked to commit all current changes

## Examples

User: `quick save with message "remove hardcoded creds"`

Action: inspect status and diff, stage intended safe files, commit with exactly `remove hardcoded creds`, push.

User: `dump this to git`

Action: inspect status and diff, generate a concise message from the changes, stage intended safe files, commit, push.

User: `commit and push the current changes`

Action: inspect status and diff. If the diff is cohesive, generate a message. If not, ask for scope or a commit message.
