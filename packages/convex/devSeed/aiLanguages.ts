import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { DevScenarioCardDef } from "../card/defaultCards";
import { normalizeCardSearchTag } from "../card/searchSync";
import { readIsDevDeployment } from "../env";
import { isWorkosProductionApi, workosApiBase } from "../shared/workosApi";
import { link, SCENARIO_MARKER } from "./helpers";

export const AI_LANGUAGES_SCENARIO = "ai-languages";
export const AI_LANGUAGES_TAG = `scenario-${AI_LANGUAGES_SCENARIO}`;

/** One seeded card and the language its AI tags and summary should be in. */
export interface AiLanguageCase {
  card: DevScenarioCardDef;
  /** The BCP 47 primary tag processing should store as `aiLanguage`. */
  expected: string;
  /** A short name for the live check's table. */
  label: string;
}

const note = (
  label: string,
  expected: string,
  content: string
): AiLanguageCase => ({
  card: {
    type: "text",
    content,
    tags: [AI_LANGUAGES_TAG],
    runProcessing: true,
  },
  expected,
  label,
});

// The live check fetches these pages: their titles, descriptions and
// Wikipedia summaries are in the page's language.
const page = (label: string, expected: string, url: string): AiLanguageCase => {
  const marked = `${url}#${SCENARIO_MARKER}-${AI_LANGUAGES_SCENARIO}-${label}`;
  return {
    card: link(marked, { tags: [AI_LANGUAGES_TAG] }),
    expected,
    label,
  };
};

/**
 * The `ai-languages` pack: notes and links whose AI tags and summary have a
 * known language once processing runs. Images, PDFs and audio need stored
 * files, which a seed mutation can't upload, so they are left to the live
 * check's manual steps.
 */
export const AI_LANGUAGE_CASES: readonly AiLanguageCase[] = [
  // The first link is the pack's marker: seeding again adds nothing.
  page("fr-eiffel", "fr", "https://fr.wikipedia.org/wiki/Tour_Eiffel"),
  page(
    "fr-camembert",
    "fr",
    "https://fr.wikipedia.org/wiki/Camembert_de_Normandie"
  ),
  page("pt-saudade", "pt", "https://pt.wikipedia.org/wiki/Saudade"),
  page("pt-bossa-nova", "pt", "https://pt.wikipedia.org/wiki/Bossa_nova"),
  note(
    "ja-kyoto",
    "ja",
    "来週の土曜日に京都の古い町並みを歩く予定。朝早く清水寺に行って、混む前に写真を撮りたい。昼は錦市場で湯葉と漬物を食べて、午後は小さな喫茶店で本を読む。"
  ),
  note(
    "ja-figma",
    "ja",
    "Figmaで新しいデザインシステムを作り始めた。色とタイポグラフィのルールを先に決めて、ボタンやフォームの部品はその後にまとめる。チーム全員が同じ部品を使えるようにしたい。"
  ),
  note(
    "es-receta",
    "es",
    "Receta de la abuela: sofreír cebolla y ajo en aceite de oliva, añadir tomate rallado y pimentón, y dejar que se haga a fuego lento durante media hora antes de echar el arroz."
  ),
  note(
    "es-viaje",
    "es",
    "Ideas para el viaje de primavera: caminar por el casco antiguo al atardecer, subir temprano al mirador para evitar las colas y probar los churros con chocolate en la plaza mayor."
  ),
  note(
    "de-meeting",
    "de",
    "Notizen aus dem Meeting: Wir verschieben den Start der neuen App auf Ende März, weil die Tests auf älteren Telefonen noch zu viele Fehler zeigen. Bis Freitag schreibt jeder seine offenen Punkte in die Liste."
  ),
  note(
    "de-wanderung",
    "de",
    "Wanderung am Wochenende: vom Bahnhof über die Klamm bis zur Hütte, etwa sechs Stunden. Warme Jacke, Stirnlampe und genug Wasser einpacken, und vorher den Wetterbericht für die Berge lesen."
  ),
  note(
    "ko-weekend",
    "ko",
    "이번 주말에는 한강 공원에서 자전거를 타고, 저녁에는 친구들과 함께 삼겹살을 먹기로 했다. 비가 오면 대신 미술관에 가서 새로운 전시를 볼 생각이다."
  ),
  note(
    "ko-habits",
    "ko",
    "좋은 습관을 만드는 방법: 아주 작은 목표부터 시작하고, 매일 같은 시간에 하고, 기록을 남긴다. 한 달 동안 매일 아침 십 분씩 책을 읽어 보자."
  ),
  note(
    "zh-weekend",
    "zh",
    "周末计划：早上去公园跑步，中午在家做一锅番茄牛腩，下午整理书架，把读过的书捐给社区图书馆。晚上和家人一起看一部老电影。"
  ),
  note(
    "zh-design",
    "zh",
    "学习笔记：好的产品设计从理解用户的问题开始，而不是从功能清单开始。先观察人们现在怎么解决这个问题，再决定要做什么。"
  ),
  note(
    "hi-jaipur",
    "hi",
    "अगले महीने जयपुर की यात्रा के लिए सूची: आमेर किला सुबह जल्दी देखना, हवा महल के पास की दुकानों से हस्तशिल्प खरीदना, और शाम को दाल बाटी चूरमा जरूर खाना।"
  ),
  note(
    "ar-launch",
    "ar",
    "ملاحظات من الاجتماع: سنبدأ تجربة التطبيق الجديد مع مجموعة صغيرة من المستخدمين الأسبوع القادم، ونجمع آراءهم قبل الإطلاق الكامل في نهاية الشهر."
  ),
  // Mixed: English with one Spanish line, so English is the main language.
  note(
    "en-spanish-quote",
    "en",
    "Notes from the talk on writing: the speaker opened with a line from a Spanish poet, “Caminante, no hay camino, se hace camino al andar,” and argued that a style is found by writing every day rather than by planning it. Next: try a 20-minute writing habit for two weeks."
  ),
  // No language at all: English, as today.
  note(
    "en-no-language",
    "en",
    "2026-11-03 09:30 → 14:45 | 42 × 17 = 714 | #A0C4FF #FFC6FF #CAFFBF"
  ),
];

export const aiLanguagesScenarioCards = (): DevScenarioCardDef[] =>
  AI_LANGUAGE_CASES.map((entry) => entry.card);

/** The case a seeded card came from, matched by its link or its note. */
export const aiLanguageCaseFor = (card: {
  content?: string;
  url?: string;
}): AiLanguageCase | undefined =>
  AI_LANGUAGE_CASES.find((entry) =>
    entry.card.url
      ? entry.card.url === card.url
      : entry.card.content === card.content
  );

const MAX_REPORT_CARDS = 100;

/**
 * The `ai-languages` pack's cards after processing, for
 * `scripts/ai-language-check.ts`. Dev deployments only, like the seed.
 */
export const report = internalQuery({
  args: { workosUserId: v.string() },
  returns: v.array(
    v.object({
      aiLanguage: v.union(v.string(), v.null()),
      aiSummary: v.union(v.string(), v.null()),
      aiTags: v.array(v.string()),
      cardId: v.id("cards"),
      expected: v.union(v.string(), v.null()),
      label: v.string(),
      metadataStatus: v.union(v.string(), v.null()),
      type: v.string(),
    })
  ),
  handler: async (ctx, { workosUserId }) => {
    if (!readIsDevDeployment() && isWorkosProductionApi(workosApiBase())) {
      throw new Error(
        "The AI language report runs only on the dev deployment (TEAK_DEV_DEPLOYMENT=true) or a local backend wired to the WorkOS emulator."
      );
    }
    const owner = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .unique();
    if (!owner) {
      throw new Error("No Teak owner is linked to that WorkOS user.");
    }
    const rows = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_user_tag_deleted_created", (q) =>
        q
          .eq("userId", owner.teakUserId)
          .eq("tag", normalizeCardSearchTag(AI_LANGUAGES_TAG))
          .eq("isDeleted", undefined)
      )
      .take(MAX_REPORT_CARDS);
    const cards = await Promise.all(
      rows.map((row) => ctx.db.get("cards", row.cardId))
    );
    return cards.flatMap((card) => {
      if (!card || card.isDeleted) {
        return [];
      }
      const entry = aiLanguageCaseFor(card);
      return [
        {
          aiLanguage: card.aiLanguage ?? null,
          aiSummary: card.aiSummary ?? null,
          aiTags: card.aiTags ?? [],
          cardId: card._id,
          expected: entry?.expected ?? null,
          label: entry?.label ?? card._id,
          metadataStatus: card.processingStatus?.metadata?.status ?? null,
          type: card.type,
        },
      ];
    });
  },
});
