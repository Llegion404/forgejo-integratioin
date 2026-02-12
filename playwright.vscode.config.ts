import type {
  VSCodeTestOptions,
  VSCodeWorkerOptions,
} from '@mshanemc/vscode-test-playwright';
import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: path.join(__dirname, 'src', 'test', 'e2e-vscode'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    extensionDevelopmentPath: __dirname,
    vscodeTrace: 'on',
  },
  projects: [
    {
      name: 'stable',
      use: { vscodeVersion: 'stable' },
    },
  ],
});
