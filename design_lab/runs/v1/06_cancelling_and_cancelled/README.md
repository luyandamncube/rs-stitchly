# 06 Cancelling And Cancelled

This study handles the interruption family.

What it is trying to solve:

- keep `cancelling` visibly active and unfinished
- make `cancelled` feel terminal but not identical to `failed`
- show that interruption can still preserve partial outputs and clean shutdown work

State split:

- `cancelling`
  Shutdown is still happening, cleanup is active, and the run is not terminal yet.
- `cancelled`
  Interruption is complete and the run has reached its final stopped state.

Design notes:

- `cancelling` shares the active orange family with `running`, but softer and more procedural
- `cancelled` shifts toward a calmer neutral error family
- both states emphasize partial results and cleanup, not success/failure semantics
