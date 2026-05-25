# 03 Running

This study is the first pass for the node-level `running` runtime state.

What it is trying to solve:

- make the active node obvious at a glance
- show more energy than `ready` without feeling noisy
- let the footer and edge participate in the live state

Design direction:

- stronger lava shell and handle treatment than `ready`
- slightly brighter node interior so the active unit pulls forward
- footer copy becomes live and operational instead of static
- incoming edge is allowed to feel active too

What to review:

- is this active enough, or too heavy?
- should the active state live more in the handles and edge, and less in the whole shell?
- should the running footer be more explicit than `Connecting...`?
