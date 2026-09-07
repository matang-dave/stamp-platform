// Shared vitest setup for apps/web component tests (jsdom + testing-library).
// Task-specific msw servers belong in the task's own test files, not here.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
