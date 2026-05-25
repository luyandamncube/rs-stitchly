# 02 Ready

This study is the first pass for the node-level `ready` runtime state.

What it is trying to solve:

- show that the node is now unblocked
- make the node feel schedulable and next-in-line
- keep the state quieter than full `running`

Design direction:

- use the same node shell as the live node family
- introduce a restrained lava signal to suggest readiness
- brighten the handle and inner surfaces slightly
- keep the runtime pill and edge more energized than `pending`, but not fully active

What to review:

- is the jump from `pending` to `ready` clear enough?
- should `ready` use lava like this, or a more neutral cue?
- should the upstream context node stay muted, or should it look more obviously completed?
