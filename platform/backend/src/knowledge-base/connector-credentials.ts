import type pino from "pino";
import { secretManager } from "@/secrets-manager";
import type { ConnectorCredentials } from "@/types";

export async function loadConnectorCredentials(
  secretId: string | null,
  log: pino.Logger,
): Promise<ConnectorCredentials> {
  if (!secretId) {
    throw new Error("Connector has no associated secret");
  }
  const secret = await secretManager().getSecret(secretId);
  if (!secret) {
    throw new Error(`Secret not found: ${secretId}`);
  }
  log.debug({ secretId }, "Credentials loaded");
  const data = secret.secret as Record<string, unknown>;
  return {
    email: (data.email as string) || "",
    apiToken: (data.apiToken as string) || "",
  };
}
