---
description: What SureX knows about the MCP servers this session can call, and the override
argument-hint: "[list | why <fingerprint> | allow <fingerprint> [--once] | revoke <fingerprint> | status]"
allowed-tools: Bash
---

Run the SureX CLI with the arguments below and show the user its output verbatim. Do not summarise it and
do not re-order it — the provenance lines and the disclosure that no human audited the review are part of
the output for a reason.

The plugin's `bin/` is **not** on PATH when SureX is installed from a marketplace, so invoke it by absolute
path through node:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/surex" $ARGUMENTS
```

If `$ARGUMENTS` is empty, run it with no arguments to print the usage.

If the command is `allow`, also tell the user plainly, in your own words, that SureX had a finding against
that server, that enforcement stops for it from now on, and that the risk is theirs. Do not soften it.
