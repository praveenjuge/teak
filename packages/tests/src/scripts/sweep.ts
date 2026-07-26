import {
  cleanupE2EAccounts,
  isConfiguredE2EEmail,
  summarizeE2ECleanup,
} from "../helpers/e2e-cleanup";
import { env } from "../helpers/env";
import {
  deleteMailpitMessages,
  listMailpitMessages,
  messageIdsForRecipients,
} from "../helpers/mailpit";

const cleanup = await cleanupE2EAccounts();
const deletedMessages = env.emailDeliveryEnabled
  ? await listMailpitMessages().then((messages) => {
      const recipients = [
        ...new Set(
          messages
            .flatMap((message) => message.To ?? [])
            .map((recipient) => recipient.Address.toLowerCase())
            .filter((email) => isConfiguredE2EEmail(email))
        ),
      ];
      return deleteMailpitMessages(
        messageIdsForRecipients(messages, recipients)
      );
    })
  : 0;

console.log(
  `Production E2E sweep complete: ${summarizeE2ECleanup(cleanup)} mailpitDeleted=${deletedMessages}`
);
