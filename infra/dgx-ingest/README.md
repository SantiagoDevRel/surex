# DGX ingest — the writer

`apps/api` on Vercel holds no wallet, on purpose. `packages/worker/src/config.mjs`
says why: the read side cannot write, and that split is the only reason a
compromised API cannot rewrite the registry. So the process that signs has to live
somewhere else — and it lives here, on the same home box that already runs the
reviewer, behind the same tunnel.

```
Vercel  ──►  https://surex-ingest.santiagodevrel.dev/v1/ingest   (Cloudflare tunnel)
             └─►  DGX 127.0.0.1:11600   ingest.mjs   (systemd, Restart=always)
                  └─►  node scripts/ingest-submission.mjs --repo … --commit … --json
                       └─► licence gate · MCP check · review · Walrus · Arkiv
```

The API validates a submission and hands it over. Everything after that — the
wallet, the GPU, the writes — happens on this box and never on Vercel.

## The contract

| | |
|---|---|
| `POST /v1/ingest` | bearer. `{repo, commit, release?, submissionId?}` → **202** `{id, status, statusUrl, queuePosition}` |
| `GET /v1/ingest/:id` | bearer. `{id, status, repo, commit, …}` where status is `queued` · `running` · `done` · `failed` |
| `GET /healthz` | 200, no auth, says nothing about what is behind it |
| **anything else** | **404** — an allowlist, same posture as the reviewer proxy |

`done` carries `result`: the JSON line the pipeline printed, verbatim —
`{ok, fingerprint, state, blobId, verdictUrl}`. `failed` carries `error`, the
`exitCode`, and a scrubbed `stderrTail`.

### `progress` — where the pipeline has got to

A review is minutes, and `running` on its own says nothing about which of those
minutes you are in. So `GET /v1/ingest/:id` also carries the last thing the
pipeline said about itself:

```json
"progress": {
  "stage": "walrus", "label": "Blob 5PLd… certified", "done": 6, "total": 8,
  "detail": { "blobId": "5PLd…", "contentSha256": "f0457c30…", "registeredBy": "wallet" },
  "at": "2026-07-25T22:14:03.118Z"
}
```

- **Stages**, in canonical order: `resolving` · `licence` · `fetching` · `starting` ·
  `reviewing` · `walrus` · `arkiv` · `done`. A run **skips** stages it does not need —
  a licence refusal never reaches `reviewing` — and `done` jumps forward when it does.
  `starting` is reserved for the pass that installs and starts a server for a real
  `tools/list`; `scripts/ingest-submission.mjs` reads the tool list from the README and
  never emits it, rather than announcing a step that did not happen.
- **`detail` carries only facts that are already known.** An unknown value is absent,
  never `null`: `blobId: null` on a screen is not an absent fact, it is a claim that
  there is no blob.
- **`progress` is not `stage`.** `progress.stage` is where the pipeline IS.
  `stage` (on a failed job) is where it STOPPED. Merging them reports a submission
  still writing its blob as one that failed at the blob.
- Absent until the pipeline has said something. A queued job has no progress, and the
  queue position is what is true then.

**How it travels.** The pipeline prints one JSON object per line to **stdout** —
`{"surexProgress":1,…}` — the same stream the result goes to. Exactly one field keeps
the two apart: **the result line has `ok` and a progress line must never have one.**
`resultFrom()` finds the result by scanning stdout backwards for the last line that
HAS `ok`, so a progress line carrying one would be served as a verdict for a review
that was still running. The emitter cannot produce one and `parseProgressLine()`
refuses one; both halves are in `infra/dgx-ingest/stdout.mjs` and
`apps/api/test/ingest-progress.test.mjs`.

stdout arrives in **arbitrary chunks** — a 200-byte object routinely lands as two
`data` events — so lines are reassembled across chunks before anything is parsed.
Parsing per chunk does not fail loudly; it drops stages at random, which reads as a
hung pipeline. Progress is persisted on a **stage change only**: a stage speaks more
than once as its facts land, and `persist()` is a full rewrite of the state file.

## Four decisions, and the failure each one prevents

**202, never the answer.** A review is minutes. An HTTP handler that waits for one
times out at every hop between here and Vercel, and a caller that retries has
started a second pipeline over a first one that is already signing. The request
returns a job id in milliseconds and the pipeline starts after the response is on
the wire.

**Concurrency 1, FIFO.** One GPU and one wallet. Two concurrent reviews fight for
the model; two concurrent pipelines sign two transaction sets at once. A repeat of
a `repo`+`commit` that is already queued or running gets that job's id back
(`deduped: true`) rather than a second run of the same writes.

**Job state is on disk, written before every transition.** A job lost to a
`systemctl restart` is a submission the maintainer was told was accepted and that
nobody will ever run. The file is written tmp-then-rename, so a crash mid-write
cannot truncate it and lose the queue.

**A job that was RUNNING at a restart comes back `failed`, not re-queued.** It may
already have written a blob or signed an Arkiv transaction; re-running it silently
would double-write the registry. It is failed with `interrupted: true` and a message
that says to check the registry for that commit first. Jobs that were still
`queued` never started, so nothing was signed and they are re-queued normally.

## What it refuses

- **No shell, anywhere.** `repo` and `commit` came off the network; the child is
  spawned with an argv array and `shell: false`.
- Every field must **start with an alphanumeric**. That is what stops a value
  beginning with `-` from reaching the pipeline as a *flag*, and what makes `..`
  unrepresentable in either half of a repo name.
- `commit` is 40 hex or it is rejected. Bodies over 8 KB are rejected unread.
- **Bodies are never logged.** The journal carries job ids, statuses and durations
  only; `repo`/`commit` live in the state file, which is `chmod 600`.
- The `stderrTail` is scrubbed before it is stored: `suiprivkey1…`, `0x`+64 hex, any
  bare 64-hex string, and anything after `KEY=`/`TOKEN=`/`SECRET=`/`PK=`. A raw
  private key looks exactly like a sha256, and between losing a hash from a crash
  dump and leaking a wallet there is no contest.
- The child inherits the environment it needs **minus `SUREX_INGEST_TOKEN`** — the
  pipeline has no use for the front door's bearer.
- **A result is never invented.** Exit 0 with no parseable JSON is a `failed` job,
  not a success. A verdict URL in front of a maintainer for a review that never ran
  is exactly what this project exists to make impossible.

## Environment

Read from `EnvironmentFile=/etc/surex/ingest.env`. **Never from this repo.**

| | default | |
|---|---|---|
| `SUREX_INGEST_TOKEN` | — | **required**, ≥24 chars, or the service refuses to start |
| `SUREX_INGEST_PORT` | `11600` | loopback only; the tunnel is the only thing that reaches it |
| `SUREX_INGEST_REPO_DIR` | `/home/santiagodevrel/surex` | cwd for the pipeline |
| `SUREX_INGEST_CMD` | `node scripts/ingest-submission.mjs` | flags are appended, never interpolated. A JSON array is also accepted, for a command with spaces in an argument |
| `SUREX_INGEST_STATE` | `/var/lib/surex/ingest-jobs.json` | `StateDirectory=surex` in the unit creates the directory |
| `SUREX_INGEST_TIMEOUT_MS` | `1200000` (20 min) | then SIGTERM, then SIGKILL |
| `SUREX_INGEST_KILL_GRACE_MS` | `10000` | between the two |

The same file also carries what **the pipeline** needs and this service only passes
through: `SUREX_REVIEWER_BASE_URL`, `SUREX_REVIEWER_API_KEY`, `SUREX_REVIEWER_MODEL`,
and the wallet — which `scripts/ingest-submission.mjs` reads from `.secrets` or from
`SUREX_SUI_SECRET` / `ARKIV_WRITER_PK`. This service never reads a key itself.

## Install on the DGX

```bash
# 1. the checkout the pipeline runs from (skip the clone if it is already there)
ssh spark 'test -d /home/santiagodevrel/surex \
  || git clone git@github.com:SantiagoDevRel/surex.git /home/santiagodevrel/surex'
ssh spark 'cd /home/santiagodevrel/surex && git pull && pnpm install --frozen-lockfile'

# 2. the service. Once this directory is committed, step 1's `git pull` is enough and
#    this scp is only the shortcut before that. BOTH files — ingest.mjs imports
#    stdout.mjs, and without it the service will not start.
ssh spark 'mkdir -p /home/santiagodevrel/surex/infra/dgx-ingest'
scp infra/dgx-ingest/ingest.mjs infra/dgx-ingest/stdout.mjs \
  spark:/home/santiagodevrel/surex/infra/dgx-ingest/

# 3. the bearer. Generate it with `openssl rand -hex 32`.
ssh spark 'sudo mkdir -p /etc/surex \
  && printf "SUREX_INGEST_TOKEN=%s\n" "<a long random token>" | sudo tee /etc/surex/ingest.env >/dev/null \
  && sudo chmod 600 /etc/surex/ingest.env'
#    then append the pipeline's own env to the SAME file:
#      SUREX_REVIEWER_BASE_URL=https://surex-reviewer.santiagodevrel.dev/v1
#      SUREX_REVIEWER_API_KEY=<the reviewer bearer>
#      SUREX_REVIEWER_MODEL=<the model id>

# 4. the unit
scp infra/dgx-ingest/surex-ingest.service spark:/tmp/
ssh spark 'sudo mv /tmp/surex-ingest.service /etc/systemd/system/ \
  && sudo systemctl daemon-reload && sudo systemctl enable --now surex-ingest'

# 5. smoke it on the box before exposing it
ssh spark 'curl -s localhost:11600/healthz'          # {"ok":true}
```

### Tunnel

Add an ingress rule to the tunnel that already serves `surex-reviewer`, **above** the
catch-all, then point DNS at it:

```yaml
  - hostname: surex-ingest.santiagodevrel.dev
    service: http://127.0.0.1:11600
```

```bash
ssh spark 'cloudflared tunnel list'                  # the tunnel already serving surex-reviewer
ssh spark 'cloudflared tunnel route dns <TUNNEL> surex-ingest.santiagodevrel.dev'
ssh spark 'sudo systemctl restart cloudflared'
curl -s https://surex-ingest.santiagodevrel.dev/healthz
```

The same token goes on the API deployment (`SUREX_INGEST_API_KEY`, alongside
`SUREX_INGEST_BASE_URL`). It belongs in `.secrets/`, never in this repo.

## Operate

```bash
systemctl status surex-ingest
journalctl -u surex-ingest -f        # ids, statuses, durations — never a body
sudo cat /var/lib/surex/ingest-jobs.json | python3 -m json.tool | head -40
```

Submit one by hand:

```bash
curl -sS -X POST https://surex-ingest.santiagodevrel.dev/v1/ingest \
  -H "Authorization: Bearer $SUREX_INGEST_API_KEY" -H 'content-type: application/json' \
  -d '{"repo":"owner/name","commit":"<40-hex>","release":"v1.0.0"}'
curl -sS -H "Authorization: Bearer $SUREX_INGEST_API_KEY" \
  https://surex-ingest.santiagodevrel.dev/v1/ingest/<id>
```

## Verify it without a GPU or a wallet

`SUREX_INGEST_CMD` is configurable precisely so the whole service can be exercised
against a stub. The JSON-array form takes an exact argv; `node -e` needs a trailing
`--` or node reads the appended `--repo` as one of its own options.

```bash
SUREX_INGEST_TOKEN=test-token-0123456789abcdefghijklmn \
SUREX_INGEST_PORT=11699 \
SUREX_INGEST_STATE=/tmp/ingest-jobs.json \
SUREX_INGEST_REPO_DIR=/tmp \
SUREX_INGEST_CMD='["node","-e","console.log(JSON.stringify({ok:true,fingerprint:\"sxf1_x\",state:\"clean\",blobId:\"b\",verdictUrl:\"u\"}))","--"]' \
node infra/dgx-ingest/ingest.mjs
```

```bash
curl -i localhost:11699/healthz                                        # 200, no auth
curl -i -X POST localhost:11699/v1/ingest -d '{"repo":"a/b","commit":"'$(printf '1%.0s' {1..40})'"}'
                                                                       # 401, no bearer
curl -i -X POST localhost:11699/v1/ingest \
  -H 'Authorization: Bearer test-token-0123456789abcdefghijklmn' \
  -H 'content-type: application/json' \
  -d '{"repo":"acme/mcp","commit":"1111111111111111111111111111111111111111"}'   # 202 + id
curl -H 'Authorization: Bearer test-token-0123456789abcdefghijklmn' \
  localhost:11699/v1/ingest/<id>                                       # done + result
```

Swap the stub to exercise the other paths: `process.exit(3)` for a failure with a
scrubbed stderr tail, a `setTimeout` longer than `SUREX_INGEST_TIMEOUT_MS` for the
timeout kill, and `kill -9` mid-job then restart for the interruption path.

## Not here, deliberately

- **No hardening directives on the unit** beyond `StateDirectory`. `ProtectHome` or
  `ProtectSystem=strict` would cut the pipeline off from the wallet in `.secrets` and
  from the paths it writes. The isolation that matters is the bearer and the
  loopback bind, not a sandbox that would break the job it exists to run.
- **No retries.** A failed pipeline is reported failed and a human decides. Retrying
  a job that may have half-written the registry is how a registry stops being one.
- **No list endpoint.** The state file is the log; the API knows its own job ids.
