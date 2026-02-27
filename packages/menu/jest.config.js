module.exports = {
  collectCoverageFrom: ['<rootDir>/src/**/*.js', '!<rootDir>/src/**/*.stories.*'],
  moduleDirectories: ['node_modules', 'test'],
  moduleNameMapper: {
    '^pcln-popover$': '<rootDir>/../popover/src/index.js',
  },
  reporters: ['jest-standard-reporter'],
  setupFilesAfterEnv: ['./test/jest.setup.js'],
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/src/**/*.spec.js'],
}
