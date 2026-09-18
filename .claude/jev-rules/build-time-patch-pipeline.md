---
description: Editing frontdoor-prod.mjs, frontdoor-clearsports.mjs, apex-v2/server-core.mjs, apex-v2/scout-ui-v5.js, any *-runtime.mjs or *-runtime.js file, or running prepare-edge-deploy.mjs.
applies: Changing a source file that frontdoor-clearsports.mjs string-patches at boot, or running the edge-deploy prep script.
does_not_apply: Ordinary library code under lib/ that nothing string-patches.
---
This repo has a boot-time string-patch pipeline, not a build step.

- `frontdoor-clearsports.mjs` reads specific source files, applies a chain of
  sequential patches keyed on exact string anchors, writes the result to a
  `.frontdoor-clearsports-runtime.mjs` (or equivalent `-runtime.js`) file, and
  imports that instead of the original. A moved character in an anchor string
  crashes the container on boot, not at build time.
- `makeClientSafeVisualUi` runs `new Function(client)` on generated client JS.
  Invalid JS here fails container boot; `node --check` on the source file does
  not catch it, since the problem is in the generated string.
- `prepare-edge-deploy.mjs` **mutates source files in place**. Never run it
  against the working tree to "test" anything — it will leave the repo with
  patched files committed as if they were hand-written source. If it must run
  locally to verify a boot, do it against a throwaway copy of the tree, never
  the actual working directory.
- After changing an anchor string, boot the patched runtime (against a scratch
  copy) and confirm it serves before pushing, rather than trusting `node --check`
  alone.
