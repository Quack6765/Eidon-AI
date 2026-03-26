import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HERMES_ADMIN_USERNAME: z.string().min(1).default("admin"),
  HERMES_ADMIN_PASSWORD: z.string().min(8).default("changeme123"),
  HERMES_SESSION_SECRET: z.string().min(32).default("development-session-secret-please-change"),
  HERMES_ENCRYPTION_SECRET: z.string().min(32).default("development-encryption-secret-please-change"),
  HERMES_DATA_DIR: z.string().default("./.data")
});

export const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === "production";
