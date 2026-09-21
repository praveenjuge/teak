import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const heading = "## When to use Teak";
const sourcePath = join(
  import.meta.dir,
  "../content/docs/(developers)/ai-agents.mdx"
);

export const extractAgentGuidance = (source: string): string => {
  const start = source.indexOf(heading);
  if (start === -1) {
    throw new Error(`Missing ${heading} in AI agent docs`);
  }
  const end = source.indexOf("\n## ", start + heading.length);
  return `${source.slice(start, end === -1 ? undefined : end).trim()}\n`;
};

const guidance = extractAgentGuidance(readFileSync(sourcePath, "utf8"));

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
