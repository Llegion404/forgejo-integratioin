module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/__mocks__/vscode.js'
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/test/**',           // Exclude integration tests
    '!src/**/*.test.ts',      // Exclude test files
    '!src/models/**',         // Exclude interfaces (no logic)
    '!src/extension.ts',      // Tested by integration tests
    '!src/providers/**',      // Tested by integration tests
  ],
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 65,
      functions: 70,
      lines: 70
    }
  },
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};
