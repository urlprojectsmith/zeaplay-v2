module.exports = {
  apps: [
    {
      name: 'zeaplay-api',
      cwd: __dirname,
      script: 'node_modules/dotenv-cli/cli.js',
      args: '-e .env -- node apps/api/dist/src/main.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'production',
      },
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: 'zeaplay-web',
      cwd: __dirname,
      script: 'node_modules/dotenv-cli/cli.js',
      args: '-e .env -- pnpm --dir apps/web next start -p 7100',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'production',
      },
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
