import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  workers: 1,
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4173/api/health',
    timeout: 30000,
    reuseExistingServer: false,
    env: { PORT: '4173', HOST: '127.0.0.1', DATABASE_PATH: 'test-results/e2e.sqlite', PUBLIC_ORIGIN: 'http://127.0.0.1:4173', NODE_ENV: 'development' },
  },
});
