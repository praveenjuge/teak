import {
  cleanupE2EAccounts,
  summarizeE2ECleanup,
} from "../helpers/e2e-cleanup";
import {
  deleteMailpitMessages,
  listMailpitMessages,
  messageIdsForRecipients,
} from "../helpers/mailpit";
import { readState, updateState } from "../helpers/run-state";

const accounts = readState().accounts;
const pendingEmails = accounts
  .filter((account) => !account.deleted)
  .map((account) => account.email);
const cleanup = pendingEmails.length
  ? await cleanupE2EAccounts(pendingEmails)
  : {
      alreadyDeleted: [],
      deleted: [],
      failures: [],
      ignoredOutOfRange: [],
      remainingEligible: false,
    };

const removedAccounts = new Set([
  ...cleanup.deleted,
  ...cleanup.alreadyDeleted,
]);
updateState((state) => {
  for (const account of state.accounts) {
    if (removedAccounts.has(account.email)) {
      account.deleted = true;
    }
  }
  if (state.primary && removedAccounts.has(state.primary.email)) {
    state.primary.deleted = true;
  }
});

const messages = await listMailpitMessages();
const deletedMessages = await deleteMailpitMessages(
  messageIdsForRecipients(
    messages,
    accounts.map((account) => account.email)
  )
);
console.log(
  `Production E2E teardown complete: ${summarizeE2ECleanup(cleanup)} mailpitDeleted=${deletedMessages}`
);
