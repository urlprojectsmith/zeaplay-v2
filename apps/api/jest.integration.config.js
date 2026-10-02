module.exports = {
  ...require('./jest.config'),
  testRegex: '.*\\.integration-spec\\.ts$',
  globalSetup: '<rootDir>/test/integration-global-setup.js',
  globalTeardown: '<rootDir>/test/integration-global-teardown.js',
  setupFiles: ['<rootDir>/test/setup-integration-env.js', '<rootDir>/test/setup-env.ts'],
  maxWorkers: 1,
};
