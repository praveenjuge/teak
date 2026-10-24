import { describe, expect, test } from "bun:test";
import {
  expectedScript,
  formatReport,
  gateFailures,
  type ReportRow,
  scoreRows,
  summaryScript,
} from "./ai-language-check";

const row = (fields: Partial<ReportRow>): ReportRow => ({
  aiLanguage: null,
  aiSummary: null,
  aiTags: [],
  cardId: "card",
  expected: null,
  label: "card",
  metadataStatus: "completed",
  type: "text",
  ...fields,
});

describe("the script a summary is written in", () => {
  test.each([
    ["京都の町歩きの予定。", "japanese"],
    ["东京设计展的笔记。", "han"],
    ["한강 공원에서 자전거를 탄다.", "hangul"],
    ["जयपुर की यात्रा की सूची।", "devanagari"],
    ["ملاحظات من الاجتماع.", "arabic"],
    ["Notizen aus dem Meeting über die App.", "latin"],
    ["Figmaで新しいデザインシステムを作る。", "japanese"],
    ["2026 → 42", "none"],
  ])("%s is %s", (text, expected) => {
    expect(summaryScript(text)).toBe(expected);
  });

  test("a summary in the wrong language doesn't match its card's script", () => {
    expect(summaryScript("A note about a trip to Kyoto.")).not.toBe(
      expectedScript("ja")
    );
  });
});

describe("scoring the pack", () => {
  const rows = [
    row({
      aiLanguage: "ja",
      aiSummary: "京都の町歩きの予定。",
      expected: "ja",
      label: "ja-1",
    }),
    row({
      aiLanguage: "en",
      aiSummary: "A plan to walk around Kyoto.",
      expected: "ja",
      label: "ja-2",
    }),
    row({ expected: "fr", label: "fr-1", metadataStatus: "pending" }),
  ];

  test("counts language and script matches per language, finished cards only", () => {
    expect(scoreRows(rows)).toEqual([
      { cards: 2, language: "ja", languageMatches: 1, scriptMatches: 1 },
    ]);
  });

  test("the gate fails a language under 90% and one with no finished cards", () => {
    const failures = gateFailures(scoreRows(rows));
    expect(failures).toContain("ja");
    expect(failures).toContain("fr");
  });

  test("the table marks the miss and the card still processing", () => {
    const report = formatReport(rows);
    expect(report).toMatch(/ja-2\s+text\s+ja\s+en\s+latin\s+NO/u);
    expect(report).toMatch(/fr-1\s+text\s+fr\s+-\s+-\s+-\s+pending/u);
    expect(report).toMatch(/ja\s+2\s+50%\s+50%\s+yes/u);
  });
});
