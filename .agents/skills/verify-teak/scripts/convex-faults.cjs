"use strict";
// Makes chosen Convex queries, mutations or actions fail in one Playwright
// page, by function name, through the page's sync socket:
//
//   const { injectFaults } = require("./convex-faults.cjs");
//   await injectFaults(page, {
//     failQuery: (name) => name === "listTagSummary",      // query throws
//     rewriteQuery: (name) => (name === "x" ? null : undefined), // new value
//     failRequest: (name, message) => name === "permanentDeleteCard",
//     observe: (name, value) => {},                         // read results
//   });
//
// A failed mutation or action never reaches the server. Call it before the
// page's first navigation.
const fname = (udfPath) =>
  String(udfPath || "")
    .split(":")
    .pop();
async function injectFaults(page, rules) {
  const log = [];
  await page.routeWebSocket(/convex\.cloud\/api\/.*sync/, (ws) => {
    const server = ws.connectToServer();
    const queries = new Map();
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "ModifyQuerySet") {
        for (const mod of m.modifications) {
          if (mod.type === "Add") {
            queries.set(mod.queryId, mod.udfPath);
          }
        }
      }
      if (
        (m.type === "Mutation" || m.type === "Action") &&
        rules.failRequest?.(fname(m.udfPath), m)
      ) {
        log.push(`failed ${m.type} ${m.udfPath}`);
        ws.send(
          JSON.stringify({
            type: m.type === "Mutation" ? "MutationResponse" : "ActionResponse",
            requestId: m.requestId,
            success: false,
            result: "Server Error",
            logLines: [],
          })
        );
        return;
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "Transition") {
        let changed = false;
        m.modifications = m.modifications.map((mod) => {
          if (mod.type !== "QueryUpdated") {
            return mod;
          }
          const name = fname(queries.get(mod.queryId));
          rules.observe?.(name, mod.value);
          if (rules.failQuery?.(name)) {
            changed = true;
            log.push(`failed query ${name}`);
            return {
              type: "QueryFailed",
              queryId: mod.queryId,
              errorMessage: `[CONVEX Q(${queries.get(mod.queryId)})] Server Error`,
              logLines: [],
              journal: mod.journal,
            };
          }
          const replacement = rules.rewriteQuery?.(name);
          if (replacement !== undefined) {
            changed = true;
            return { ...mod, value: replacement };
          }
          return mod;
        });
        if (changed) {
          ws.send(JSON.stringify(m));
          return;
        }
      }
      ws.send(raw);
    });
  });
  return log;
}
module.exports = { injectFaults };
