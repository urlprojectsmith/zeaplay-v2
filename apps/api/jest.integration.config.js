module.exports = {
  ...require('./jest.config'),
  testRegex: '.*\\.integration-spec\\.ts$',
  maxWorkers: 1,
};
