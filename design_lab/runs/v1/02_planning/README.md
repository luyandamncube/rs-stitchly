# 02 Planning

This study isolates `planning` as its own workflow run state instead of hiding
it inside `running`.

What it is trying to solve:

- make setup feel active without looking like node execution
- show that a run can still fail before real work begins
- give technical visibility into the runtime preparation pipeline

Design notes:

- cooler blue accent instead of the orange active-execution family
- phase checklist is the main content, not live node logs
- metrics focus on setup progress and resolved dependencies
- footer copy explains that the run is live, but still pre-execution
