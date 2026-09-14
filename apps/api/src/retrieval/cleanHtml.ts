import * as cheerio from "cheerio";

export type PageLink = { url: string; text: string };

export type ExtractedPage = {
  title: string;
  text: string;
  links: PageLink[];
};

const STRIP = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "template",
];

const BLOCK_ELEMENTS = [
  "p",
  "div",
  "section",
  "article",
  "main",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "tr",
  "table",
  "blockquote",
  "pre",
  "dl",
  "figure",
  "figcaption",
  "summary",
  "details",
];

/** Prefer the real content over the chrome that surrounds it. */
const MAIN_SELECTORS = ["main", "article", '[role="main"]', "#content", ".content"];

export function extractContent(html: string, baseUrl: string): ExtractedPage {
  const $ = cheerio.load(html);

  const title = ($("title").first().text() || $("h1").first().text() || "").trim();

  // Links are read before the chrome is stripped: navigation is exactly where
  // the careers and hiring links live.
  const links: PageLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_i, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const withoutHash = absolute.split("#")[0]!;
    if (seen.has(withoutHash)) return;
    seen.add(withoutHash);
    links.push({ url: withoutHash, text: $(element).text().trim().replace(/\s+/g, " ") });
  });

  $(STRIP.join(",")).remove();

  // Cheerio's text() joins adjacent elements with nothing in between, so
  // "<h2>About the role</h2><p>We are…" comes out as "About the roleWe are…".
  // Block boundaries become line breaks before the text is read.
  $("br").replaceWith("\n");
  $(BLOCK_ELEMENTS.join(",")).each((_i, element) => {
    $(element).prepend("\n").append("\n");
  });
  // Table cells and inline list-like chips still need at least a space.
  $("td, th, dt, dd").each((_i, element) => {
    $(element).append(" ");
  });

  let scope = $.root();
  for (const selector of MAIN_SELECTORS) {
    const candidate = $(selector).first();
    if (candidate.length > 0 && candidate.text().trim().length > 200) {
      scope = candidate as unknown as cheerio.Cheerio<never>;
      break;
    }
  }

  const text = scope
    .text()
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();

  return { title, text, links };
}
