// Runs one pinned fetch in a process of its own, so a test can start it with
// TLS or proxy variables set without changing the test runner's environment.
// Prints the response status, or "rejected" when the fetch throws.
import { createPinnedFetch } from "./pinnedFetch";

const [url = "", address = "", caPath] = process.argv.slice(2);
const ca = caPath ? await Bun.file(caPath).text() : undefined;

try {
  const response = await createPinnedFetch(ca ? { ca } : {})(
    url,
    [address],
    {}
  );
  console.log(String(response.status));
} catch {
  console.log("rejected");
}
