/**
 * The copy law, rendered from the law.
 *
 * `packages/core/src/copy.mjs` is the single place the rule is enforced, and the
 * banned words live there as regexes. This component reads that array so the
 * page cannot list a word the checker no longer bans, or miss one it started to.
 *
 * There is a second reason it is a component rather than a table typed into the
 * MDX: `test/copy-law.test.mjs` runs `assertCopy` over every `.mdx` file on this
 * site. A page that spelled the forbidden words out in its source would fail its
 * own build — correctly, because the checker cannot tell a quoted term from a
 * claim. Rendering them at build time keeps the page honest and the source clean.
 */
import { ALLOWED_PHRASES, BANNED, CLEAN_MEANS, NO_HUMAN_AUDIT } from '@surex/core/copy';

type Rule = { word: string; instead: string; unless?: RegExp };

export function BannedWords() {
  return (
    <table>
      <thead>
        <tr>
          <th>Never</th>
          <th>Write instead</th>
          <th>Unless the sentence is about</th>
        </tr>
      </thead>
      <tbody>
        {(BANNED as readonly Rule[]).map((rule) => (
          <tr key={rule.word}>
            <td>
              <code>{rule.word}</code>
            </td>
            <td>{rule.instead}</td>
            <td>
              {rule.unless ? (
                <code style={{ fontSize: '0.9em' }}>
                  {String(rule.unless)
                    .replace(/^\/\\b\(|\)\\b\/i$/g, '')
                    .split('|')
                    .join(' · ')
                    .replace(/\\s\*/g, ' ')}
                </code>
              ) : (
                <span style={{ opacity: 0.5 }}>—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AllowedPhrases() {
  return (
    <p>
      {ALLOWED_PHRASES.map((phrase, i) => (
        <span key={phrase}>
          {i > 0 ? ' · ' : ''}
          <code>{phrase}</code>
        </span>
      ))}
    </p>
  );
}

export function CleanMeans() {
  return (
    <blockquote>
      <p>{CLEAN_MEANS}</p>
    </blockquote>
  );
}

export function NoHumanAudit() {
  return <code>{NO_HUMAN_AUDIT}</code>;
}
