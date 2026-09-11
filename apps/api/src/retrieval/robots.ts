import robotsParser, { type Robot } from "robots-parser";
import { USER_AGENT, fetchPage, type FetchOptions } from "./fetchPage.js";

/**
 * One robots.txt per origin, fetched once and cached for the life of the process.
 * A site that does not publish one, or whose robots.txt cannot be read, is
 * treated as allowing the crawl — that is what the standard says.
 */
export class RobotsCache {
  private readonly cache = new Map<string, Robot | null>();

  constructor(private readonly options: FetchOptions) {}

  private async load(origin: string): Promise<Robot | null> {
    const cached = this.cache.get(origin);
    if (cached !== undefined) return cached;

    const robotsUrl = `${origin}/robots.txt`;
    const result = await fetchPage(robotsUrl, this.options);
    const robot = result.ok ? robotsParser(robotsUrl, result.html) : null;
    this.cache.set(origin, robot);
    return robot;
  }

  async isAllowed(rawUrl: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    const robot = await this.load(url.origin);
    if (!robot) return true;
    return robot.isAllowed(rawUrl, USER_AGENT) !== false;
  }

  async crawlDelayMs(origin: string): Promise<number | null> {
    const robot = await this.load(origin);
    const delay = robot?.getCrawlDelay(USER_AGENT);
    return typeof delay === "number" ? delay * 1000 : null;
  }
}
