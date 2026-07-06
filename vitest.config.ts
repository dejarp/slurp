import type { ViteUserConfig } from "vitest/config"

const config: ViteUserConfig = {
  esbuild: {
    target: "es2020"
  },
  test: {
    sequence: {
      concurrent: true
    },
    include: ["packages/*/test/**/*.test.ts"],
    passWithNoTests: true,
    fileParallelism: false,
    testTimeout: 30000
  }
}

export default config
