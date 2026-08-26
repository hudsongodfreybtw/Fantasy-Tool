# Tests

Browser-driven, using the Chromium that ships with this environment. No test
framework — each file is a script that exits non-zero on failure.

```sh
node tests/regress.mjs     # 22 assertions: manual mode, importers, persistence, all tabs
node tests/livesync.mjs    # live Sleeper sync against a mocked API, pick 7 shortlist
node tests/fulldraft.mjs   # drives all 16 rounds through the real UI
node tests/demo.mjs        # practice mode: fake opponents, real-draft backup/restore
```

`livesync.mjs` and `fulldraft.mjs` mock `api.sleeper.app` via Playwright route
interception, so they verify the real client code path (draft resolution, slot
detection, pick polling, name matching) without touching the network.

Set `SHOT=/some/dir` to collect screenshots.

Worth re-running after any change to `assets/engine.js` — `fulldraft.mjs` prints
the full 16-round draft it produces, which is the fastest way to see whether a
scoring tweak did something stupid.
