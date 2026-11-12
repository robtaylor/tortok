// Unit tests: every `*.test.ts(x)` in the app outside `e2e/`, whose Detox
// suite has its own config (e2e/jest.config.js) and drives a built binary.
// Fast, in-process tests of pure-JS modules: ts-jest in node env, with the
// same `@/*` path mapping the app uses at runtime.
//
// Run with `npm test` from `tortok/`; CI runs it (.github/workflows/ci.yml).

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  testMatch: ['<rootDir>/**/*.test.ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/'],
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
