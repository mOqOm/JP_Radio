const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // testディレクトリ内の.test.tsを対象
  testMatch: ['**/test/**/*.test.ts'],

  // TypeScript path alias を Jest にマッピング
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),

  // TypeScript で import/export を扱えるようにする
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },

  // Node.js 標準のモジュール解決を使う
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
};
