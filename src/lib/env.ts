const REQUIRED_SERVER_ENV = ["NEXTAUTH_SECRET", "MONGODB_URI"] as const;

const OPTIONAL_SERVER_ENV = [
  "AI_API_KEY",
  "AI_API_BASE_URL",
  "AI_MODEL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
] as const;

type RequiredServerEnv = (typeof REQUIRED_SERVER_ENV)[number];
type OptionalServerEnv = (typeof OPTIONAL_SERVER_ENV)[number];

type ServerEnv = Record<RequiredServerEnv, string> &
  Partial<Record<OptionalServerEnv, string>>;

function readEnvValue(key: string): string | undefined {
  const value = process.env[key];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getServerEnv(): ServerEnv {
  const missing: RequiredServerEnv[] = [];
  const env = {} as ServerEnv;

  for (const key of REQUIRED_SERVER_ENV) {
    const value = readEnvValue(key);
    if (!value) {
      missing.push(key);
      continue;
    }
    env[key] = value;
  }

  for (const key of OPTIONAL_SERVER_ENV) {
    const value = readEnvValue(key);
    if (value) {
      env[key] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. Check .env.local.`
    );
  }

  return env;
}

export function getOptionalAiConfig() {
  return {
    apiKey: readEnvValue("AI_API_KEY"),
    baseUrl: readEnvValue("AI_API_BASE_URL"),
    model: readEnvValue("AI_MODEL") ?? "gpt-4o-mini",
  };
}
