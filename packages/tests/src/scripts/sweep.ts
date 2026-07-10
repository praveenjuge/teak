import {
  cleanupE2EAccounts,
  isConfiguredE2EEmail,
  summarizeE2ECleanup,
} from "../helpers/e2e-cleanup";
import {
  deleteMailpitMessages,
  listMailpitMessages,
  messageIdsForRecipients,
} from "../helpers/mailpit";

const cleanup = await cleanupE2EAccounts();
const messages = await listMailpitMessages();
const recipients = [
  ...new Set(
    messages
      .flatMap((message) => message.To ?? [])
      .map((recipient) => recipient.Address.toLowerCase())
      .filter((email) => isConfiguredE2EEmail(email))
  ),
];
const deletedMessages = await deleteMailpitMessages(
  messageIdsForRecipients(messages, recipients)
);

console.log(
  `Production E2E sweep complete: ${summarizeE2ECleanup(cleanup)} mailpitDeleted=${deletedMessages}`
);
