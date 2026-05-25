# 08 Cancelling

This study is the first pass for the node-level `cancelling` runtime state.

What it is trying to solve:

- show that interruption is underway
- keep the node visibly active, but not healthy
- make it clear that the node is not terminal yet

Design direction:

- interruption accent that sits between running and cancelled
- node still feels live, but unsettled
- footer copy stays transitional
- edge and handles keep a reduced sense of activity

What to review:

- does this feel different enough from `running`?
- should cancelling be more muted than this?
- is `Stopping...` the right footer language?
