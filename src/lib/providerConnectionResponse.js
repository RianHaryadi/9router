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
