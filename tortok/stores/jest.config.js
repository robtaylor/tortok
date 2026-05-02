// Unit-test jest config (Phase 3 Unit 2). Distinct from `e2e/jest.config.js`
// (which drives Detox against a built simulator binary). This config is
// for fast, in-process tests of pure-JS modules — auth store, helpers,
// and similar. ts-jest in node env, with the same `@/*` path mapping
// the app uses at runtime.
//
// Run via:
//   npx jest --config stores/jest.config.js
// from the `tortok/` directory.

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/stores/**/*.test.ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // Match tsconfig.json: strict TS but allow JSON imports and
        // resolve the `@/*` alias the app uses at runtime.
        target: 'es2022',
        module: 'commonjs',
        esModuleInterop: true,
        resolveJsonModule: true,
        strict: true,
        jsx: 'react',
        paths: {
          '@/*': ['./*'],
        },
        baseUrl: '.',
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
