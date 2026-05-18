# 09 Performance And Scaling

## Purpose

Track the performance goals and scaling strategy that justify a Rust-first backend across both workflow automation and dataflow orchestration.

## What This Doc Should Capture

- latency goals
- throughput goals
- memory budgets
- startup overhead
- scheduling overhead
- artifact transfer costs
- orchestration overhead versus engine execution time
- pushdown effectiveness for data workloads
- benchmark plan
- regression benchmark suite
- scaling stages

## Early Direction

- Optimize for low idle overhead and fast local execution first.
- Treat the runtime as infrastructure, not just application code.
- For data workloads, prefer pushing compute into specialized engines and keep Stitchly's orchestration overhead thin.
- Measure before abstracting aggressively.
- Keep performance benchmarks automated so feature work does not quietly erode the lightweight runtime goals.

## Open Questions

- What are the target latency and memory budgets for the first usable build?
- Which workloads will we benchmark first, including file-based and engine-backed flows?
- When do we need multi-process or multi-machine execution?
