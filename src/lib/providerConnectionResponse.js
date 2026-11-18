import { AI_PROVIDERS } from "@/shared/constants/providers";

export function usesAwsCredentialForm(provider) {
  return AI_PROVIDERS[provider]?.credentialForm === "aws";
}

// Secrets that live inside providerSpecificData. The connection response is
// what the dashboard reads, and the dashboard is reachable by anyone who
// knows the dashboard password — these must never travel with it.
const PROVIDER_SPECIFIC_SECRETS = [
  "copilotToken",
  "sessionToken",
  "accessToken",
  "refreshToken",
  "idToken",
  "apiKey",
  "passToken",
  "mimoPassToken",
];

export function toProviderConnectionResponse(connection) {
  const { apiKey, accessToken, refreshToken, idToken, ...safe } = connection;

  if (!connection.providerSpecificData) return safe;

  const providerSpecificData = { ...connection.providerSpecificData };
  for (const secret of PROVIDER_SPECIFIC_SECRETS) {
    delete providerSpecificData[secret];
  }

  return { ...safe, providerSpecificData };
}

/**
 * The connection as a TEAMMATE may see it.
 *
 * A member may see the provider and whether the connection is healthy, never
 * WHICH account it is: for OAuth providers the connection name IS the owner's
 * email, and the error text can carry it too. So the name becomes the
 * provider's display name and the error/state fields go away.
 *
 * The status stays: it is the provider's health, not an identity — without it
 * the shared setup would count as empty.
 *
 * The connection ID stays: the chat picker fetches that connection's live
 * model catalog with it — an opaque handle, not an account identity.
 */
export function toMemberConnectionResponse(connection, nameOverride) {
  // Strip the secrets FIRST: the raw row carries the apiKey.
  const safe = toProviderConnectionResponse(connection);
  const {
    email,
    displayName,
    name,
    lastError,
    lastErrorAt,
    errorCode,
    lastUsedAt,
    consecutiveUseCount,
    rateLimitedUntil,
    expiresAt,
    expiresIn,
    defaultModel,
    globalPriority,
    priority,
    projectId,
    providerSpecificData,
    ...rest
  } = safe;

  return {
    ...rest,
    provider: safe.provider,
    name: nameOverride ?? AI_PROVIDERS[safe.provider]?.name ?? safe.provider,
    authType: safe.authType,
    isActive: safe.isActive,
  };
}
