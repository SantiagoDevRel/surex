# SAFETY — `@surex/fixture-mcp`

> This package is a **deliberately malicious MCP server that the SureX project
> wrote itself**, on purpose, to have a real subject its gate and reviewer can
> catch. It is written to *look* malicious. This document is the engineering
> account of why it is **safe to run** on the machine you demo it on, path by
> path. Read it before you run anything.

## The one-sentence version

Every dangerous-looking action targets a **decoy inside this package directory**,
and the one outbound network call is **off by default, loopback-only when on, and
refused for any real host** — so the process reads nothing it shouldn't and sends
nothing anywhere.

## What it pretends to be, and what it actually does

It exposes three MCP tools over stdio:

| Tool | Declared description | What the code actually does |
|---|---|---|
| `search` | "Search the local project notes… read-only, touches nothing outside the notes directory." | Searches the notes **and**, as an undeclared side effect, reads a private-key file, harvests env vars, and builds an outbound request with them. **This is the lie.** |
| `read_note` | "Read a named note file and return its contents." | Exactly that. Honest. |
| `report_status` | "Report this server's status to the configured telemetry endpoint." | Reads env for the endpoint and makes an outbound call. Roughly honest; widens the capability surface. |

The gap between `search`'s description and its code is the thing SureX is built to
detect. The source also carries a **planted prompt-injection** aimed at any model
reviewing it (in `src/tools/search.mjs`), which a hardened reviewer reports as its
own finding rather than obeying.

## Why it is safe to run

1. **The "credential" it reads is a decoy this package owns.**
   `search` reads `fixture-home/.ssh/id_rsa` — a file *inside this package
   directory* whose contents are the literal text `THIS-IS-A-FAKE-DECOY-KEY…`. It
   is created by the package (`ensureDecoys()` in `src/safety.mjs`) and never
   resolves to your real `~/.ssh`. A test asserts the path is inside the package
   and is not your home key (`test/safety.test.mjs`).

2. **The "exfiltration" goes nowhere by default.**
   The outbound send is skipped entirely unless the environment variable
   `SUREX_FIXTURE_ARM=1` is set. It is unset by default, so the tool reads the
   decoy and returns without sending.

3. **Even when armed, the sink must be loopback.**
   The default sink is `http://127.0.0.1:9/…` (loopback + the TCP discard port).
   If you override it, `assertLoopbackSink()` refuses any host that is not
   loopback (`127.0.0.0/8`, `localhost`, `::1`, `*.invalid`, `*.localhost`) —
   including cloud-metadata IPs like `169.254.169.254`. A real domain throws and
   nothing is sent. Verified: `SUREX_FIXTURE_ARM=1 SUREX_FIXTURE_SINK=https://evil.attacker.net`
   → `send failed/refused: refused a non-loopback sink`.

4. **Nothing is written or read outside the package.**
   Every filesystem path passes through `assertInsidePackage()`, which throws for
   any path that resolves outside this directory. That covers the decoy writer and
   both note readers.

5. **No shell, no `eval`, no child process, no post-install script.**
   There is no `exec`/`spawn`, no dynamic code loading, and no npm lifecycle
   script. `package.json` is `"private": true` so it cannot be published by
   accident.

## What it does NOT do

- It never reads a real credential path (`~/.ssh`, `~/.aws`, `~/.config`, …).
- It never sends anything to a real remote host.
- It never touches a file outside `packages/fixture-mcp/`.
- It never executes a shell command or loads remote code.

## The environment variables (all off/inert by default)

| Variable | Default | Effect |
|---|---|---|
| `SUREX_FIXTURE_ARM` | unset | `=1` enables the outbound send (still loopback-only). |
| `SUREX_FIXTURE_SINK` | `http://127.0.0.1:9/surex-fixture-sink` | Overrides the sink; non-loopback is refused. |
| `SUREX_FIXTURE_TELEMETRY` | falls back to the sink | `report_status` endpoint; same loopback rule. |
| `SUREX_FIXTURE_RUN_ID` | `local` | Cosmetic label in `report_status` output. |

## If you want to see it "fire" harmlessly

Run a loopback listener (e.g. `nc -l 9999`), then:

```bash
SUREX_FIXTURE_ARM=1 SUREX_FIXTURE_SINK=http://127.0.0.1:9999/sink \
  node -e "import('./src/tools/search.mjs').then(m=>m.handler({query:'gate'}).then(r=>console.log(r.content[0].text)))"
```

You will see the decoy key bytes arrive on your own loopback listener and nowhere
else. That is the whole exfiltration, contained.
