import type { SelectorSource } from "./types";

export const TITLE_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:title']", attribute: "content" },
  { selector: "meta[name='og:title']", attribute: "content" },
  { selector: "meta[name='twitter:title']", attribute: "content" },
  { selector: "meta[property='twitter:title']", attribute: "content" },
  { selector: "meta[name='title']", attribute: "content" },
  { selector: "head > title", attribute: "text" },
];

export const DESCRIPTION_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:description']", attribute: "content" },
  { selector: "meta[name='og:description']", attribute: "content" },
  { selector: "meta[name='description']", attribute: "content" },
  { selector: "meta[property='description']", attribute: "content" },
  { selector: "meta[name='twitter:description']", attribute: "content" },
  { selector: "meta[property='twitter:description']", attribute: "content" },
];

export const IMAGE_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:image:secure_url']", attribute: "content" },
  { selector: "meta[property='og:image:url']", attribute: "content" },
  { selector: "meta[property='og:image']", attribute: "content" },
  { selector: "meta[name='og:image']", attribute: "content" },
  { selector: "meta[property='twitter:image']", attribute: "content" },
  { selector: "meta[name='twitter:image']", attribute: "content" },
  { selector: "meta[property='twitter:image:src']", attribute: "content" },
  { selector: "meta[name='twitter:image:src']", attribute: "content" },
  { selector: "link[rel='image_src']", attribute: "href" },
  { selector: "meta[name='msapplication-TileImage']", attribute: "content" },
];

export const FAVICON_SOURCES: SelectorSource[] = [
  { selector: "link[rel='icon']", attribute: "href" },
  { selector: "link[rel='shortcut icon']", attribute: "href" },
  { selector: "link[rel='apple-touch-icon']", attribute: "href" },
  { selector: "link[rel='apple-touch-icon-precomposed']", attribute: "href" },
  { selector: "link[rel='mask-icon']", attribute: "href" },
];

export const SITE_NAME_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:site_name']", attribute: "content" },
  { selector: "meta[name='og:site_name']", attribute: "content" },
  { selector: "meta[name='application-name']", attribute: "content" },
  { selector: "meta[name='publisher']", attribute: "content" },
];

export const AUTHOR_SOURCES: SelectorSource[] = [
  { selector: "meta[name='author']", attribute: "content" },
  { selector: "meta[property='article:author']", attribute: "content" },
  { selector: "meta[name='byl']", attribute: "content" },
  { selector: "meta[property='book:author']", attribute: "content" },
];

export const PUBLISHER_SOURCES: SelectorSource[] = [
  { selector: "meta[property='article:publisher']", attribute: "content" },
  { selector: "meta[name='publisher']", attribute: "content" },
  { selector: "meta[property='og:site_name']", attribute: "content" },
];

export const PUBLISHED_TIME_SOURCES: SelectorSource[] = [
  { selector: "meta[property='article:published_time']", attribute: "content" },
  { selector: "meta[name='article:published_time']", attribute: "content" },
  { selector: "meta[name='pubdate']", attribute: "content" },
  { selector: "meta[name='publication_date']", attribute: "content" },
  { selector: "meta[name='date']", attribute: "content" },
];

export const CANONICAL_SOURCES: SelectorSource[] = [
  { selector: "link[rel='canonical']", attribute: "href" },
  { selector: "meta[property='og:url']", attribute: "content" },
  { selector: "meta[name='og:url']", attribute: "content" },
];

export const FINAL_URL_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:url']", attribute: "content" },
  { selector: "meta[name='og:url']", attribute: "content" },
  { selector: "meta[property='al:web:url']", attribute: "content" },
  { selector: "meta[property='twitter:url']", attribute: "content" },
  { selector: "meta[name='twitter:url']", attribute: "content" },
];

export const GITHUB_SOURCES: SelectorSource[] = [
  { selector: "a[href$='/stargazers']", attribute: "text" },
  { selector: "a[href$='/network/members']", attribute: "text" },
  { selector: "a[href$='/watchers']", attribute: "text" },
  { selector: "span[itemprop='programmingLanguage']", attribute: "text" },
  { selector: "relative-time", attribute: "text" },
];

export const GOODREADS_SOURCES: SelectorSource[] = [
  { selector: "meta[property='books:rating:average']", attribute: "content" },
  { selector: "meta[property='books:rating:count']", attribute: "content" },
  { selector: "meta[property='books:isbn']", attribute: "content" },
];

export const AMAZON_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:price:amount']", attribute: "content" },
  { selector: "meta[property='og:price:currency']", attribute: "content" },
  { selector: "meta[name='price']", attribute: "content" },
  { selector: "#priceblock_ourprice", attribute: "text" },
  { selector: "#priceblock_dealprice", attribute: "text" },
  { selector: ".a-price .a-offscreen", attribute: "text" },
];

export const IMDB_SOURCES: SelectorSource[] = [
  { selector: "meta[name='imdb:rating']", attribute: "content" },
  { selector: "meta[name='imdb:votes']", attribute: "content" },
  { selector: "meta[property='video:release_date']", attribute: "content" },
  { selector: "span[data-testid='hero-rating-bar__aggregate-rating__score']", attribute: "text" },
  { selector: "span[data-testid='title-techspec_runtime'] span", attribute: "text" },
];

export const DRIBBBLE_SOURCES: SelectorSource[] = [
  { selector: "meta[name='twitter:creator']", attribute: "content" },
  { selector: "meta[name='twitter:label1']", attribute: "content" },
  { selector: "meta[name='twitter:label2']", attribute: "content" },
  { selector: "meta[name='twitter:label3']", attribute: "content" },
  { selector: "meta[name='twitter:label4']", attribute: "content" },
  { selector: "meta[name='twitter:data1']", attribute: "content" },
  { selector: "meta[name='twitter:data2']", attribute: "content" },
  { selector: "meta[name='twitter:data3']", attribute: "content" },
  { selector: "meta[name='twitter:data4']", attribute: "content" },
  { selector: "a[rel='author']", attribute: "text" },
  { selector: ".shot-byline a", attribute: "text" },
  { selector: "a[href$='/likes']", attribute: "text" },
  { selector: "[data-testid='shot-likes']", attribute: "text" },
  { selector: "[data-testid='shot-likes-count']", attribute: "text" },
  { selector: ".shot-stats [data-label='Likes']", attribute: "text" },
  { selector: "a[href$='/views']", attribute: "text" },
  { selector: "[data-testid='shot-views']", attribute: "text" },
  { selector: "[data-testid='shot-views-count']", attribute: "text" },
  { selector: ".shot-stats [data-label='Views']", attribute: "text" },
  { selector: "a[href$='/comments']", attribute: "text" },
  { selector: "[data-testid='shot-comments']", attribute: "text" },
  { selector: "[data-testid='shot-comments-count']", attribute: "text" },
  { selector: ".shot-stats [data-label='Comments']", attribute: "text" },
  { selector: "meta[name='keywords']", attribute: "content" },
  { selector: "meta[name='parsely-tags']", attribute: "content" },
  { selector: "meta[property='article:tag']", attribute: "content" },
  { selector: "a[rel='tag']", attribute: "text" },
];

export const SCRAPE_ELEMENTS = Array.from(
  new Map(
    [
      ...TITLE_SOURCES,
      ...DESCRIPTION_SOURCES,
      ...IMAGE_SOURCES,
      ...FAVICON_SOURCES,
      ...SITE_NAME_SOURCES,
      ...AUTHOR_SOURCES,
      ...PUBLISHER_SOURCES,
      ...PUBLISHED_TIME_SOURCES,
      ...CANONICAL_SOURCES,
      ...FINAL_URL_SOURCES,
      ...GITHUB_SOURCES,
      ...GOODREADS_SOURCES,
      ...AMAZON_SOURCES,
      ...IMDB_SOURCES,
      ...DRIBBBLE_SOURCES,
    ].map((source) => [source.selector, { selector: source.selector }])
  ).values()
);
