import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getConfigPath, loadConfig, setIntercomEnabled } from "./config.ts";

async function withAgentDir<T>(agentDir: string, fn: () => T | Promise<T>): Promise<T> {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    return await fn();
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
}

test("getConfigPath uses the centralized intercom runtime directory", () => {
  assert.equal(getConfigPath("/tmp/pi-agent/intercom"), join("/tmp/pi-agent", "intercom", "config.json"));
});

test("loadConfig reads config below PI_CODING_AGENT_DIR", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-intercom-config-"));

  try {
    const intercomDir = join(root, "intercom");
    mkdirSync(intercomDir, { recursive: true });
    writeFileSync(join(intercomDir, "config.json"), JSON.stringify({ status: "platform-test" }));

    await withAgentDir(root, () => {
      assert.equal(loadConfig().status, "platform-test");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig defaults to a disabled lifecycle", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-intercom-config-"));
  try {
    await withAgentDir(root, () => {
      assert.equal(loadConfig().enabled, false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setIntercomEnabled atomically persists lifecycle state while preserving config", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-intercom-config-"));
  try {
    await withAgentDir(root, () => {
      const intercomDir = join(root, "intercom");
      mkdirSync(intercomDir, { recursive: true });
      writeFileSync(join(intercomDir, "config.json"), JSON.stringify({ confirmSend: true, status: "focused" }));

      assert.deepEqual(setIntercomEnabled(true), { previousEnabled: false, enabled: true });
      assert.equal(loadConfig().enabled, true);
      assert.deepEqual(JSON.parse(readFileSync(join(intercomDir, "config.json"), "utf8")), {
        confirmSend: true,
        status: "focused",
        enabled: true,
      });
      assert.deepEqual(setIntercomEnabled(true), { previousEnabled: true, enabled: true });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig defaults inboundTrigger to current auto-trigger behavior", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-intercom-config-"));
  try {
    await withAgentDir(root, () => {
      assert.equal(loadConfig().inboundTrigger, "always");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig accepts inboundTrigger replies policy", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-intercom-config-"));
  try {
    mkdirSync(join(root, "intercom"), { recursive: true });
    writeFileSync(join(root, "intercom", "config.json"), JSON.stringify({ inboundTrigger: "replies" }));
    await withAgentDir(root, () => {
      assert.equal(loadConfig().inboundTrigger, "replies");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadConfig rejects invalid inboundTrigger values by failing closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-intercom-config-"));
  try {
    mkdirSync(join(root, "intercom"), { recursive: true });
    writeFileSync(join(root, "intercom", "config.json"), JSON.stringify({ inboundTrigger: "prompt" }));
    const previousError = console.error;
    console.error = () => undefined;
    try {
      await withAgentDir(root, () => {
        assert.equal(loadConfig().inboundTrigger, "never");
      });
    } finally {
      console.error = previousError;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
