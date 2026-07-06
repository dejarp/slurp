import { execSync } from "node:child_process"

const removeDirs = ["build", "dist", "coverage", ".tsbuildinfo"]

for (const dir of removeDirs) {
  try {
    execSync(`rm -rf ${dir}`, { stdio: "inherit" })
  } catch {
    // ignore
  }
}

// Also clean per-package build artifacts
try {
  execSync("find packages -name 'build' -type d -exec rm -rf {} + 2>/dev/null || true")
  execSync("find packages -name '.tsbuildinfo' -type d -exec rm -rf {} + 2>/dev/null || true")
} catch {
  // ignore
}
