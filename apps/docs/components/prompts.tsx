/**
 * The copy-paste install prompts, and the banned-word list they have to name.
 *
 * They are components rather than fenced text in the MDX for the same reason the
 * copy-law page is: `test/copy-law.test.mjs` runs `assertCopy` over every `.mdx`
 * source file, and a page that spelled the forbidden adjectives out would fail
 * its own build. The checker cannot tell a quoted rule from a claim — which is
 * the correct trade for a checker whose job is to catch the claim.
 *
 * So the words come from `BANNED` in `@surex/core/copy` at build time. The
 * prompt therefore names exactly the words the checker currently enforces, and
 * cannot fall behind it.
 */
import { BANNED } from '@surex/core/copy';

/** `safe, trusted, verified or secure` — the four adjectives, from the law itself. */
const ADJECTIVES = (BANNED as readonly { word: string }[])
  .map((r) => r.word)
  .filter((w) => ['safe', 'trusted', 'verified', 'secure'].includes(w));

export function BannedAdjectives() {
  return <>{ADJECTIVES.slice(0, -1).join(', ')} or {ADJECTIVES.at(-1)}</>;
}

const ADJ = `${ADJECTIVES.slice(0, -1).join(', ')} or ${ADJECTIVES.at(-1)}`;

const INSTALL = `Install SureX, a trust registry for MCP servers. It adds a PreToolUse hook that looks up
every MCP server before one of its tools runs, and blocks a flagged one.

1. Run these two slash commands, in order, and report what the trust prompt says before
   accepting it:
      /plugin marketplace add SantiagoDevRel/surex
      /plugin install surex@surex
2. Then run \`/surex list\` and show me its output verbatim — do not summarise it.
3. Tell me, in one line each: how many of my configured MCP servers the registry knows
   anything about, and which of them are flagged.

Do not describe any server as ${ADJ}. The word is "reviewed". If a server is clean, say it
was reviewed and nothing was found — not that it is fine.`;

const VERIFY = `Check that the SureX gate actually blocks, using the project's own malicious fixture.
Nothing here touches a third party's code.

1. git clone https://github.com/SantiagoDevRel/surex && cd surex && pnpm install
2. claude mcp add rugpull -- node "$(pwd)/packages/fixtures/mal-rug-pull/src/server.mjs"
   (on Windows, pass the absolute path with forward slashes)
3. Run \`/surex check rugpull\` and confirm the fingerprint is
   sxf1_c6b016134fddd156bb76fce9c9e2cc8d697cbd35e311a4de50af6dbf102b761b
4. Ask for the weather in Lisbon, so that you call mcp__rugpull__get_weather.
5. Show me the block message verbatim, including the provenance line and the override.
6. Do NOT run the override. Then run \`claude mcp remove rugpull\`.

Expected: the call is denied with a severity-4 finding at src/tools/weather.mjs:55, tier C,
and a line saying the evidence was fetched from Walrus and the blob ID recomputed.`;

export function InstallPrompt() {
  return <pre className="sx-term">{INSTALL}</pre>;
}

export function VerifyPrompt() {
  return <pre className="sx-term">{VERIFY}</pre>;
}

/** The same two prompts, for /llms.txt. */
export const PROMPTS = { install: INSTALL, verify: VERIFY, adjectives: ADJ };
