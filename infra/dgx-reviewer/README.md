# DGX reviewer — the front door for the review model

The reviewer runs an open-source model on a home NVIDIA DGX. The deployed API
reaches it through a Cloudflare tunnel, and this directory is what stands between
the public internet and an open GPU port.

```
Vercel  ──►  https://surex-reviewer.santiagodevrel.dev/v1   (Cloudflare tunnel)
             └─►  DGX 127.0.0.1:11500   proxy.mjs   (systemd, Restart=always)
                  └─►  DGX 127.0.0.1:11434   ollama
```

## Why a proxy at all

An open `ollama` port on a residential machine is a free GPU for anyone who finds
the hostname. `proxy.mjs` refuses everything without a bearer token (timing-safe
compare) and forwards only the four paths the reviewer actually calls:

| path | |
|---|---|
| `/v1/chat/completions`, `/v1/completions` | the review |
| `/v1/models` | the only probe that separates "down" from "loading" (FRICTION-LOG D3) |
| `/api/tags` | cheap liveness |
| **anything else** | **404** — notably `/api/pull`, so nobody can make the box download models |
| `/healthz` | 200, no auth, says nothing about what is behind it |

Request bodies are **never logged**: they carry the source code under review.

## Two traps, both paid for and recorded here

- Forwarding `authorization: undefined` throws `ERR_HTTP_INVALID_HEADER_VALUE` in
  node's http client and took the whole process down on the first authorised
  request. The header must be **deleted**, not set to undefined — see
  `forwardHeaders`.
- A throw anywhere in the request handler used to exit the process. It is now
  wrapped so one malformed request cannot take the reviewer offline mid-review.

## Install on the DGX

```bash
scp infra/dgx-reviewer/proxy.mjs spark:/home/santiagodevrel/surex-reviewer-proxy.mjs
ssh spark 'sudo mkdir -p /etc/surex \
  && printf "SUREX_REVIEWER_TOKEN=%s\n" "<a long random token>" | sudo tee /etc/surex/reviewer.env \
  && sudo chmod 600 /etc/surex/reviewer.env'
scp infra/dgx-reviewer/surex-reviewer-proxy.service spark:/tmp/
ssh spark 'sudo mv /tmp/surex-reviewer-proxy.service /etc/systemd/system/ \
  && sudo systemctl daemon-reload && sudo systemctl enable --now surex-reviewer-proxy'
```

The same token goes in `SUREX_REVIEWER_API_KEY` on the API deployment. It is kept
in `.secrets/surex-wallets.txt` (`[surex-dgx-reviewer]`), never in this repo.

## Operate

```
systemctl status surex-reviewer-proxy
journalctl -u surex-reviewer-proxy -f          # never prints bodies, only path + status + ms
curl https://surex-reviewer.santiagodevrel.dev/healthz    # 200, no auth
```

Re-warm the model from anywhere:

```bash
curl -X POST https://arkiv-surex-api.vercel.app/a/$SUREX_ADMIN_SLUG/load-model \
  -H 'x-surex-admin-password: 123' -H 'content-type: application/json' -d '{}'
```
