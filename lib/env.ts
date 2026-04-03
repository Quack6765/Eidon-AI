import { z } from "zod";

const nodeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HERMES_PASSWORD_LOGIN_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  HERMES_ADMIN_USERNAME: z.string().min(1).default("admin"),
  HERMES_ADMIN_PASSWORD: z.string().min(8).optional(),
  HERMES_SESSION_SECRET: z.string().min(32).optional(),
  HERMES_ENCRYPTION_SECRET: z.string().min(32).optional(),
  HERMES_DATA_DIR: z.string().default("./.data")
});

const sensitiveEnvNames = [
  "HERMES_ADMIN_PASSWORD",
  "HERMES_SESSION_SECRET",
  "HERMES_ENCRYPTION_SECRET"
] as const;

type SensitiveEnvName = (typeof sensitiveEnvNames)[number];

const nonProductionDefaults: Record<SensitiveEnvName, string> = {
  HERMES_ADMIN_PASSWORD: "changeme123",
  HERMES_SESSION_SECRET: "development-session-secret-please-change",
  HERMES_ENCRYPTION_SECRET: "development-encryption-secret-please-change"
};

const productionRejectedValues: Record<SensitiveEnvName, Set<string>> = {
  HERMES_ADMIN_PASSWORD: new Set([
    nonProductionDefaults.HERMES_ADMIN_PASSWORD
  ]),
  HERMES_SESSION_SECRET: new Set([
    nonProductionDefaults.HERMES_SESSION_SECRET,
    "replace-with-32-plus-chars",
    "replace-with-a-random-32-char-string-here"
  ]),
  HERMES_ENCRYPTION_SECRET: new Set([
    nonProductionDefaults.HERMES_ENCRYPTION_SECRET,
    "replace-with-32-plus-chars",
    "replace-with-a-random-32-char-string-here"
  ])
};

function resolveSensitiveEnvValue(
  name: SensitiveEnvName,
  value: string | undefined,
  isProduction: boolean
) {
  if (value) {
    if (isProduction && productionRejectedValues[name].has(value)) {
      throw new Error(
        `Environment variable ${name} must be changed from its default or placeholder value before production startup`
      );
    }

    return value;
  }

  if (isProduction) {
    throw new Error(`Environment variable ${name} is required in production`);
  }

  return nonProductionDefaults[name];
}

export function parseEnv(input: NodeJS.ProcessEnv) {
  const parsedEnv = nodeEnvSchema.parse(input);
  const isProduction = parsedEnv.NODE_ENV === "production";

  return {
    ...parsedEnv,
    HERMES_ADMIN_PASSWORD: resolveSensitiveEnvValue(
      "HERMES_ADMIN_PASSWORD",
      parsedEnv.HERMES_ADMIN_PASSWORD,
      isProduction
    ),
    HERMES_SESSION_SECRET: resolveSensitiveEnvValue(
      "HERMES_SESSION_SECRET",
      parsedEnv.HERMES_SESSION_SECRET,
      isProduction
    ),
    HERMES_ENCRYPTION_SECRET: resolveSensitiveEnvValue(
      "HERMES_ENCRYPTION_SECRET",
      parsedEnv.HERMES_ENCRYPTION_SECRET,
      isProduction
    )
  };
}

export const env = parseEnv(process.env);
const isProduction = env.NODE_ENV === "production";

export const isPasswordLoginEnabled = env.HERMES_PASSWORD_LOGIN_ENABLED;
export { isProduction };
