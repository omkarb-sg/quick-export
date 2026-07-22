import { defineConfig } from 'vitest/config'

// Live-Aras integration tests. These spawn the real PowerShell host child, talk
// to a real Aras instance, and assert byte-parity against a native export. They
// need config/test.env (see config/test.env.example) or the ARAS_* env vars set.
// Windows-only (the DLLs are .NET Framework).
export default defineConfig({
  test: {
    include: ['tests/**/*.live.test.ts', 'src/**/*.live.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
    environment: 'node',
    // Live export runs spawn PowerShell + CodeDom compile + a real export; give them room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Serialize by default so parallel PowerShell/CodeDom compiles don't thrash;
    // the multi-instance isolation test explicitly opts into concurrency itself.
    fileParallelism: false
  }
})
