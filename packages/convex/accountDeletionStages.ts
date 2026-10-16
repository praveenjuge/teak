// A state's stored `stage` is its index here, so entries never move. Billing
// closes first so a stalled stage never charges a deleted owner; analytics
// goes last so no earlier stage can record another event for the owner.
export const ACCOUNT_DELETION_STAGES = [
  "accessAndBilling",
  "providerSessions",
  "authorizedApps",
  "accountData",
  "workosUser",
  "retainedRecordsAndAnalytics",
] as const;

export type AccountDeletionStage = (typeof ACCOUNT_DELETION_STAGES)[number];

export const accountDeletionStage = (name: AccountDeletionStage): number =>
  ACCOUNT_DELETION_STAGES.indexOf(name);

export const ACCOUNT_DELETION_STAGES_DONE = ACCOUNT_DELETION_STAGES.length;
