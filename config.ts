import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getIntercomDirPath } from "./broker/paths.ts";

export const DEFAULT_ASK_TIMEOUT_MS = 10 * 60 * 1000;

export function getAskTimeoutMs(): number {
  const raw = process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_ASK_TIMEOUT_MS;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("PI_INTERCOM_ASK_TIMEOUT_MS must be a positive integer number of milliseconds");
  }
  return value;
}

export type InboundTriggerPolicy = "always" | "replies" | "never";

export interface IntercomConfig {
  /** Broker command used to spawn the broker process (e.g. "npx" or "bun") */
  brokerCommand: string;

  /** Arguments passed to the broker command before the broker script path */
  brokerArgs: string[];

  /** Require confirmation before non-reply sends from interactive sessions */
  confirmSend: boolean;

  /** Controls whether inbound broker messages may automatically trigger a model turn */
  inboundTrigger: InboundTriggerPolicy;

  /** Optional custom status suffix shown after automatic lifecycle status */
  status?: string;
  
  /** Enable/disable intercom (default: false) */
  enabled: boolean;
  
  /** Show reply hint in incoming messages (default: true) */
  replyHint: boolean;
}

export function getConfigPath(intercomDir: string = getIntercomDirPath()): string {
  return join(intercomDir, "config.json");
}

const defaults: IntercomConfig = {
  brokerCommand: "npx",
  brokerArgs: ["--no-install", "tsx"],
  confirmSend: false,
  inboundTrigger: "always",
  enabled: false,
  replyHint: true,
};

export interface SetIntercomEnabledResult {
  previousEnabled: boolean;
  enabled: boolean;
}

function readConfigObject(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Config must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Persist the desired lifecycle state without exposing a partially written config.
 * A malformed existing config is deliberately left untouched so an explicit user
 * action cannot silently discard their other settings.
 */
export function setIntercomEnabled(enabled: boolean): SetIntercomEnabledResult {
  const configPath = getConfigPath();
  const raw = readConfigObject(configPath);
  const previousEnabled = loadConfig().enabled;
  const next = { ...raw, enabled };
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(configPath), { recursive: true });
  try {
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tempPath, configPath);
  } finally {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch { /* Best effort cleanup. */ }
    }
  }
  return { previousEnabled, enabled };
}

export function loadConfig(): IntercomConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { ...defaults };
  }
  
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Config must be a JSON object");
    }

    const parsedConfig = parsed as Record<string, unknown>;
    const config: IntercomConfig = { ...defaults };

    if (Object.hasOwn(parsedConfig, "brokerCommand")) {
      if (typeof parsedConfig.brokerCommand !== "string") {
        throw new Error(`"brokerCommand" must be a string`);
      }
      const brokerCommand = parsedConfig.brokerCommand.trim();
      if (!brokerCommand) {
        throw new Error(`"brokerCommand" must not be empty`);
      }
      config.brokerCommand = brokerCommand;
    }

    if (Object.hasOwn(parsedConfig, "brokerArgs")) {
      if (!Array.isArray(parsedConfig.brokerArgs)) {
        throw new Error(`"brokerArgs" must be an array`);
      }
      const brokerArgs: string[] = [];
      for (const arg of parsedConfig.brokerArgs) {
        if (typeof arg !== "string") {
          throw new Error(`"brokerArgs" items must be strings`);
        }
        brokerArgs.push(arg);
      }
      config.brokerArgs = brokerArgs;
    }

    if (Object.hasOwn(parsedConfig, "confirmSend")) {
      if (typeof parsedConfig.confirmSend !== "boolean") {
        throw new Error(`"confirmSend" must be a boolean`);
      }
      config.confirmSend = parsedConfig.confirmSend;
    }

    if (Object.hasOwn(parsedConfig, "enabled")) {
      if (typeof parsedConfig.enabled !== "boolean") {
        throw new Error(`"enabled" must be a boolean`);
      }
      config.enabled = parsedConfig.enabled;
    }

    if (Object.hasOwn(parsedConfig, "inboundTrigger")) {
      if (
        parsedConfig.inboundTrigger !== "always"
        && parsedConfig.inboundTrigger !== "replies"
        && parsedConfig.inboundTrigger !== "never"
      ) {
        throw new Error(`"inboundTrigger" must be "always", "replies", or "never"`);
      }
      config.inboundTrigger = parsedConfig.inboundTrigger;
    }

    if (Object.hasOwn(parsedConfig, "replyHint")) {
      if (typeof parsedConfig.replyHint !== "boolean") {
        throw new Error(`"replyHint" must be a boolean`);
      }
      config.replyHint = parsedConfig.replyHint;
    }

    if (Object.hasOwn(parsedConfig, "status")) {
      if (typeof parsedConfig.status !== "string") {
        throw new Error(`"status" must be a string`);
      }
      config.status = parsedConfig.status;
    }

    return config;
  } catch (error) {
    console.error(`Failed to load intercom config at ${configPath}:`, error);
    return { ...defaults, inboundTrigger: "never" };
  }
}
