// シーズン別 Reddit アニメデータの集計・分析ロジック

/** シーズン一覧の1要素 */
export interface SeasonItem {
  key: string;
  year: number;
  season: string;
  label: string;
}

/** 生JSONの投稿レコード */
export interface RawPost {
  reddit_id?: string;
  reddit_title?: string;
  created_utc?: number | null;
  num_comments?: number | null;
  url?: string;
  archived_at?: string;
}

/** 生JSONの作品レコード */
export interface RawAnime {
  id: number;
  name_jp: string;
  seasonYear: number;
  season: string;
  episodes: Record<string, RawPost[]>;
  latest_episode?: number | null;
}

/** 生JSONのシーズンファイル全体 */
export interface RawSeasonData {
  metadata: {
    year: number;
    season: string;
  };
  anime: Record<string, RawAnime>;
}

/** 正規化されたエピソード指標 */
export interface EpisodeMetric {
  episode: number;
  comments: number;
  title: string;
  url: string;
  archivedAt: string;
  isRewatch: boolean;
  deltaFromPrev: number | null;
  deltaPct: number | null;
}

/** 作品ごとの分析済み指標 */
export interface AnimeAnalytics {
  id: number;
  nameJp: string;
  englishTitle: string;
  anilistUrl: string;
  episodes: EpisodeMetric[];
  episodeCount: number;
  latestEpisode: number;
  latestComments: number;
  latestUrl: string;
  prevEpisode: number | null;
  prevComments: number | null;
  prevUrl: string;
  deltaComments: number | null;
  deltaPct: number | null;
  totalComments: number;
  avgComments: number;
  medianComments: number;
  maxComments: number;
  maxEpisode: number;
  minComments: number;
  firstComments: number;
  retentionRate: number | null;
  latestVsAvgPct: number;
  latestRank: number;
  prevRank: number | null;
  rankChange: number | null;
  sharePct: number;
}

/** 分布バケット */
export interface DistributionBucket {
  label: string;
  count: number;
  pct: number;
}

/** シーズンサマリー */
export interface SeasonSummary {
  totalComments: number;
  totalEpisodes: number;
  animeCount: number;
  overallAvgPerEpisode: number;
  medianAnimeAvg: number;
  latestUpdatedAt: string;
  topLatest: AnimeAnalytics | null;
  topTotal: AnimeAnalytics | null;
  topSurge: AnimeAnalytics | null;
  top3SharePct: number;
  top10SharePct: number;
  distributionBuckets: DistributionBucket[];
  surgeList: AnimeAnalytics[];
  retentionList: AnimeAnalytics[];
}

/** シーズン分析結果全体 */
export interface SeasonAnalytics {
  year: number;
  season: string;
  animes: AnimeAnalytics[];
  byId: Map<number, AnimeAnalytics>;
  summary: SeasonSummary;
}

/** バンプチャート用の1作品系列 */
export interface BumpSeries {
  id: number;
  nameJp: string;
  ranks: (number | null)[];
  comments: (number | null)[];
  episodes: (number | null)[];
  latestRank: number;
}

/** バンプチャートデータ */
export interface BumpChartData {
  labels: string[];
  series: BumpSeries[];
}

/** 比較チャート用の系列データ */
export interface ComparisonSeriesItem {
  id: number;
  nameJp: string;
  data: (number | null)[];
}

/** 比較チャートデータ */
export interface ComparisonSeriesData {
  labels: string[];
  series: ComparisonSeriesItem[];
}

/** シーズン横断比較データ */
export interface CrossSeasonSummary {
  key: string;
  label: string;
  totalComments: number;
  totalEpisodes: number;
  animeCount: number;
  avgPerEpisode: number;
  topAnimeName: string;
  topAnimeTotal: number;
}

const SEASON_ORDER: Record<string, number> = {
  WINTER: 1,
  SPRING: 2,
  SUMMER: 3,
  FALL: 4,
};

/**
 * シーズン一覧を新しい順（年降順 → 秋>夏>春>冬）に並び替える
 */
export function sortSeasonsDesc(seasons: SeasonItem[]): SeasonItem[] {
  return [...seasons].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return (SEASON_ORDER[b.season.toUpperCase()] ?? 0) - (SEASON_ORDER[a.season.toUpperCase()] ?? 0);
  });
}

/**
 * Rewatch（再視聴）スレッドかどうかを判定する
 */
export function isRewatchTitle(title: string | undefined): boolean {
  return /\brewatch\b/i.test(title ?? "");
}

/**
 * Reddit スレッドタイトルから作品名部分（英語・ローマ字表記）を抽出する
 */
export function extractEnglishTitle(redditTitle: string): string {
  if (!redditTitle) return "";
  // "Title • AltTitle - Episode 1 discussion" や "Title Episode 1 Discussion" を整形
  let cleaned = redditTitle
    .replace(/\s*[-–—]\s*Episode\s+\d+.*$/i, "")
    .replace(/\s+Episode\s+\d+.*$/i, "")
    .trim();
  if (cleaned.includes("•")) {
    cleaned = cleaned.split("•")[0].trim();
  }
  return cleaned;
}

/**
 * 中央値を計算する
 */
function calcMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return Math.round(sorted[mid]);
}

/**
 * 同率を考慮した標準競技順位（1, 2, 2, 4...）を割り当てる
 */
function assignRanks<T>(items: T[], getScore: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => getScore(b) - getScore(a));
  const rankMap = new Map<T, number>();
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && getScore(sorted[i]) < getScore(sorted[i - 1])) {
      currentRank = i + 1;
    }
    rankMap.set(sorted[i], currentRank);
  }
  return rankMap;
}

/**
 * 1シーズン分の生データを集計・分析する
 */
export function analyzeSeason(
  raw: RawSeasonData,
  options: { excludeRewatch: boolean }
): SeasonAnalytics {
  const rawAnimes = Object.values(raw.anime ?? {});
  const draftAnimes: Omit<AnimeAnalytics, "latestRank" | "prevRank" | "rankChange" | "sharePct">[] = [];
  let latestUpdatedAt = "";

  for (const anime of rawAnimes) {
    const epEntries: { epNum: number; post: RawPost }[] = [];

    for (const [epKey, posts] of Object.entries(anime.episodes ?? {})) {
      const epNum = Number(epKey);
      if (!Number.isFinite(epNum) || epNum <= 0 || !Array.isArray(posts) || posts.length === 0) {
        continue;
      }

      // 複数投稿がある場合は条件に合うものを優先し、コメント数最大の投稿を採用
      const filtered = options.excludeRewatch
        ? posts.filter((p) => !isRewatchTitle(p.reddit_title))
        : posts;
      if (filtered.length === 0) continue;

      const bestPost = [...filtered].sort(
        (a, b) => (Number(b.num_comments ?? 0)) - (Number(a.num_comments ?? 0))
      )[0];

      if (bestPost.archived_at && bestPost.archived_at > latestUpdatedAt) {
        latestUpdatedAt = bestPost.archived_at;
      }

      epEntries.push({ epNum, post: bestPost });
    }

    if (epEntries.length === 0) continue;

    // 話数昇順に並び替え
    epEntries.sort((a, b) => a.epNum - b.epNum);

    const episodes: EpisodeMetric[] = epEntries.map((item, idx) => {
      const comments = Math.max(0, Number(item.post.num_comments ?? 0));
      const prevComments = idx > 0 ? Math.max(0, Number(epEntries[idx - 1].post.num_comments ?? 0)) : null;
      const deltaFromPrev = prevComments !== null ? comments - prevComments : null;
      const deltaPct =
        prevComments !== null && prevComments > 0 && deltaFromPrev !== null
          ? (deltaFromPrev / prevComments) * 100
          : null;

      return {
        episode: item.epNum,
        comments,
        title: item.post.reddit_title ?? "",
        url: item.post.url ?? "",
        archivedAt: item.post.archived_at ?? "",
        isRewatch: isRewatchTitle(item.post.reddit_title),
        deltaFromPrev,
        deltaPct,
      };
    });

    const latestEp = episodes[episodes.length - 1];
    const prevEp = episodes.length >= 2 ? episodes[episodes.length - 2] : null;
    const firstEp = episodes[0];

    const commentValues = episodes.map((e) => e.comments);
    const totalComments = commentValues.reduce((sum, c) => sum + c, 0);
    const avgComments = Math.round(totalComments / episodes.length);
    const medianComments = calcMedian(commentValues);

    let maxEp = episodes[0];
    let minComments = episodes[0].comments;
    for (const ep of episodes) {
      if (ep.comments > maxEp.comments) maxEp = ep;
      if (ep.comments < minComments) minComments = ep.comments;
    }

    const deltaComments = prevEp ? latestEp.comments - prevEp.comments : null;
    const deltaPct =
      prevEp && prevEp.comments > 0 && deltaComments !== null
        ? (deltaComments / prevEp.comments) * 100
        : null;

    const retentionRate =
      episodes.length >= 3 && firstEp.comments > 0
        ? (latestEp.comments / firstEp.comments) * 100
        : null;

    const latestVsAvgPct =
      avgComments > 0 ? ((latestEp.comments - avgComments) / avgComments) * 100 : 0;

    const englishTitle = extractEnglishTitle(latestEp.title || firstEp.title);

    draftAnimes.push({
      id: Number(anime.id),
      nameJp: anime.name_jp || englishTitle || `Anime #${anime.id}`,
      englishTitle,
      anilistUrl: `https://anilist.co/anime/${anime.id}`,
      episodes,
      episodeCount: episodes.length,
      latestEpisode: latestEp.episode,
      latestComments: latestEp.comments,
      latestUrl: latestEp.url,
      prevEpisode: prevEp ? prevEp.episode : null,
      prevComments: prevEp ? prevEp.comments : null,
      prevUrl: prevEp ? prevEp.url : "",
      deltaComments,
      deltaPct,
      totalComments,
      avgComments,
      medianComments,
      maxComments: maxEp.comments,
      maxEpisode: maxEp.episode,
      minComments,
      firstComments: firstEp.comments,
      retentionRate,
      latestVsAvgPct,
    });
  }

  // 最新話順位・前話順位を算出
  const latestRankMap = assignRanks(draftAnimes, (a) => a.latestComments);
  const withPrev = draftAnimes.filter((a) => a.prevComments !== null);
  const prevRankMap = assignRanks(withPrev, (a) => a.prevComments ?? 0);

  const seasonTotalComments = draftAnimes.reduce((s, a) => s + a.totalComments, 0);
  const seasonTotalEpisodes = draftAnimes.reduce((s, a) => s + a.episodeCount, 0);

  const animes: AnimeAnalytics[] = draftAnimes.map((a) => {
    const latestRank = latestRankMap.get(a) ?? 0;
    const prevRank = prevRankMap.get(a) ?? null;
    const rankChange = prevRank !== null ? prevRank - latestRank : null;
    const sharePct = seasonTotalComments > 0 ? (a.totalComments / seasonTotalComments) * 100 : 0;

    return {
      ...a,
      latestRank,
      prevRank,
      rankChange,
      sharePct,
    };
  });

  // 基本は最新話コメント数降順で整列
  animes.sort((a, b) => b.latestComments - a.latestComments);

  const byId = new Map<number, AnimeAnalytics>();
  for (const a of animes) {
    byId.set(a.id, a);
  }

  // サマリー指標の算出
  const sortedByTotal = [...animes].sort((a, b) => b.totalComments - a.totalComments);
  const top3Comments = sortedByTotal.slice(0, 3).reduce((s, a) => s + a.totalComments, 0);
  const top10Comments = sortedByTotal.slice(0, 10).reduce((s, a) => s + a.totalComments, 0);

  const surgeList = animes
    .filter((a) => a.deltaComments !== null && a.deltaComments > 0)
    .sort((a, b) => (b.deltaComments ?? 0) - (a.deltaComments ?? 0))
    .slice(0, 5);

  const retentionList = animes
    .filter((a) => a.retentionRate !== null && a.episodeCount >= 3 && a.firstComments >= 30)
    .sort((a, b) => (b.retentionRate ?? 0) - (a.retentionRate ?? 0))
    .slice(0, 5);

  const bucketDefs = [
    { label: "500件以上", min: 500, max: Infinity },
    { label: "200–499件", min: 200, max: 499 },
    { label: "100–199件", min: 100, max: 199 },
    { label: "50–99件", min: 50, max: 99 },
    { label: "0–49件", min: 0, max: 49 },
  ];

  const distributionBuckets: DistributionBucket[] = bucketDefs.map((b) => {
    const count = animes.filter((a) => a.avgComments >= b.min && a.avgComments <= b.max).length;
    return {
      label: b.label,
      count,
      pct: animes.length > 0 ? (count / animes.length) * 100 : 0,
    };
  });

  const summary: SeasonSummary = {
    totalComments: seasonTotalComments,
    totalEpisodes: seasonTotalEpisodes,
    animeCount: animes.length,
    overallAvgPerEpisode:
      seasonTotalEpisodes > 0 ? Math.round(seasonTotalComments / seasonTotalEpisodes) : 0,
    medianAnimeAvg: calcMedian(animes.map((a) => a.avgComments)),
    latestUpdatedAt,
    topLatest: animes[0] ?? null,
    topTotal: sortedByTotal[0] ?? null,
    topSurge: surgeList[0] ?? null,
    top3SharePct: seasonTotalComments > 0 ? (top3Comments / seasonTotalComments) * 100 : 0,
    top10SharePct: seasonTotalComments > 0 ? (top10Comments / seasonTotalComments) * 100 : 0,
    distributionBuckets,
    surgeList,
    retentionList,
  };

  return {
    year: raw.metadata?.year ?? 0,
    season: raw.metadata?.season ?? "",
    animes,
    byId,
    summary,
  };
}

/**
 * バンプチャート（順位推移）用のデータを生成する
 * 各作品の最新話から順に遡った放送回基準で全作品順位を算出し、対象作品のみ抽出する
 */
export function buildBumpChartData(
  allAnimes: AnimeAnalytics[],
  targetIds: number[]
): BumpChartData {
  if (allAnimes.length === 0 || targetIds.length === 0) {
    return { labels: [], series: [] };
  }

  // 全作品の過半数がデータを持つ最大遡及数を求める（視認性のため最大12点＝offset 11まで）
  let maxOffset = 0;
  while (maxOffset < 11) {
    const nextOffset = maxOffset + 1;
    const validCount = allAnimes.filter((a) => a.episodes.length > nextOffset).length;
    if (validCount <= Math.floor(allAnimes.length / 2)) {
      break;
    }
    maxOffset = nextOffset;
  }

  const labels: string[] = [];
  const targetSet = new Set(targetIds);
  const seriesMap = new Map<number, BumpSeries>();

  for (const anime of allAnimes) {
    if (targetSet.has(anime.id)) {
      seriesMap.set(anime.id, {
        id: anime.id,
        nameJp: anime.nameJp,
        ranks: [],
        comments: [],
        episodes: [],
        latestRank: anime.latestRank,
      });
    }
  }

  for (let offset = maxOffset; offset >= 0; offset--) {
    labels.push(offset === 0 ? "最新話" : `${offset}話前`);

    // 該当オフセットにエピソードが存在する全作品で順位を計算
    const snapshot: { id: number; comments: number; epNum: number }[] = [];
    for (const anime of allAnimes) {
      const idx = anime.episodes.length - 1 - offset;
      if (idx >= 0) {
        const ep = anime.episodes[idx];
        snapshot.push({
          id: anime.id,
          comments: ep.comments,
          epNum: ep.episode,
        });
      }
    }

    const rankMap = assignRanks(snapshot, (item) => item.comments);
    const snapshotById = new Map(snapshot.map((s) => [s.id, { item: s, rank: rankMap.get(s) ?? null }]));

    for (const [id, series] of seriesMap.entries()) {
      const found = snapshotById.get(id);
      if (found && found.rank !== null) {
        series.ranks.push(found.rank);
        series.comments.push(found.item.comments);
        series.episodes.push(found.item.epNum);
      } else {
        series.ranks.push(null);
        series.comments.push(null);
        series.episodes.push(null);
      }
    }
  }

  const series = Array.from(seriesMap.values()).sort((a, b) => a.latestRank - b.latestRank);
  return { labels, series };
}

/**
 * 複数作品比較チャート用の系列データを生成する
 */
export function buildComparisonSeries(
  animes: AnimeAnalytics[],
  xMode: "episode" | "sequence" | "relative",
  cumulative: boolean
): ComparisonSeriesData {
  if (animes.length === 0) {
    return { labels: [], series: [] };
  }

  let labels: string[] = [];
  let rawSeries: ComparisonSeriesItem[] = [];

  if (xMode === "episode") {
    // 話数番号の和集合
    const epSet = new Set<number>();
    for (const a of animes) {
      for (const ep of a.episodes) {
        epSet.add(ep.episode);
      }
    }
    const sortedEps = Array.from(epSet).sort((a, b) => a - b);
    labels = sortedEps.map((ep) => `第${ep}話`);

    rawSeries = animes.map((a) => {
      const epMap = new Map(a.episodes.map((e) => [e.episode, e.comments]));
      return {
        id: a.id,
        nameJp: a.nameJp,
        data: sortedEps.map((ep) => epMap.get(ep) ?? null),
      };
    });
  } else if (xMode === "sequence") {
    // 各作品の収録順（1回目, 2回目...）
    const maxLen = Math.max(...animes.map((a) => a.episodes.length));
    labels = Array.from({ length: maxLen }, (_, i) => `${i + 1}話目`);

    rawSeries = animes.map((a) => ({
      id: a.id,
      nameJp: a.nameJp,
      data: Array.from({ length: maxLen }, (_, i) => a.episodes[i]?.comments ?? null),
    }));
  } else {
    // 最新話基準（末尾揃え）
    const maxLen = Math.max(...animes.map((a) => a.episodes.length));
    labels = Array.from({ length: maxLen }, (_, i) => {
      const offset = maxLen - 1 - i;
      return offset === 0 ? "最新話" : `${offset}話前`;
    });

    rawSeries = animes.map((a) => ({
      id: a.id,
      nameJp: a.nameJp,
      data: Array.from({ length: maxLen }, (_, i) => {
        const offset = maxLen - 1 - i;
        const idx = a.episodes.length - 1 - offset;
        return idx >= 0 ? a.episodes[idx].comments : null;
      }),
    }));
  }

  if (!cumulative) {
    return { labels, series: rawSeries };
  }

  // 累積値へ変換
  const cumulativeSeries = rawSeries.map((s) => {
    let running = 0;
    let started = false;
    const data = s.data.map((val) => {
      if (val === null) {
        return started ? running : null;
      }
      started = true;
      running += val;
      return running;
    });
    return { ...s, data };
  });

  return { labels, series: cumulativeSeries };
}

/**
 * 全シーズン横断比較サマリーを時系列順（古い→新しい）で生成する
 */
export function summarizeCrossSeasons(
  entries: Array<{ season: SeasonItem; data: RawSeasonData }>,
  excludeRewatch: boolean
): CrossSeasonSummary[] {
  // 古いシーズンから新しいシーズンへ並び替え
  const sorted = [...entries].sort((a, b) => {
    if (a.season.year !== b.season.year) return a.season.year - b.season.year;
    return (
      (SEASON_ORDER[a.season.season.toUpperCase()] ?? 0) -
      (SEASON_ORDER[b.season.season.toUpperCase()] ?? 0)
    );
  });

  return sorted.map(({ season, data }) => {
    const analyzed = analyzeSeason(data, { excludeRewatch });
    return {
      key: season.key,
      label: season.label,
      totalComments: analyzed.summary.totalComments,
      totalEpisodes: analyzed.summary.totalEpisodes,
      animeCount: analyzed.summary.animeCount,
      avgPerEpisode: analyzed.summary.overallAvgPerEpisode,
      topAnimeName: analyzed.summary.topTotal?.nameJp ?? "—",
      topAnimeTotal: analyzed.summary.topTotal?.totalComments ?? 0,
    };
  });
}
