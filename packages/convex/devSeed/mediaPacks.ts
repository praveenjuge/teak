import type { DevScenarioCardDef } from "../card/defaultCards";
import { planEmailCards } from "../inbound/emailContent";
import type { RemoteDetails } from "../workflows/steps/categorization/remote/index";
import {
  classifyLinkCategory,
  enrichLinkCategory,
} from "../workflows/steps/categorization/rules";
import {
  type FolderScenario,
  type FolderScenarioCard,
  type FolderScenarioPack,
  folderScenarioCard,
} from "./folderPacks";
import { SCENARIO_MARKER } from "./helpers";

const enrichedLinkCard = (
  scenario: FolderScenario,
  index: number,
  url: string,
  preview: { description?: string; siteName: string; title: string },
  {
    extra = {},
    raw = [],
    remote,
  }: {
    extra?: Partial<DevScenarioCardDef>;
    raw?: { attribute?: string; selector: string; value: string }[];
    remote?: RemoteDetails;
  } = {}
): FolderScenarioCard => {
  const marked = `${url}#${SCENARIO_MARKER}-${scenario}-${index}`;
  const linkPreview = {
    status: "success" as const,
    url: marked,
    ...preview,
    ...(raw.length
      ? {
          raw: raw.map(({ attribute = "content", selector, value }) => ({
            selector,
            results: [{ attributes: [{ name: attribute, value }] }],
          })),
        }
      : {}),
  };
  const card = {
    _id: `${scenario}-${index}`,
    type: "link",
    url: marked,
    metadata: { linkPreview },
  };
  const classification = classifyLinkCategory(card);
  return {
    ...folderScenarioCard(scenario, index, "", [], extra),
    type: "link" as const,
    content: marked,
    url: marked,
    metadataTitle: preview.title,
    metadata: {
      linkPreview,
      ...(classification
        ? {
            linkCategory: enrichLinkCategory(card, classification, {
              remote,
            }),
          }
        : {}),
    },
  };
};

const longTranscript = (marker: string) =>
  `${Array.from(
    { length: 1500 },
    (_, i) =>
      `At minute ${Math.floor(i / 12)} the speaker goes over point ${i}.`
  ).join(" ")} ${marker}`;

const youtubeWatchTags = (channel: string, duration?: string) => [
  { selector: "link[itemprop='name']", value: channel },
  ...(duration
    ? [{ selector: "meta[itemprop='duration']", value: duration }]
    : []),
  {
    selector: "meta[itemprop='uploadDate']",
    value: "2026-09-14T08:00:00-07:00",
  },
];

export const videoCaptionsPack = (): FolderScenarioPack => {
  const scenario = "video-captions" as const;
  const youtube = { siteName: "YouTube" };
  const vimeo = { siteName: "Vimeo" };
  let index = 1;
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Video captions pack", []),
      enrichedLinkCard(
        scenario,
        index++,
        "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        { ...youtube, title: "A YouTube talk with channel, length and date" },
        { raw: youtubeWatchTags("Example Channel", "PT1H2M3S") }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://www.youtube.com/shorts/1a2b3c4d5e6",
        { ...youtube, title: "A YouTube Short" },
        { raw: youtubeWatchTags("Example Shorts", "PT45S") }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://www.youtube.com/live/7f8e9d0c1b2",
        { ...youtube, title: "A YouTube live stream with no length" },
        { raw: youtubeWatchTags("Example Live") }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://vimeo.com/76979871",
        { ...vimeo, title: "A Vimeo talk with English captions" },
        {
          extra: {
            aiSummary: "A talk about how leaves turn light into sugar.",
            aiTranscript:
              "Hello and welcome. Today we talk about how chlorophyll catches the morning light and how leaves turn it into sugar.",
          },
        }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://vimeo.com/76979872/1a2b3c4d5e",
        { ...vimeo, title: "An unlisted Vimeo video" },
        {
          extra: {
            aiTranscript:
              "This unlisted walkthrough shows the lighthouse keeper winding the clockwork lamp.",
          },
        }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://vimeo.com/76979873",
        { ...vimeo, title: "A Vimeo video with Japanese captions" },
        {
          extra: {
            aiTranscript: "こんにちは。今日は富士山の朝焼けについて話します。",
          },
        }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://vimeo.com/76979874",
        { ...vimeo, title: "A two-hour Vimeo lecture" },
        {
          extra: {
            aiTranscript: longTranscript(
              "At minute 90 the speaker names the velvet harbor theorem."
            ),
          },
        }
      ),
      enrichedLinkCard(scenario, index++, "https://vimeo.com/76979875", {
        ...vimeo,
        title: "A private Vimeo video with no captions",
      }),
      {
        ...folderScenarioCard(
          scenario,
          index++,
          "A Vimeo link saved as a note: https://vimeo.com/76979871",
          []
        ),
      },
    ],
  };
};

const emailCard = (
  scenario: FolderScenario,
  index: number,
  email: { html?: string; text?: string; title: string }
): FolderScenarioCard => {
  const plan = planEmailCards({
    html: email.html ?? null,
    subject: email.title,
    text: email.text ?? null,
  });
  const base = folderScenarioCard(scenario, index, "", [], {
    metadata: { source: "email" },
  });
  const tags = [...(base.tags ?? []), "email"];
  if (plan.kind === "link") {
    return {
      ...base,
      content: plan.url,
      tags,
      type: "link",
      url: plan.url,
      ...(plan.notes ? { notes: plan.notes } : {}),
    };
  }
  return {
    ...base,
    content: plan.kind === "text" ? plan.markdown : email.title,
    tags,
    type: "text",
  };
};

const NEWSLETTER_HTML = `<html><head><style>p{color:#333}</style></head><body>
<div style="display:none">Preview text nobody should see</div>
<h1>The Weekly Leaf</h1>
<p>This week: why <b>maple leaves</b> turn red, and a field guide to the forest floor.</p>
${Array.from({ length: 40 }, (_, i) => `<img src="https://track.example.com/open/${i}.gif" width="1" height="1">`).join("")}
<p><a href="https://example.us1.list-manage.com/track/click?u=abc&url=https%3A%2F%2Fexample.com%2Fmaples%3Futm_source%3Dnewsletter">Read: Why maples blush</a></p>
<p><a href="https://www.google.com/url?q=https://example.org/forest-floor&sa=D">A field guide to the forest floor</a></p>
<p><a href="https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.net%2Fmoss&data=x">Moss, up close</a></p>
<ul><li>Leaf of the week: ginkgo</li><li>Reader photo: a frosted oak</li></ul>
</body></html>`;

export const emailInPack = (): FolderScenarioPack => {
  const scenario = "email-in" as const;
  let index = 1;
  const forwardChain = Array.from(
    { length: 5 },
    (_, level) =>
      `---------- Forwarded message ---------\nFrom: Friend ${level} <friend${level}@example.com>\nDate: Mon, 13 Oct 2026 at 09:0${level}\nSubject: Fwd: Hike on Saturday\nTo: <someone@example.com>\n`
  ).join("\n");
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Email in pack", []),
      emailCard(scenario, index++, {
        html: NEWSLETTER_HTML,
        title: "Fwd: The Weekly Leaf — issue 12",
      }),
      emailCard(scenario, index++, {
        title: "Fwd: worth a read",
        text: "Worth a read: https://example.com/essays/slow-reading?utm_source=mail&utm_medium=email",
      }),
      emailCard(scenario, index++, {
        title: "Re: Fwd: Call the plumber about the kitchen sink",
      }),
      emailCard(scenario, index++, {
        title: "Fwd: Fwd: Fwd: Fwd: Fwd: Hike on Saturday",
        text: `${forwardChain}\nMeet at the trailhead at 8. Bring water and a jacket; it gets cold at the top.`,
      }),
      emailCard(scenario, index++, {
        title: "مرحبا بالعالم",
        text: "ملاحظة قصيرة عن الاجتماع القادم.",
      }),
      emailCard(scenario, index++, {
        title: "転送: 会議のメモ",
        text: "来週の会議の議題:\n1. 予算\n2. 日程",
      }),
      emailCard(scenario, index++, {
        title: "🎉 Party plans",
        text: "Cake at 7, games at 8. Two links: https://example.com/cake and https://example.com/games",
      }),
    ],
  };
};

export const emailAttachmentsPack = (): FolderScenarioPack => {
  const scenario = "email-attachments" as const;
  const file = (
    index: number,
    fileName: string,
    mimeType: string,
    fileSize: number
  ): FolderScenarioCard => ({
    ...folderScenarioCard(scenario, index, "", [], {
      metadata: { source: "email" },
    }),
    content: "",
    fileMetadata: { fileName, fileSize, mimeType },
    metadataTitle: fileName,
    tags: [`scenario-${scenario}`, "email"],
    type: "document",
  });
  let index = 1;
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Email attachments pack", []),
      emailCard(scenario, index++, {
        title: "Trip photos and the itinerary",
        text: "Here you go — the itinerary and the receipts are attached.",
      }),
      file(index++, "Itinerary.pdf", "application/pdf", 240_000),
      file(index++, "Receipt.pdf", "application/pdf", 88_000),
      file(index++, "Scan.pdf", "application/pdf", 1_200_000),
      file(index++, "Scan.pdf", "application/pdf", 1_300_000),
      file(index++, "請求書.pdf", "application/pdf", 64_000),
      file(
        index++,
        "Notes from the workshop.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        32_000
      ),
      file(
        index++,
        "A 24 MB annual report.pdf",
        "application/pdf",
        24 * 1024 * 1024
      ),
    ],
  };
};

export const podcastTranscriptsPack = (): FolderScenarioPack => {
  const scenario = "podcast-transcripts" as const;
  const show = { siteName: "Example Podcast" };
  const audio = (url: string) => [
    { selector: "meta[property='og:audio']", value: url },
    { selector: "meta[property='og:audio:type']", value: "audio/mpeg" },
  ];
  let index = 1;
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Podcast transcripts pack", []),
      enrichedLinkCard(
        scenario,
        index++,
        "https://podcast.example.com/podcast/42-tide-pools",
        { ...show, title: "Episode 42: Tide pools" },
        {
          extra: {
            aiSummary: "An episode about the creatures living in tide pools.",
            aiTranscript:
              "Welcome back to the show. This week we wade into tide pools where the hermit crab trades shells at low tide.",
          },
          raw: audio("https://audio.example.com/episodes/42.mp3"),
        }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://podcasts.apple.com/us/podcast/example-show/id1200000000?i=1000700000001",
        { siteName: "Apple Podcasts", title: "An Apple Podcasts episode" },
        {
          extra: {
            aiTranscript:
              "On today's episode the baker explains why sourdough starter needs a warm kitchen.",
          },
        }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://shows.example.com/field-notes/episode/7",
        { ...show, title: "An episode found through its show's RSS feed" },
        {
          extra: {
            aiTranscript:
              "Field notes episode seven: the night the owls returned to the old barn.",
          },
          raw: [
            {
              attribute: "href",
              selector: "link[rel='alternate'][type='application/rss+xml']",
              value: "https://shows.example.com/field-notes/feed.xml",
            },
          ],
        }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ",
        { siteName: "Spotify", title: "A Spotify episode (no public audio)" }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://podcast.example.com/podcast/43-marathon",
        { ...show, title: "A 2 GB episode (too large to transcribe)" },
        { raw: audio("https://audio.example.com/episodes/43-2gb.mp3") }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://podcast.example.com/podcast/44-japanese",
        { ...show, title: "A Japanese episode" },
        {
          extra: {
            aiTranscript: "今週は京都の古い茶室と抹茶の作法について話します。",
          },
          raw: audio("https://audio.example.com/episodes/44.mp3"),
        }
      ),
      enrichedLinkCard(
        scenario,
        index++,
        "https://podcast.example.com/podcast/45-in-trash",
        { ...show, title: "A transcribed episode in Trash" },
        {
          extra: {
            aiTranscript:
              "This deleted episode talks about the copper kettle festival.",
            isDeleted: true,
          },
          raw: audio("https://audio.example.com/episodes/45.mp3"),
        }
      ),
    ],
  };
};

export const richSitesPack = (): FolderScenarioPack => {
  const scenario = "rich-sites" as const;
  const updated = "Oct 15, 2026";
  const link = (
    index: number,
    url: string,
    preview: { description?: string; siteName: string; title: string },
    remote?: RemoteDetails,
    raw: { selector: string; value: string }[] = []
  ) => enrichedLinkCard(scenario, index, url, preview, { raw, remote });
  const wikipedia = { siteName: "Wikipedia" };
  const arxiv = { siteName: "arXiv.org" };
  const isbnTag = (value: string) => [
    { selector: "meta[property='books:isbn']", value },
  ];
  const openLibrary = (isbn: string, pages: string): RemoteDetails => ({
    source: "open_library",
    facts: [
      { label: "Authors", value: "Example Author" },
      { label: "Pages", value: pages },
      { label: "Publisher", value: "Example Press" },
      { label: "Published", value: "October 1, 1988" },
      { label: "ISBN", value: isbn },
    ],
  });
  const paper = (
    authors: string,
    published: string,
    subject: string,
    extra: Partial<RemoteDetails> = {}
  ): RemoteDetails => ({
    source: "arxiv",
    facts: [
      { label: "Authors", value: authors },
      { label: "Published", value: published },
      { label: "Subject", value: subject },
      ...(extra.facts ?? []),
    ],
    summary: "An abstract the AI summary reads.",
    ...(extra.pdfUrl ? { pdfUrl: extra.pdfUrl } : {}),
  });
  let index = 1;
  return {
    folders: [],
    cards: [
      folderScenarioCard(scenario, 0, "Rich sites pack", []),
      link(
        index++,
        "https://en.wikipedia.org/wiki/Photosynthesis",
        { ...wikipedia, title: "Photosynthesis" },
        {
          source: "wikipedia",
          facts: [
            {
              label: "About",
              value: "Biological process to convert light into chemical energy",
            },
            { label: "Updated", value: updated },
          ],
          summary: "Photosynthesis turns light into chemical energy.",
        }
      ),
      link(
        index++,
        "https://en.wikipedia.org/wiki/Mercury",
        { ...wikipedia, title: "Mercury" },
        {
          source: "wikipedia",
          facts: [
            { label: "Page", value: "Disambiguation" },
            { label: "Updated", value: "Oct 13, 2026" },
          ],
        }
      ),
      link(
        index++,
        "https://ja.wikipedia.org/wiki/%E5%AF%8C%E5%A3%AB%E5%B1%B1",
        { ...wikipedia, title: "富士山" },
        {
          source: "wikipedia",
          facts: [
            {
              label: "About",
              value:
                "静岡県と山梨県にまたがる活火山で、日本の最高峰。古くから信仰と芸術の対象として親しまれてきた山",
            },
            { label: "Updated", value: updated },
          ],
        }
      ),
      link(index++, "https://en.wikipedia.org/wiki/Zzzz_no_such_page", {
        ...wikipedia,
        title: "Wikipedia has no page with this name",
      }),
      link(
        index++,
        "https://arxiv.org/abs/1706.03762",
        { ...arxiv, title: "A paper with a PDF to save" },
        paper(
          "Author One, Author Two, Author Three et al.",
          "Jun 12, 2017",
          "cs.CL",
          {
            pdfUrl: "https://arxiv.org/pdf/1706.03762",
          }
        )
      ),
      link(
        index++,
        "https://arxiv.org/abs/hep-th/9901001",
        { ...arxiv, title: "A paper with an old-style id" },
        paper("Author One", "Jan 1, 1999", "hep-th", {
          facts: [{ label: "DOI", value: "10.1143/PTP.101.1155" }],
          pdfUrl: "https://arxiv.org/pdf/hep-th/9901001",
        })
      ),
      link(
        index++,
        "https://arxiv.org/abs/0910.4008",
        { ...arxiv, title: "A withdrawn paper" },
        paper("Author One", "Oct 21, 2009", "math.FA")
      ),
      link(
        index++,
        "https://arxiv.org/abs/2101.00001",
        { ...arxiv, title: "A paper with 300 authors" },
        paper("Author 1, Author 2, Author 3 et al.", "Jan 1, 2021", "hep-ex", {
          pdfUrl: "https://arxiv.org/pdf/2101.00001",
        })
      ),
      ...(
        [
          [
            "track/4uLU6hMCjMI75M1A2tKUQC",
            "A track",
            "Track",
            "Example Artist",
          ],
          ["album/1DFixLWuPkv3KT3TnV35m3", "An album", "Album", "Example Band"],
          ["playlist/37i9dQZF1DXcBWIGoYBM5M", "A playlist", "Playlist", ""],
          [
            "track/0000000000000000000000",
            "A region-locked track",
            "Track",
            "Example Artist",
          ],
        ] as const
      ).map(([path, title, type, artist]) =>
        link(
          index++,
          `https://open.spotify.com/${path}`,
          { siteName: "Spotify", title },
          {
            source: "spotify",
            facts: [
              ...(artist ? [{ label: "Artist", value: artist }] : []),
              { label: "Type", value: type },
            ],
          }
        )
      ),
      link(
        index++,
        "https://music.apple.com/us/album/example-album/1700000000",
        { siteName: "Apple Music", title: "An album on Apple Music" },
        {
          source: "apple_music",
          facts: [
            { label: "Artist", value: "Example Artist" },
            { label: "Type", value: "Album" },
            { label: "Released", value: "Oct 27, 2023" },
          ],
        }
      ),
      link(
        index++,
        "https://www.goodreads.com/book/show/6693",
        { siteName: "Goodreads", title: "A book with an ISBN-13" },
        openLibrary("9780140328721", "96"),
        isbnTag("9780140328721")
      ),
      link(
        index++,
        "https://www.goodreads.com/book/show/6694",
        { siteName: "Goodreads", title: "A book with only an ISBN-10" },
        openLibrary("9780140328721", "112"),
        isbnTag("0140328726")
      ),
      link(index++, "https://www.goodreads.com/book/show/6695", {
        siteName: "Goodreads",
        title: "A book with no ISBN",
      }),
      link(
        index++,
        "https://www.goodreads.com/book/show/6696",
        {
          siteName: "Goodreads",
          title: "A book whose ISBN check digit is wrong",
        },
        undefined,
        isbnTag("9780140328722")
      ),
      link(
        index++,
        "https://www.goodreads.com/book/show/6697",
        { siteName: "Goodreads", title: "A book Open Library doesn't know" },
        undefined,
        isbnTag("9781234567897")
      ),
    ],
  };
};
