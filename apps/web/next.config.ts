import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // `@surex/core` is a zero-dependency ESM workspace package with no build step.
  // Next has to transpile it rather than treat it as an external.
  transpilePackages: ['@surex/core'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default config;
