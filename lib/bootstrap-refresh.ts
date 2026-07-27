export type BootstrapRefreshStatus = "SKIPPED" | "UPDATED" | "PARTIAL" | "FAILED";

export type BootstrapRefreshIntegrationResult = {
  status: BootstrapRefreshStatus;
  changed: boolean;
  message: string | null;
};

export type BootstrapRefreshResponse = {
  market: BootstrapRefreshIntegrationResult;
  pluggy: BootstrapRefreshIntegrationResult;
};
