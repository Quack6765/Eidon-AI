export type IntegrationScope = "global" | "user";

export type CredentialAction = "preserve" | "replace" | "clear";

export type IntegrationSelection<ProviderId extends string, Configuration> = {
  providerId: ProviderId;
  configuration: Configuration;
  configured: boolean;
  credentialStored: boolean;
  scope: IntegrationScope;
};

export type RuntimeIntegrationSelection<ProviderId extends string, Configuration> =
  IntegrationSelection<ProviderId, Configuration> & {
    credentials: { apiKey?: string };
  };

export type IntegrationProviderDescriptor<Configuration> = {
  label: string;
  requiresCredential: boolean;
  getReadinessError(input: {
    configuration: Configuration;
    credentials: { apiKey?: string };
  }): string | null;
};
