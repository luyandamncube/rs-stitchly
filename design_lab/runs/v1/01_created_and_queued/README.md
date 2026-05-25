# 01 Created And Queued

This study defines the shared preflight visual family for top-level workflow
run states before planning or active execution begins.

What it is trying to solve:

- keep `created` and `queued` visibly related
- make `queued` feel slightly more operational and time-sensitive
- avoid showing execution details too early

State split:

- `created`
  The run has been accepted, but no scheduler or worker has actively touched it.
- `queued`
  The run is admitted and healthy, but blocked on execution capacity.

Design notes:

- both cards share the same neutral preflight shell
- `created` leans calmer and more administrative
- `queued` introduces queue position, estimated start, and capacity pressure
- footer actions stay light, with `Cancel run` as the main interruption affordance
