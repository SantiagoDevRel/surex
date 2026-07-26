import nextra from 'nextra';
import type { NextConfig } from 'next';

/**
 * Nextra 4, App Router. Mermaid needs no configuration here: `@theguild/remark-mermaid`
 * is a direct dependency of `nextra` and rewrites every ```mermaid fence into a component.
 */
const withNextra = nextra({
  defaultShowCopyCode: true,
});

const config: NextConfig = {
  reactStrictMode: true,
  // `@surex/core` is source-only ESM with no build step, so Next has to transpile
  // it rather than externalise it.
  transpilePackages: ['@surex/core'],
  // Without the monorepo root, Next traces the wrong lockfile and warns on every build.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default withNextra(config);
