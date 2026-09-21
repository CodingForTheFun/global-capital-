---
description: Deciding whether tests pass before deploying, merging, or pushing, or checking npm test output.
applies: Running the test suite and deciding whether it is safe to push or merge based on the result.
does_not_apply: Writing a new test without evaluating overall pass/fail status.
---
Never gate a deploy decision on `grep`'s exit code or on the word "fail"
appearing in test output — `grep -q fail` exits 0 whether the count is 0 or 40,
and this has previously let a build with failing tests and mutated source
files reach a deploy.

- Parse the actual count: `npm test 2>&1 | grep -oP '^# fail \K\d+'` and check
  the number is `0`, not just that some string appears or doesn't.
- Also check `git status --short` is clean (or contains only the intended
  diff) before pushing — a local run of `prepare-edge-deploy.mjs` or a similar
  script can leave mutated files staged that look like a legitimate change.
- A green `npm test` is necessary, not sufficient: also confirm a scratch boot
  of the patched runtime actually serves (see the build-time-patch-pipeline
  rule) before treating a change as deploy-ready.
