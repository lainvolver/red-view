// RedView ダッシュボード UI・状態管理コントローラ

import {
  analyzeSeason,
  buildBumpChartData,
  buildComparisonSeries,
  sortSeasonsDesc,
  summarizeCrossSeasons,
  type AnimeAnalytics,
  type RawSeasonData,
  type SeasonAnalytics,
  type SeasonItem,
} from "./analytics";
import {
  CHART_PALETTE,
  highlightBumpSeries,
  renderBumpChart,
  renderCompareChart,
  renderCrossSeasonChart,
  renderModalEpisodeChart,
  renderPositioningScatter,
  renderShareDoughnut,
  truncateLabel,
} from "./charts";

type ActiveTab = "ranking" | "compare" | "bump" | "insights";
type RankingMetric = "latest" | "previous" | "total" | "average" | "max" | "surge";
type SortKey = "rank" | "name" | "episodes" | "metric" | "delta" | "avg" | "total";

interface AppState {
  seasons: SeasonItem[];
  currentSeasonKey: string;
  seasonCache: Map<string, RawSeasonData>;
  analyzed: SeasonAnalytics | null;
  excludeRewatch: boolean;
  activeTab: ActiveTab;
  rankingMetric: RankingMetric;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  searchQuery: string;
  minEpisodes: number;
  compareIds: number[];
  compareChartType: "line" | "cumulative" | "bar";
  compareXMode: "episode" | "sequence" | "relative";
  compareScale: "linear" | "logarithmic";
  bumpPreset: "top10" | "top15" | "top20" | "selected";
  bumpPinnedId: number | null;
  crossLoaded: boolean;
  modalAnimeId: number | null;
}

const state: AppState = {
  seasons: [],
  currentSeasonKey: "",
  seasonCache: new Map(),
  analyzed: null,
  excludeRewatch: true,
  activeTab: "ranking",
  rankingMetric: "latest",
  sortKey: "metric",
  sortDir: "desc",
  searchQuery: "",
  minEpisodes: 0,
  compareIds: [],
  compareChartType: "line",
  compareXMode: "episode",
  compareScale: "linear",
  bumpPreset: "top10",
  bumpPinnedId: null,
  crossLoaded: false,
  modalAnimeId: null,
};

// HTML エスケープ用ヘルパー
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// http/https のみ許可する安全な URL チェック
function safeUrl(url: string | undefined): string {
  if (!url) return "#";
  return /^https?:\/\//i.test(url) ? url : "#";
}

// ベースパスを確実にスラッシュ終端にする
function resolveBasePath(): string {
  const appEl = document.getElementById("app");
  const rawBase = appEl?.dataset.base || "/";
  return rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
}

const BASE_PATH = resolveBasePath();

// DOM 要素の取得ヘルパー
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`必要な要素が見つかりません: #${id}`);
  }
  return node as T;
}

/**
 * インライン SVG スパークラインを生成する
 */
function renderSparklineSvg(values: number[]): string {
  if (values.length === 0) return "";
  const w = 92;
  const h = 28;
  const pad = 4;

  if (values.length === 1) {
    return `<svg class="sparkline-svg" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <circle cx="${w / 2}" cy="${h / 2}" r="3" fill="var(--info)" />
    </svg>`;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  });

  const first = values[0];
  const last = values[values.length - 1];
  const stroke =
    last > first * 1.1 ? "var(--up)" : last < first * 0.9 ? "var(--down)" : "var(--info)";

  const linePoints = coords.map((p) => `${p.x},${p.y}`).join(" ");
  const lastPt = coords[coords.length - 1];

  return `<svg class="sparkline-svg" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${linePoints}" />
    <circle cx="${lastPt.x}" cy="${lastPt.y}" r="2.6" fill="${stroke}" />
  </svg>`;
}

/**
 * ランキング種別に応じた作品スコアを返す
 */
function getMetricValue(anime: AnimeAnalytics, metric: RankingMetric): number | null {
  switch (metric) {
    case "latest":
      return anime.latestComments;
    case "previous":
      return anime.prevComments;
    case "total":
      return anime.totalComments;
    case "average":
      return anime.avgComments;
    case "max":
      return anime.maxComments;
    case "surge":
      return anime.deltaComments;
  }
}

/**
 * ランキング種別の見出しラベルを返す
 */
function getMetricLabel(metric: RankingMetric): string {
  switch (metric) {
    case "latest":
      return "最新話コメント";
    case "previous":
      return "前話コメント";
    case "total":
      return "累計コメント";
    case "average":
      return "平均コメント";
    case "max":
      return "最高話コメント";
    case "surge":
      return "前話比増加数";
  }
}

/**
 * 比較選択作品ごとの固定カラーマップを構築する
 */
function buildColorMap(ids: number[]): Map<number, string> {
  const map = new Map<number, string>();
  ids.forEach((id, idx) => {
    map.set(id, CHART_PALETTE[idx % CHART_PALETTE.length]);
  });
  return map;
}

/**
 * 比較選択件数バッジとフローティングトレイを更新する
 */
function updateCompareTray(): void {
  const badge = el<HTMLSpanElement>("compareTabBadge");
  const tray = el<HTMLDivElement>("compareTray");
  const trayText = el<HTMLSpanElement>("compareTrayText");

  badge.textContent = String(state.compareIds.length);

  if (state.compareIds.length > 0 && state.activeTab === "ranking") {
    tray.classList.remove("hidden");
    trayText.textContent = `${state.compareIds.length} 作品を比較リストに選択中`;
  } else {
    tray.classList.add("hidden");
  }
}

/**
 * 比較リストの追加/削除トグル（最大8作品）
 */
function toggleCompareId(animeId: number): void {
  const exists = state.compareIds.includes(animeId);
  if (exists) {
    state.compareIds = state.compareIds.filter((id) => id !== animeId);
  } else {
    if (state.compareIds.length >= 8) {
      // 上限に達したら最も古い選択を押し出す
      state.compareIds = [...state.compareIds.slice(1), animeId];
    } else {
      state.compareIds = [...state.compareIds, animeId];
    }
  }
  updateCompareTray();
  renderCurrentTab();
  if (state.modalAnimeId === animeId) {
    renderModalCompareButton(animeId);
  }
}

/**
 * 順位変動バッジの HTML を生成する
 */
function renderRankChangeBadge(anime: AnimeAnalytics): string {
  if (anime.prevRank === null || anime.rankChange === null) {
    return `<span class="delta-pill delta-new">NEW</span>`;
  }
  if (anime.rankChange > 0) {
    return `<span class="delta-pill delta-up">▲ ${anime.rankChange}</span>`;
  }
  if (anime.rankChange < 0) {
    return `<span class="delta-pill delta-down">▼ ${Math.abs(anime.rankChange)}</span>`;
  }
  return `<span class="delta-pill delta-flat">—</span>`;
}

/**
 * 前話比バッジの HTML を生成する
 */
function renderDeltaHtml(anime: AnimeAnalytics): string {
  if (anime.deltaComments === null) {
    return `<span class="delta-pill delta-flat">—</span>`;
  }
  const sign = anime.deltaComments > 0 ? "+" : "";
  const pct =
    anime.deltaPct !== null ? ` (${anime.deltaPct > 0 ? "+" : ""}${anime.deltaPct.toFixed(0)}%)` : "";
  const cls =
    anime.deltaComments > 0 ? "delta-up" : anime.deltaComments < 0 ? "delta-down" : "delta-flat";
  return `<span class="delta-pill ${cls}">${sign}${anime.deltaComments.toLocaleString()}${pct}</span>`;
}

/**
 * KPI サマリーカード群を描画する
 */
function renderKpiCards(analyzed: SeasonAnalytics): void {
  const { summary } = analyzed;
  const metaText = el<HTMLSpanElement>("seasonMetaText");
  metaText.textContent = `${summary.animeCount} 作品・全 ${summary.totalEpisodes.toLocaleString()} 話集計${
    summary.latestUpdatedAt ? `（最終更新: ${summary.latestUpdatedAt}）` : ""
  }`;

  el("kpiTotalComments").textContent = summary.totalComments.toLocaleString();
  el("kpiTotalSub").textContent = `${summary.animeCount}作品 / ${summary.totalEpisodes}話`;

  el("kpiAvgComments").textContent = summary.overallAvgPerEpisode.toLocaleString();
  el("kpiAvgSub").textContent = `作品平均の中央値: ${summary.medianAnimeAvg.toLocaleString()}件`;

  // トップ作品カード
  const topLatestCard = el("kpiTopLatestCard");
  if (summary.topLatest) {
    el("kpiTopLatestName").textContent = summary.topLatest.nameJp;
    el("kpiTopLatestSub").textContent = `第${summary.topLatest.latestEpisode}話 ・ ${summary.topLatest.latestComments.toLocaleString()}件`;
    topLatestCard.dataset.animeId = String(summary.topLatest.id);
    topLatestCard.classList.add("clickable");
  } else {
    el("kpiTopLatestName").textContent = "—";
    el("kpiTopLatestSub").textContent = "";
    delete topLatestCard.dataset.animeId;
  }

  const topTotalCard = el("kpiTopTotalCard");
  if (summary.topTotal) {
    el("kpiTopTotalName").textContent = summary.topTotal.nameJp;
    el("kpiTopTotalSub").textContent = `累計 ${summary.topTotal.totalComments.toLocaleString()}件 (${summary.topTotal.sharePct.toFixed(1)}%)`;
    topTotalCard.dataset.animeId = String(summary.topTotal.id);
    topTotalCard.classList.add("clickable");
  } else {
    el("kpiTopTotalName").textContent = "—";
    el("kpiTopTotalSub").textContent = "";
    delete topTotalCard.dataset.animeId;
  }

  const topSurgeCard = el("kpiTopSurgeCard");
  if (summary.topSurge && summary.topSurge.deltaComments !== null) {
    el("kpiTopSurgeName").textContent = summary.topSurge.nameJp;
    const pct =
      summary.topSurge.deltaPct !== null ? ` (+${summary.topSurge.deltaPct.toFixed(0)}%)` : "";
    el("kpiTopSurgeSub").textContent = `+${summary.topSurge.deltaComments.toLocaleString()}件${pct}`;
    topSurgeCard.dataset.animeId = String(summary.topSurge.id);
    topSurgeCard.classList.add("clickable");
  } else {
    el("kpiTopSurgeName").textContent = "該当なし";
    el("kpiTopSurgeSub").textContent = "前話比プラスの作品なし";
    delete topSurgeCard.dataset.animeId;
    topSurgeCard.classList.remove("clickable");
  }
}

/**
 * ランキングテーブルを描画する
 */
function renderRankingTab(analyzed: SeasonAnalytics): void {
  const tbody = el<HTMLTableSectionElement>("rankingBody");
  const metricHeader = el<HTMLSpanElement>("metricHeaderLabel");
  metricHeader.textContent = getMetricLabel(state.rankingMetric);

  // アクティブピル更新
  document.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.metric === state.rankingMetric);
  });

  // ソートボタン状態更新
  document.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((btn) => {
    const isActive = btn.dataset.sort === state.sortKey;
    btn.classList.toggle("active", isActive);
    const arrow = btn.querySelector(".sort-arrow");
    if (arrow) {
      arrow.textContent = isActive ? (state.sortDir === "desc" ? "↓" : "↑") : "";
    }
  });

  const q = state.searchQuery.trim().toLowerCase();
  const rows = analyzed.animes.filter((a) => {
    if (a.episodeCount < state.minEpisodes) return false;
    if (getMetricValue(a, state.rankingMetric) === null) return false;
    if (q) {
      const matchJp = a.nameJp.toLowerCase().includes(q);
      const matchEn = a.englishTitle.toLowerCase().includes(q);
      if (!matchJp && !matchEn) return false;
    }
    return true;
  });

  // 現在の指標での基準順位を算出（検索前・フィルタ後に関わらず現在の指標降順基準）
  const metricSorted = [...rows].sort(
    (a, b) => (getMetricValue(b, state.rankingMetric) ?? -Infinity) - (getMetricValue(a, state.rankingMetric) ?? -Infinity)
  );
  const metricRankMap = new Map<number, number>();
  metricSorted.forEach((a, i) => metricRankMap.set(a.id, i + 1));

  // 指定ソートキーで並べ替え
  rows.sort((a, b) => {
    let diff = 0;
    switch (state.sortKey) {
      case "rank":
        diff = (metricRankMap.get(a.id) ?? 999) - (metricRankMap.get(b.id) ?? 999);
        break;
      case "name":
        diff = a.nameJp.localeCompare(b.nameJp, "ja");
        break;
      case "episodes":
        diff = a.episodeCount - b.episodeCount;
        break;
      case "metric":
        diff =
          (getMetricValue(a, state.rankingMetric) ?? -Infinity) -
          (getMetricValue(b, state.rankingMetric) ?? -Infinity);
        break;
      case "delta":
        diff = (a.deltaComments ?? -Infinity) - (b.deltaComments ?? -Infinity);
        break;
      case "avg":
        diff = a.avgComments - b.avgComments;
        break;
      case "total":
        diff = a.totalComments - b.totalComments;
        break;
    }
    return state.sortDir === "asc" ? diff : -diff;
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">条件に一致する作品がありません。検索条件やフィルタを変更してください。</td></tr>`;
    return;
  }

  const maxMetric = Math.max(
    1,
    ...rows.map((r) => Math.max(0, getMetricValue(r, state.rankingMetric) ?? 0))
  );

  tbody.innerHTML = rows
    .map((a) => {
      const rank = metricRankMap.get(a.id) ?? 0;
      const rankCls = rank <= 3 ? `rank-${rank}` : "";
      const metricVal = getMetricValue(a, state.rankingMetric) ?? 0;
      const barPct = Math.max(0, Math.min(100, Math.round((Math.max(0, metricVal) / maxMetric) * 100)));
      const isSelected = state.compareIds.includes(a.id);

      let metricSub = `第${a.latestEpisode}話`;
      if (state.rankingMetric === "previous") metricSub = `第${a.prevEpisode}話`;
      else if (state.rankingMetric === "max") metricSub = `第${a.maxEpisode}話`;
      else if (state.rankingMetric === "total" || state.rankingMetric === "average") {
        metricSub = `全${a.episodeCount}話`;
      } else if (state.rankingMetric === "surge") {
        metricSub = `前話比 (${a.prevEpisode}→${a.latestEpisode}話)`;
      }

      const metricDisplay =
        state.rankingMetric === "surge" && metricVal > 0
          ? `+${metricVal.toLocaleString()}`
          : metricVal.toLocaleString();

      const threadUrl =
        state.rankingMetric === "previous" && a.prevUrl ? a.prevUrl : a.latestUrl;

      return `<tr class="${isSelected ? "selected-row" : ""}" data-row-id="${a.id}">
        <td class="center">
          <input type="checkbox" class="compare-check" data-compare-id="${a.id}" ${
        isSelected ? "checked" : ""
      } aria-label="${escapeHtml(a.nameJp)}を比較に追加" />
        </td>
        <td class="center"><span class="rank-badge ${rankCls}">${rank}</span></td>
        <td class="center">${renderRankChangeBadge(a)}</td>
        <td class="anime-cell">
          <button type="button" class="anime-link-btn" data-open-modal="${a.id}">
            <span class="anime-name-jp">${escapeHtml(a.nameJp)}</span>
            ${
              a.englishTitle
                ? `<span class="anime-name-en">${escapeHtml(a.englishTitle)}</span>`
                : ""
            }
          </button>
        </td>
        <td class="num">${a.episodeCount}話<div class="bar-sub">最新: ${a.latestEpisode}話</div></td>
        <td class="num bar-cell">
          <div class="bar-meter" style="--bar-pct: ${barPct}%">
            <span class="bar-fill"></span>
            <span class="bar-value">${metricDisplay}</span>
            <span class="bar-sub">${metricSub}</span>
          </div>
        </td>
        <td class="num">${renderDeltaHtml(a)}</td>
        <td class="num">${a.avgComments.toLocaleString()}</td>
        <td class="num">${a.totalComments.toLocaleString()}<div class="bar-sub">${a.sharePct.toFixed(1)}%</div></td>
        <td>
          <div class="row-actions">
            ${renderSparklineSvg(a.episodes.map((e) => e.comments))}
            <a class="mini-link" href="${safeUrl(threadUrl)}" target="_blank" rel="noopener noreferrer" title="Reddit スレッドを開く">Reddit</a>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

/**
 * 比較チャートタブを描画する
 */
function renderCompareTab(analyzed: SeasonAnalytics): void {
  const chipsContainer = el<HTMLDivElement>("selectedChips");
  const addSelect = el<HTMLSelectElement>("addCompareSelect");
  const canvas = el<HTMLCanvasElement>("compareCanvas");
  const scaleGroup = el<HTMLDivElement>("compareScaleGroup");
  const xModeGroup = el<HTMLDivElement>("compareXModeGroup");

  // ツールバーボタン状態更新
  document.querySelectorAll<HTMLButtonElement>("[data-compare-type]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.compareType === state.compareChartType);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-xmode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.xmode === state.compareXMode);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-scale]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.scale === state.compareScale);
  });

  // 棒グラフ時は X 軸モード切替を非活性視覚化
  xModeGroup.classList.toggle("hidden", state.compareChartType === "bar");
  scaleGroup.classList.remove("hidden");

  // 有効な選択作品を抽出
  const selectedAnimes = state.compareIds
    .map((id) => analyzed.byId.get(id))
    .filter((a): a is AnimeAnalytics => Boolean(a));

  const colorMap = buildColorMap(selectedAnimes.map((a) => a.id));

  // チップ表示
  if (selectedAnimes.length === 0) {
    chipsContainer.innerHTML = `<span class="panel-desc">右のセレクトボックスまたはランキング表から比較したい作品を選択してください（最大8作品）</span>`;
  } else {
    chipsContainer.innerHTML = selectedAnimes
      .map((a) => {
        const color = colorMap.get(a.id) ?? CHART_PALETTE[0];
        return `<span class="anime-chip">
          <span class="chip-dot" style="background:${color}"></span>
          <span class="chip-text" title="${escapeHtml(a.nameJp)}">${escapeHtml(truncateLabel(a.nameJp, 18))}</span>
          <button type="button" class="chip-remove" data-remove-compare="${a.id}" aria-label="削除">×</button>
        </span>`;
      })
      .join("");
  }

  // 追加用プルダウン更新（未選択作品を最新話順で並べる）
  const unselected = analyzed.animes.filter((a) => !state.compareIds.includes(a.id));
  addSelect.innerHTML = `<option value="">＋ 作品を追加 (${selectedAnimes.length}/8)</option>${unselected
    .map(
      (a) =>
        `<option value="${a.id}">${escapeHtml(truncateLabel(a.nameJp, 28))} (${a.latestComments.toLocaleString()}件)</option>`
    )
    .join("")}`;
  addSelect.disabled = selectedAnimes.length >= 8 || unselected.length === 0;

  if (selectedAnimes.length === 0) {
    return;
  }

  const seriesData = buildComparisonSeries(
    selectedAnimes,
    state.compareXMode,
    state.compareChartType === "cumulative"
  );

  renderCompareChart(canvas, {
    chartType: state.compareChartType,
    seriesData,
    selectedAnimes,
    scaleType: state.compareScale,
    colorMap,
  });
}

/**
 * バンプチャート（順位推移）タブを描画する
 */
function renderBumpTab(analyzed: SeasonAnalytics): void {
  const canvas = el<HTMLCanvasElement>("bumpCanvas");
  const legendBox = el<HTMLDivElement>("bumpLegendList");

  document.querySelectorAll<HTMLButtonElement>("[data-bump-preset]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bumpPreset === state.bumpPreset);
  });

  let targetAnimes: AnimeAnalytics[] = [];
  if (state.bumpPreset === "selected") {
    targetAnimes = state.compareIds
      .map((id) => analyzed.byId.get(id))
      .filter((a): a is AnimeAnalytics => Boolean(a));
    if (targetAnimes.length === 0) {
      targetAnimes = analyzed.animes.slice(0, 10);
    }
  } else {
    const limit = state.bumpPreset === "top20" ? 20 : state.bumpPreset === "top15" ? 15 : 10;
    targetAnimes = analyzed.animes.slice(0, limit);
  }

  const targetIds = targetAnimes.map((a) => a.id);
  const bumpData = buildBumpChartData(analyzed.animes, targetIds);
  const colorMap = buildColorMap(bumpData.series.map((s) => s.id));

  // ピン留め中の作品が範囲外になったら解除
  if (state.bumpPinnedId !== null && !targetIds.includes(state.bumpPinnedId)) {
    state.bumpPinnedId = null;
  }

  renderBumpChart(canvas, bumpData, colorMap, state.bumpPinnedId);

  // インタラクティブ凡例リスト描画
  legendBox.innerHTML = `<div class="bump-legend-header">ホバーで強調 / クリックでピン留め</div>${bumpData.series
    .map((s) => {
      const color = colorMap.get(s.id) ?? CHART_PALETTE[0];
      const isPinned = state.bumpPinnedId === s.id;
      return `<button type="button" class="bump-legend-item ${isPinned ? "pinned" : ""}" data-bump-id="${s.id}">
        <span class="bump-legend-rank">${s.latestRank}位</span>
        <span class="chip-dot" style="background:${color}"></span>
        <span class="bump-legend-name" title="${escapeHtml(s.nameJp)}">${escapeHtml(s.nameJp)}</span>
      </button>`;
    })
    .join("")}`;
}

/**
 * 傾向分析タブを描画する（全シーズン比較は初回表示時に遅延フェッチ）
 */
async function renderInsightsTab(analyzed: SeasonAnalytics): Promise<void> {
  const scatterCanvas = el<HTMLCanvasElement>("scatterCanvas");
  const shareCanvas = el<HTMLCanvasElement>("shareCanvas");

  renderPositioningScatter(
    scatterCanvas,
    analyzed.animes,
    analyzed.summary.medianAnimeAvg,
    (animeId) => openAnimeModal(animeId)
  );
  renderShareDoughnut(shareCanvas, analyzed.animes, analyzed.summary.totalComments);

  // 急上昇トップ5
  const surgeEl = el<HTMLDivElement>("insightSurgeList");
  if (analyzed.summary.surgeList.length === 0) {
    surgeEl.innerHTML = `<div class="empty-state">前話比プラスの作品がありません</div>`;
  } else {
    surgeEl.innerHTML = analyzed.summary.surgeList
      .map((a) => {
        const pct = a.deltaPct !== null ? ` (+${a.deltaPct.toFixed(0)}%)` : "";
        return `<div class="insight-row" data-open-modal="${a.id}">
          <span class="insight-row-name" title="${escapeHtml(a.nameJp)}">${escapeHtml(a.nameJp)}</span>
          <span class="delta-pill delta-up">+${(a.deltaComments ?? 0).toLocaleString()}${pct}</span>
        </div>`;
      })
      .join("");
  }

  // コメント維持率トップ5
  const retentionEl = el<HTMLDivElement>("insightRetentionList");
  if (analyzed.summary.retentionList.length === 0) {
    retentionEl.innerHTML = `<div class="empty-state">対象作品が不足しています（3話以上・初回30件以上）</div>`;
  } else {
    retentionEl.innerHTML = analyzed.summary.retentionList
      .map((a) => {
        const rate = a.retentionRate ?? 0;
        const cls = rate >= 100 ? "delta-up" : "delta-new";
        return `<div class="insight-row" data-open-modal="${a.id}">
          <span class="insight-row-name" title="${escapeHtml(a.nameJp)}">${escapeHtml(a.nameJp)}</span>
          <span class="delta-pill ${cls}">${rate.toFixed(0)}% <small>(${a.firstComments}→${a.latestComments})</small></span>
        </div>`;
      })
      .join("");
  }

  // 分布バー
  const distEl = el<HTMLDivElement>("insightDistList");
  el("insightShareNote").textContent = `上位3作品集中度: ${analyzed.summary.top3SharePct.toFixed(1)}% ／ 上位10作品: ${analyzed.summary.top10SharePct.toFixed(1)}%`;
  distEl.innerHTML = analyzed.summary.distributionBuckets
    .map(
      (b) => `<div class="dist-row">
        <div class="dist-head">
          <span>${b.label}</span>
          <span>${b.count}作品 (${b.pct.toFixed(0)}%)</span>
        </div>
        <div class="dist-track"><div class="dist-bar" style="width: ${b.pct.toFixed(1)}%"></div></div>
      </div>`
    )
    .join("");

  // 全シーズン横断比較の遅延読込
  const crossCanvas = el<HTMLCanvasElement>("crossSeasonCanvas");
  const crossStatus = el<HTMLSpanElement>("crossSeasonStatus");
  crossStatus.textContent = "全シーズンデータを読み込み中...";

  const entries = await Promise.all(
    state.seasons.map(async (season) => ({
      season,
      data: await loadSeasonJson(season.key),
    }))
  );

  const summaries = summarizeCrossSeasons(entries, state.excludeRewatch);
  crossStatus.textContent = `${summaries.length} シーズン分の推移を表示中`;
  renderCrossSeasonChart(crossCanvas, summaries);
}

/**
 * 現在アクティブなタブのみ再描画する
 */
function renderCurrentTab(): void {
  if (!state.analyzed) return;

  const panels: Record<ActiveTab, string> = {
    ranking: "panelRanking",
    compare: "panelCompare",
    bump: "panelBump",
    insights: "panelInsights",
  };

  for (const [tab, panelId] of Object.entries(panels)) {
    el(panelId).classList.toggle("hidden", tab !== state.activeTab);
  }

  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.activeTab);
  });

  updateCompareTray();

  if (state.activeTab === "ranking") {
    renderRankingTab(state.analyzed);
  } else if (state.activeTab === "compare") {
    renderCompareTab(state.analyzed);
  } else if (state.activeTab === "bump") {
    renderBumpTab(state.analyzed);
  } else if (state.activeTab === "insights") {
    void renderInsightsTab(state.analyzed);
  }
}

/**
 * モーダル内の比較追加ボタン状態を更新する
 */
function renderModalCompareButton(animeId: number): void {
  const btn = el<HTMLButtonElement>("modalCompareBtn");
  const inCompare = state.compareIds.includes(animeId);
  btn.textContent = inCompare ? "比較リストから外す" : "＋ 比較リストに追加";
}

/**
 * 作品詳細モーダルを開く
 */
function openAnimeModal(animeId: number): void {
  if (!state.analyzed) return;
  const anime = state.analyzed.byId.get(animeId);
  if (!anime) return;

  state.modalAnimeId = animeId;
  el("modalTitle").textContent = anime.nameJp;
  el("modalSub").textContent = anime.englishTitle || `AniList ID: ${anime.id}`;
  el<HTMLAnchorElement>("modalAnilistLink").href = safeUrl(anime.anilistUrl);
  renderModalCompareButton(animeId);

  el("modalKpis").innerHTML = `
    <div class="modal-kpi"><div class="modal-kpi-label">最新話順位</div><div class="modal-kpi-val">${anime.latestRank}位</div></div>
    <div class="modal-kpi"><div class="modal-kpi-label">最新話 (${anime.latestEpisode}話)</div><div class="modal-kpi-val">${anime.latestComments.toLocaleString()}</div></div>
    <div class="modal-kpi"><div class="modal-kpi-label">1話平均</div><div class="modal-kpi-val">${anime.avgComments.toLocaleString()}</div></div>
    <div class="modal-kpi"><div class="modal-kpi-label">最高話 (${anime.maxEpisode}話)</div><div class="modal-kpi-val">${anime.maxComments.toLocaleString()}</div></div>
    <div class="modal-kpi"><div class="modal-kpi-label">累計コメント</div><div class="modal-kpi-val">${anime.totalComments.toLocaleString()}</div></div>
    <div class="modal-kpi"><div class="modal-kpi-label">シーズンシェア</div><div class="modal-kpi-val">${anime.sharePct.toFixed(1)}%</div></div>
  `;

  el<HTMLTableSectionElement>("modalEpisodeBody").innerHTML = [...anime.episodes]
    .reverse()
    .map((ep) => {
      const delta =
        ep.deltaFromPrev === null
          ? `<span class="delta-pill delta-flat">—</span>`
          : `<span class="delta-pill ${
              ep.deltaFromPrev > 0 ? "delta-up" : ep.deltaFromPrev < 0 ? "delta-down" : "delta-flat"
            }">${ep.deltaFromPrev > 0 ? "+" : ""}${ep.deltaFromPrev.toLocaleString()}</span>`;
      return `<tr>
        <td>第${ep.episode}話</td>
        <td class="num"><strong>${ep.comments.toLocaleString()}</strong></td>
        <td class="num">${delta}</td>
        <td><a class="mini-link" href="${safeUrl(ep.url)}" target="_blank" rel="noopener noreferrer">スレッド</a></td>
      </tr>`;
    })
    .join("");

  el("animeModal").classList.remove("hidden");
  renderModalEpisodeChart(el<HTMLCanvasElement>("modalChartCanvas"), anime);
}

/**
 * 作品詳細モーダルを閉じる
 */
function closeAnimeModal(): void {
  state.modalAnimeId = null;
  el("animeModal").classList.add("hidden");
}

/**
 * シーズン JSON をキャッシュ付きで取得する
 */
async function loadSeasonJson(seasonKey: string): Promise<RawSeasonData> {
  // パストラバーサル防止のためシーズンキーの形式を検証する
  if (!/^\d{4}_[1-4]_[a-z]+$/.test(seasonKey)) {
    throw new Error(`不正なシーズンキーです: ${seasonKey}`);
  }

  const cached = state.seasonCache.get(seasonKey);
  if (cached) return cached;

  const res = await fetch(`${BASE_PATH}data/reddit/${seasonKey}.json`);
  if (!res.ok) {
    throw new Error(`シーズンデータの取得に失敗しました: ${seasonKey} (${res.status})`);
  }
  const json = (await res.json()) as RawSeasonData;
  state.seasonCache.set(seasonKey, json);
  return json;
}

/**
 * 選択中のシーズンを読み込み・分析・描画する
 */
async function loadAndAnalyzeCurrentSeason(resetCompareIds: boolean): Promise<void> {
  const raw = await loadSeasonJson(state.currentSeasonKey);
  state.analyzed = analyzeSeason(raw, { excludeRewatch: state.excludeRewatch });

  if (resetCompareIds || state.compareIds.length === 0) {
    // 初期表示時は最新話トップ5を比較リストに自動セット
    state.compareIds = state.analyzed.animes.slice(0, 5).map((a) => a.id);
    state.bumpPinnedId = null;
  } else {
    // Rewatch切替時などは既存選択のうち有効なものだけ残す
    state.compareIds = state.compareIds.filter((id) => state.analyzed?.byId.has(id));
  }

  renderKpiCards(state.analyzed);
  renderCurrentTab();
}

/**
 * テーマを切り替える
 */
function toggleTheme(): void {
  const isLight = document.documentElement.dataset.theme === "light";
  const next = isLight ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("redview-theme", next);
  updateThemeButtonLabel();
  renderCurrentTab();
  if (state.modalAnimeId !== null && state.analyzed) {
    const anime = state.analyzed.byId.get(state.modalAnimeId);
    if (anime) renderModalEpisodeChart(el<HTMLCanvasElement>("modalChartCanvas"), anime);
  }
}

function updateThemeButtonLabel(): void {
  const isLight = document.documentElement.dataset.theme === "light";
  el("themeToggleBtn").textContent = isLight ? "🌙 ダーク" : "☀️ ライト";
}

/**
 * イベントリスナーの登録とアプリケーション初期化
 */
async function init(): Promise<void> {
  updateThemeButtonLabel();

  // シーズン一覧の読み込み
  const res = await fetch(`${BASE_PATH}data/reddit/seasons.json`);
  if (!res.ok) {
    throw new Error(`seasons.json の取得に失敗しました (${res.status})`);
  }
  const rawSeasons = (await res.json()) as SeasonItem[];
  state.seasons = sortSeasonsDesc(rawSeasons);

  const seasonSelect = el<HTMLSelectElement>("seasonSelect");
  seasonSelect.innerHTML = state.seasons
    .map((s) => `<option value="${escapeHtml(s.key)}">${escapeHtml(s.label)}</option>`)
    .join("");

  state.currentSeasonKey = state.seasons[0]?.key ?? "";
  seasonSelect.value = state.currentSeasonKey;

  // シーズン変更
  seasonSelect.addEventListener("change", () => {
    state.currentSeasonKey = seasonSelect.value;
    void loadAndAnalyzeCurrentSeason(true);
  });

  // Rewatch除外トグル
  const rewatchToggle = el<HTMLInputElement>("excludeRewatchToggle");
  rewatchToggle.addEventListener("change", () => {
    state.excludeRewatch = rewatchToggle.checked;
    void loadAndAnalyzeCurrentSeason(false);
  });

  // テーマ切替
  el("themeToggleBtn").addEventListener("click", toggleTheme);

  // タブ切替
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = (btn.dataset.tab as ActiveTab) ?? "ranking";
      renderCurrentTab();
    });
  });

  // ランキング種別ピル
  document.querySelectorAll<HTMLButtonElement>("[data-metric]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.rankingMetric = (btn.dataset.metric as RankingMetric) ?? "latest";
      state.sortKey = "metric";
      state.sortDir = "desc";
      renderCurrentTab();
    });
  });

  // テーブルソート
  document.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = (btn.dataset.sort as SortKey) ?? "metric";
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      } else {
        state.sortKey = key;
        state.sortDir = key === "rank" || key === "name" ? "asc" : "desc";
      }
      renderCurrentTab();
    });
  });

  // 検索・最低話数フィルタ
  el<HTMLInputElement>("searchInput").addEventListener("input", (e) => {
    state.searchQuery = (e.target as HTMLInputElement).value;
    renderCurrentTab();
  });

  el<HTMLInputElement>("minEpToggle").addEventListener("change", (e) => {
    state.minEpisodes = (e.target as HTMLInputElement).checked ? 3 : 0;
    renderCurrentTab();
  });

  // テーブル内イベント委譲（チェックボックス・作品モーダル）
  el("rankingBody").addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    if (target.matches("input[data-compare-id]")) {
      const id = Number((target as HTMLInputElement).dataset.compareId);
      if (Number.isFinite(id)) toggleCompareId(id);
    }
  });

  el("rankingBody").addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-open-modal]");
    if (target) {
      const id = Number(target.dataset.openModal);
      if (Number.isFinite(id)) openAnimeModal(id);
    }
  });

  // KPI カードクリックでモーダル
  document.querySelectorAll<HTMLElement>(".kpi-card[id]").forEach((card) => {
    card.addEventListener("click", () => {
      const id = Number(card.dataset.animeId);
      if (Number.isFinite(id) && id > 0) openAnimeModal(id);
    });
  });

  // フローティング比較トレイ
  el("goCompareBtn").addEventListener("click", () => {
    state.activeTab = "compare";
    renderCurrentTab();
  });

  el("clearCompareBtn").addEventListener("click", () => {
    state.compareIds = [];
    renderCurrentTab();
  });

  // 比較スタジオ内イベント
  el("selectedChips").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-remove-compare]");
    if (btn) {
      const id = Number(btn.dataset.removeCompare);
      if (Number.isFinite(id)) toggleCompareId(id);
    }
  });

  el<HTMLSelectElement>("addCompareSelect").addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    const id = Number(select.value);
    if (Number.isFinite(id) && id > 0) {
      toggleCompareId(id);
      select.value = "";
    }
  });

  el("resetTop5Btn").addEventListener("click", () => {
    if (!state.analyzed) return;
    state.compareIds = state.analyzed.animes.slice(0, 5).map((a) => a.id);
    renderCurrentTab();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-compare-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.compareChartType = btn.dataset.compareType as AppState["compareChartType"];
      renderCurrentTab();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-xmode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.compareXMode = btn.dataset.xmode as AppState["compareXMode"];
      renderCurrentTab();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-scale]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.compareScale = btn.dataset.scale as AppState["compareScale"];
      renderCurrentTab();
    });
  });

  // バンプチャート制御
  document.querySelectorAll<HTMLButtonElement>("[data-bump-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.bumpPreset = btn.dataset.bumpPreset as AppState["bumpPreset"];
      state.bumpPinnedId = null;
      renderCurrentTab();
    });
  });

  const bumpLegend = el<HTMLDivElement>("bumpLegendList");
  bumpLegend.addEventListener("mouseover", (e) => {
    if (state.bumpPinnedId !== null) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-bump-id]");
    if (item) {
      highlightBumpSeries(Number(item.dataset.bumpId));
    }
  });

  bumpLegend.addEventListener("mouseleave", () => {
    if (state.bumpPinnedId === null) {
      highlightBumpSeries(null);
    }
  });

  bumpLegend.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-bump-id]");
    if (!item) return;
    const id = Number(item.dataset.bumpId);
    state.bumpPinnedId = state.bumpPinnedId === id ? null : id;
    renderCurrentTab();
  });

  // インサイトリストクリックでモーダル
  el("panelInsights").addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-open-modal]");
    if (row) {
      const id = Number(row.dataset.openModal);
      if (Number.isFinite(id)) openAnimeModal(id);
    }
  });

  // モーダル制御
  el("modalCloseBtn").addEventListener("click", closeAnimeModal);
  el("animeModal").addEventListener("click", (e) => {
    if (e.target === el("animeModal")) closeAnimeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.modalAnimeId !== null) {
      closeAnimeModal();
    }
  });
  el("modalCompareBtn").addEventListener("click", () => {
    if (state.modalAnimeId !== null) toggleCompareId(state.modalAnimeId);
  });

  // 初回データ読込
  await loadAndAnalyzeCurrentSeason(true);
}

void init();
