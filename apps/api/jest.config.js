module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^minio$': '<rootDir>/test/mocks/minio.ts',
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testEnvironment: 'node',
};
