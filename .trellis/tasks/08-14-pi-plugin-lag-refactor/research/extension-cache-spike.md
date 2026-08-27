# Extension cache spike

- Date: 2026-08-14
- Pi SDK: installed `@earendil-works/pi-coding-agent@0.84.2`
- Script: `research/extension-cache-spike.mjs`
- Isolation: disposable temporary `agentDir`, two temporary workspaces, one synthetic extension, no user Pi settings or packages loaded

## Question

Does one embedded SDK process make extension initialization a one-time host cost?

## Method

The synthetic extension has two observable phases:

1. module top-level evaluation increments `moduleImports`;
2. its extension factory increments `factoryRuns` and waits 120 ms.

The spike creates cwd-bound services four times while reusing one `ModelRuntime`:

1. workspace A, first load;
2. workspace A, second load;
3. workspace B, first load;
4. workspace A after workspace B.

## Result

| Load | Elapsed | Module imports | Factory runs |
| --- | ---: | ---: | ---: |
| A first | 131.3 ms | 1 | 1 |
| A second | 128.1 ms | 1 | 2 |
| B first | 129.7 ms | 1 | 3 |
| A after B | 133.3 ms | 1 | 4 |

The exact timings are not product targets; the fixture intentionally inserts a 120 ms factory delay to make lifecycle ownership visible.

## Conclusion

- The Node/module graph can remain warm in one process.
- The extension factory and extension instance lifecycle still execute for every new cwd-bound service/runtime.
- Reusing the process therefore removes process startup and can reduce module import work, but it does **not** make arbitrary plugin initialization a one-time host cost.
- The current PRD claims “2.3s paid once per host” and “subsequent runtimes ~ms” must become benchmark hypotheses, not acceptance criteria.
- A performance plan must distinguish cold host import, runtime factory activation, warm runtime selection, same-cwd replacement, and cross-cwd creation.
