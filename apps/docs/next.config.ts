import nextra from 'nextra';
import type { NextConfig } from 'next';

/**
 * Nextra 4, App Router. Mermaid needs no configuration here: `@theguild/remark-mermaid`
 * is a direct dependency of `nextra` and rewrites every ```mermaid fence into a
 * component. That is the whole reason this site has no image assets — a diagram
 * that lives in the MDX cannot drift from the prose next to it.
 */
const withNextra = nextra({
  defaultShowCopyCode: true,
});

const config: NextConfig = {
  reactStrictMode: true,
  // The reference tables are rendered from the frozen contract itself, so the
  // docs import the same zero-dependency ESM package the gate and the API do.
  // It has no build step, so Next has to transpile it rather than externalise it.
  transpilePackages: ['@surex/core'],
  // This app is a workspace member of the SureX monorepo. Without the root,
  // Next traces the wrong lockfile and warns on every build.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default withNextra(config);
