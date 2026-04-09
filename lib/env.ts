import { z } from "zod";

const fixedOffsetTimeZonePattern = /^[+-](?:[01]\d|2[0-3])(?::?[0-5]\d)?$/;

function isValidIanaTimeZone(value: string) {
  if (fixedOffsetTimeZonePattern.test(value)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const nodeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TZ: z
    .string()
    .min(1)
    .default("UTC")
    .refine(isValidIanaTimeZone, "TZ must be a valid IANA timezone"),
  EIDON_PASSWORD_LOGIN_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  EIDON_ADMIN_USERNAME: z.string().min(1).default("admin"),
  EIDON_ADMIN_PASSWORD: z.string().min(8).optional(),
  EIDON_SESSION_SECRET: z.string().min(32).optional(),
  EIDON_ENCRYPTION_SECRET: z.string().min(32).optional(),
  EIDON_DATA_DIR: z.string().default("./.data"),
  EIDON_GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
  EIDON_GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
  EIDON_GITHUB_APP_CALLBACK_URL: z.string().url().optional()
});

const sensitiveEnvNames = [
  "EIDON_ADMIN_PASSWORD",
  "EIDON_SESSION_SECRET",
  "EIDON_ENCRYPTION_SECRET"
] as const;

type SensitiveEnvName = (typeof sensitiveEnvNames)[number];

const nonProductionDefaults: Record<SensitiveEnvName, string> = {
  EIDON_ADMIN_PASSWORD: "changeme123",
  EIDON_SESSION_SECRET: "development-session-secret-please-change",
  EIDON_ENCRYPTION_SECRET: "development-encryption-secret-please-change"
};

const productionRejectedValues: Record<SensitiveEnvName, Set<string>> = {
  EIDON_ADMIN_PASSWORD: new Set([
    nonProductionDefaults.EIDON_ADMIN_PASSWORD
  ]),
  EIDON_SESSION_SECRET: new Set([
    nonProductionDefaults.EIDON_SESSION_SECRET,
    "replace-with-32-plus-chars",
    "replace-with-a-random-32-char-string-here"
  ]),
  EIDON_ENCRYPTION_SECRET: new Set([
    nonProductionDefaults.EIDON_ENCRYPTION_SECRET,
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
    EIDON_ADMIN_PASSWORD: resolveSensitiveEnvValue(
      "EIDON_ADMIN_PASSWORD",
      parsedEnv.EIDON_ADMIN_PASSWORD,
      isProduction
    ),
    EIDON_SESSION_SECRET: resolveSensitiveEnvValue(
      "EIDON_SESSION_SECRET",
      parsedEnv.EIDON_SESSION_SECRET,
      isProduction
    ),
    EIDON_ENCRYPTION_SECRET: resolveSensitiveEnvValue(
      "EIDON_ENCRYPTION_SECRET",
      parsedEnv.EIDON_ENCRYPTION_SECRET,
      isProduction
    )
  };
}

type EidonEnv = ReturnType<typeof parseEnv>;

function getEnvValue<Key extends keyof EidonEnv>(key: Key): EidonEnv[Key] {
  const parsedEnv = nodeEnvSchema.parse(process.env);
  const isProduction = parsedEnv.NODE_ENV === "production";

  switch (key) {
    case "EIDON_ADMIN_PASSWORD":
      return resolveSensitiveEnvValue(
        "EIDON_ADMIN_PASSWORD",
        parsedEnv.EIDON_ADMIN_PASSWORD,
        isProduction
      ) as EidonEnv[Key];
    case "EIDON_SESSION_SECRET":
      return resolveSensitiveEnvValue(
        "EIDON_SESSION_SECRET",
        parsedEnv.EIDON_SESSION_SECRET,
        isProduction
      ) as EidonEnv[Key];
    case "EIDON_ENCRYPTION_SECRET":
      return resolveSensitiveEnvValue(
        "EIDON_ENCRYPTION_SECRET",
        parsedEnv.EIDON_ENCRYPTION_SECRET,
        isProduction
      ) as EidonEnv[Key];
    default:
      return parsedEnv[key] as EidonEnv[Key];
  }
}

export const env = new Proxy({} as EidonEnv, {
  get(_target, property) {
    if (typeof property !== "string") {
      return undefined;
    }

    return getEnvValue(property as keyof EidonEnv);
  }
});

export function isPasswordLoginEnabled() {
  return getEnvValue("EIDON_PASSWORD_LOGIN_ENABLED");
}

export function isProduction() {
  return getEnvValue("NODE_ENV") === "production";
}
