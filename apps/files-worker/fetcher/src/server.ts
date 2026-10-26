import { createFetcherHandler } from "./handler";
import { pinnedFetch, systemDnsResolver } from "./pinnedFetch";
import { FETCHER_PORT } from "./protocol";
import { serveFetcher } from "./serve";

const handle = createFetcherHandler({
  pinnedFetch,
  resolveDns: systemDnsResolver,
});

const server = serveFetcher(handle, Number(process.env.PORT) || FETCHER_PORT);

console.log(`fetcher listening on ${server.port}`);
