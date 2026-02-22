/**
 * @typedef {import('./').TorrentSource} TorrentSource
 */

/**
 * @implements {TorrentSource}
 */
class AbstractSource {
  single(options) { throw new Error("Source doesn't implement single"); }
  batch(options) { throw new Error("Source doesn't implement batch"); }
  movie(options) { throw new Error("Source doesn't implement movie"); }
  test() { throw new Error("Source doesn't implement test"); }
}

/** @type {import('./index.d.ts').TorrentSource} */
export default new class NyaaSource extends AbstractSource {

  BASE_URL = 'https://nyaa.si/?page=rss';

  /** @type {import('./index.d.ts').SearchFunction} */
  async single(query, options) {
    try {
      let results = []
      console.log(query)
      for (let i = 0; i < Math.min(query.titles.length, options.searchDepth || 2); i++) {
        const titles = this.getQueriesPerTitle(query, query.titles[i])
        console.log(titles)
        for (let j = 0; j < Math.min(titles.length, options.parsedTitles || 2); j++) {
          const srch = titles[j];
          console.log(srch)
          results = results.concat(await this.searchRSS(srch, query, options));
        }
      }
      results = this.removeDuplicates(results)
      results = this.sortResultsByGroup(results)
      console.log(results)
      return results;
    } catch (e) {
      console.log(e)
      throw new Error(`Nyaa single search failed: ${e.message}`);
    }
  }

  /** @type {import('./index.d.ts').SearchFunction} */
  async batch(query, options) {
    try {
      return await this.searchRSS(query.titles[0] + " batch", query, options);
    } catch (e) {
      throw new Error(`Nyaa batch search failed: ${e.message}`);
    }
  }

  /** @type {import('./index.d.ts').SearchFunction} */
  async movie(query, options) {
    try {
      var results = await this.searchRSS(query.titles[0], query, options);
      return this.sortResultsByGroup(results)
    } catch (e) {
      throw new Error(`Nyaa movie search failed: ${e.message}`);
    }
  }

  async test() {
    try {

      const dummyQuery = { fetch: globalThis.fetch, exclusions: [] };
      const results = await this.searchRSS("Frieren 01", dummyQuery);
      return true;
    } catch (e) {
      throw new Error(`Nyaa extension test failed: Ensure Nyaa.si is accessible and not blocked by your ISP. (${e.message})`);
    }
  }

  /**
   * Helper to fetch and parse RSS
   */
  async searchRSS(queryStr, queryObj, options) {
    const encodedQuery = encodeURIComponent(queryStr);
    const targetUrl = `${this.BASE_URL}&q=${encodedQuery}&c=1_2&f=0`;

    const fetcher = queryObj.fetch || globalThis.fetch;

    const response = await fetcher(targetUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/xml'
      }
    });

    if (!response.ok) {
      throw new Error(`Network error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const results = this.parseXml(text, queryObj.exclusions || []);
    return results;
  }

  parseXml(text, exclusions) {
    const results = [];
    const lowerExclusions = exclusions.map(ex => ex.toLowerCase());

    const getTag = (xmlString, tagName) => {
      const regex = new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
      const match = xmlString.match(regex);
      if (!match) return '';

      let content = match[1].trim();
      if (content.startsWith('<![CDATA[') && content.endsWith(']]>')) {
        content = content.substring(9, content.length - 3).trim();
      }

      return content
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    };

    const items = text.match(/<item[\s\S]*?>([\s\S]*?)<\/item>/gi) || [];

    items.forEach(itemXml => {
      const title = getTag(itemXml, 'title');

      //Filter out user exclusions (e.g., "x265", "dub")
      const lowerTitle = title.toLowerCase();
      const hasExclusion = lowerExclusions.some(ex => lowerTitle.includes(ex));
      if (hasExclusion) return;

      const link = getTag(itemXml, 'link');
      const seeders = parseInt(getTag(itemXml, 'nyaa:seeders'), 10) || 0;
      const leechers = parseInt(getTag(itemXml, 'nyaa:leechers'), 10) || 0;
      const downloads = parseInt(getTag(itemXml, 'nyaa:downloads'), 10) || 0;
      const sizeTag = getTag(itemXml, 'nyaa:size');
      const dateStr = getTag(itemXml, 'pubDate');
      const infoHash = getTag(itemXml, 'nyaa:infoHash');

      let size = 0;
      if (sizeTag.includes('GiB')) size = parseFloat(sizeTag) * 1024 * 1024 * 1024;
      else if (sizeTag.includes('MiB')) size = parseFloat(sizeTag) * 1024 * 1024;
      else if (sizeTag.includes('KiB')) size = parseFloat(sizeTag) * 1024;

      results.push({
        title: title,
        link: link,
        seeders: seeders,
        leechers: leechers,
        downloads: downloads,
        accuracy: 'medium',
        hash: infoHash,
        size: Math.floor(size),
        date: new Date(dateStr)
      });
    });
    console.log(results)
    return results;
  }

  sortResultsByGroup(results) {
    const getRank = (title) => {
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes('[judas]')) return 1;
      if (lowerTitle.includes('[raze]')) return 2;
      if (lowerTitle.includes('[dkb]')) return 3;
      return 4;
    };

    return results.sort((a, b) => {
      const rankA = getRank(a.title);
      const rankB = getRank(b.title);
      if (rankA !== rankB) return rankA - rankB;
      return b.seeders - a.seeders;
    });
  }

  removeDuplicates(results) {
    var out = []
    results.forEach(r => {
      if (out.some(o => o.hash === r.hash))
        return;
      out.push(r)
    })
    return out;
  }
  getSeasonFormatedEp(series, ep) {
    let season = 1;
    const words = series.trim().split(/\s+/);

    if (words.length > 0) {
      const lastWord = words.pop();
      // Regex to match "2", "02", "S2", "s02", etc.
      const match = lastWord.match(/^s?(\d+)$/i);
      if (match) {
        season = parseInt(match[1], 10);
      }
    }
    const formattedSeason = String(season).padStart(2, '0');
    const formattedEp = String(ep).padStart(2, '0');
    if (season > 1) {
      if (words[words.length - 1].toLowerCase().includes("season")) {
        words.pop()
        if (words[words.length - 1].toLowerCase().includes("final"))
          words.pop()
      }
      series = words.slice(0, words.length).join(" ")
    }
    return `${series} S${formattedSeason}E${formattedEp}`;
  }
  getQueriesPerTitle(query, title) {
    if (!query.episode)
      return title
    let queries = []
    let aux = title
    const ep = query.episode.toString().padStart(2, '0');
    aux += ` ${ep}`;
    let res = ""
    if (query.resolution) {
      res = ` ${query.resolution}p`;
      aux += res
    }
    queries.push(aux)
    queries.push(this.getSeasonFormatedEp(title, query.episode) + res)
    if (query.absoluteEpisodeNumber && query.absoluteEpisodeNumber > query.episode)
      queries.push(title + ` ${query.absoluteEpisodeNumber.toString().padStart(2, '0')}` + res)
    console.log(queries)
    return queries;
  }
}();