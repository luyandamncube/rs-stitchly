# 05 Failed

This study is the first pass for the node-level `failed` runtime state.

What it is trying to solve:

- make the broken node obvious immediately
- keep the card readable enough to extract the useful clue
- contrast the failed node against already-completed upstream context

Design direction:

- stronger red-orange shell and handle treatment than `running`
- footer carries a short practical failure clue
- edge can inherit the failure tone to reinforce where the graph broke
- avoid burying the node content under too much alarm styling

What to review:

- is the failure state too heavy or not strong enough?
- is `SMTP 421` the right amount of error detail in the footer?
- should the failure signal live more in the border/handle and less in the full shell?
