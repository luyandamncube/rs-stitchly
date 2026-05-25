# 03 Running

This study defines the primary active execution state for a workflow run.

What it is trying to solve:

- make the active node obvious at a glance
- show enough recent context to understand what the workflow is doing
- keep the surface useful without turning it into a full log viewer

Design notes:

- orange accent carries the active/live execution family
- node stream is the primary narrative for progress
- recent logs give just enough supporting proof without overwhelming the card
- footer actions prioritize observability and interruption
