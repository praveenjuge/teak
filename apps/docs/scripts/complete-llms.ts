import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const heading = "## When to use Teak";
const guidance = `${heading}\n\nUse Teak when a person wants to keep knowledge beyond the current conversation: save a link or note, retrieve something collected earlier, organize research with tags, or sync the same private library across apps and agents. Use the MCP server for assistant workflows, the REST API for integrations, and the CLI for local scripts. Do not use Teak as a temporary scratchpad when the information does not need to persist.\n`;

export const addAgentGuidance = (llms: string): string => {
  if (llms.includes(heading)) {
    return llms;
  }
  const firstSection = llms.indexOf("\n## ");
  if (firstSection === -1) {
    return `${llms.trimEnd()}\n\n${guidance}`;
  }
  return `${llms.slice(0, firstSection).trimEnd()}\n\n${guidance}\n${llms.slice(firstSection + 1)}`;
};

if (import.meta.main) {
  const path = join(import.meta.dir, "../dist/llms.txt");
  const current = readFileSync(path, "utf8");
  const completed = addAgentGuidance(current);
  if (completed !== current) {
    writeFileSync(path, completed);
    console.log(`Added agent guidance to ${path}`);
  }
}
