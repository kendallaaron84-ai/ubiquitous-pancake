import { spawnSync } from "node:child_process";

const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});

if (probe.status !== 0) {
  console.log("Git metadata is unavailable; pre-commit hook installation skipped.");
  process.exit(0);
}

const configured = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});

if (configured.status !== 0) {
  throw new Error("Unable to configure the KOBA-I pre-commit quality gate.");
}
