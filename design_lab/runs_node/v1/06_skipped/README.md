# 06 Skipped

This study is the first pass for the node-level `skipped` runtime state.

What it is trying to solve:

- make skipped feel intentional
- clearly separate it from failure
- keep enough context to explain why the node did not run

Design direction:

- heavily de-emphasized shell
- no strong error or active accent
- footer carries a short reason for the skip
- edge looks bypassed, not broken

What to review:

- is this too muted, or does it read correctly?
- should skipped be even more faded than this?
- is `Branch false` the right style of footer explanation?
