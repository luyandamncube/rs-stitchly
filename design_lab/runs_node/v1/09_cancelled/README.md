# 09 Cancelled

This study is the first pass for the node-level `cancelled` runtime state.

What it is trying to solve:

- show that the interruption is complete
- keep the node terminal but calmer than failure
- preserve enough context to understand what was stopped

Design direction:

- soft interruption residue instead of active or failure-heavy treatment
- the shell settles down once cancellation completes
- footer confirms the final stop in neutral language
- edge should feel inactive and finished

What to review:

- is this distinct enough from both `failed` and `skipped`?
- should cancelled feel even calmer than this?
- is `Stopped` the right final footer label?
