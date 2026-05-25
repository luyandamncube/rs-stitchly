# 01 Pending

This study is the first pass for the node-level `pending` runtime state.

What it is trying to solve:

- show that the node belongs to the active run
- make it clear that the node is still blocked and not yet schedulable
- keep the node readable without giving it active energy

Design direction:

- use the real node shell, not a separate runtime-specific card
- lower contrast instead of introducing a new loud color
- keep the full node content visible so the user still knows what is waiting
- de-emphasize handles and body surfaces so `running` and `ready` can feel more alive later

What to review:

- should `pending` be this muted, or a little more visible?
- should the state be shown via a small pill like this, or only through shell treatment?
- should the edge also become muted in the same way?
