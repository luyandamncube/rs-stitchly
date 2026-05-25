# 07 Retrying

This study is the first pass for the node-level `retrying` runtime state.

What it is trying to solve:

- show that the node is actively recovering from a failed attempt
- distinguish retrying from ordinary running
- avoid giving it the finality of a true failure

Design direction:

- keep the node in the active family
- retain a bit more visual tension than standard running
- footer carries the retry attempt detail
- edge stays active because the node is still in play

What to review:

- is retrying clearly different from `running`?
- should retrying feel more orange or more error-adjacent?
- is the footer enough, or does the shell need a stronger unstable cue?
