module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/__mocks__/vscode.js'
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        types: ['jest', 'node']
      }
    }
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/test/**',           // Exclude integration tests
    '!src/**/*.test.ts',      // Exclude test files
    '!src/__tests__/**',      // Exclude test infrastructure
    '!src/models/**',         // Exclude interfaces (no logic)
    '!src/extension.ts',      // Tested by integration tests
    '!src/webview/**',        // Webview providers require VS Code APIs, tested via integration
    // Note: providers now included with unit test coverage
  ],
  coverageThreshold: {
    global: {
      statements: 35,
      branches: 25,
      functions: 35,
      lines: 35
    }
  },
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};
