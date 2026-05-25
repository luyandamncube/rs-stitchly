# 05 Failed

This study handles the terminal workflow error state.

What it is trying to solve:

- make the failing node obvious
- surface the most relevant diagnosis without overwhelming the user
- keep retry as a clear next action

Design notes:

- stronger orange-red tone than `cancelled`
- the main callout explains the operational reason, not just a status word
- node stream shows exactly where the graph stopped
- footer actions bias toward retry and deeper inspection
