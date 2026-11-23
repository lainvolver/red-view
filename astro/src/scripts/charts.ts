// Chart.js v4 を利用した各種分析グラフ描画モジュール

import ChartAuto from "chart.js/auto";
import type {
  AnimeAnalytics,
  BumpChartData,
  ComparisonSeriesData,
  CrossSeasonSummary,
} from "./analytics";

// カスタムメタデータ付きデータセットを扱うためのコンストラクタ参照
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Chart: any = ChartAuto;

/** 視認性を高める固定12色パレット */
export const CHART_PALETTE = [
  "#f97316", // コーラルオレンジ
  "#38bdf8", // スカイブルー
  "#10b981", // エメラルド
  "#a855f7", // パープル
  "#f43f5e", // ローズ
  "#eab308", // アンバー
  "#14b8a6", // ティール
  "#ec4899", // ピンク
  "#6366f1", // インディゴ
  "#84cc16", // ライム
  "#06b6d4", // シアン
  "#fb7185", // ソフトローズ
];

export type ChartSlot = "compare" | "bump" | "scatter" | "share" | "crossSeason" | "modal";

// スロットごとの Chart インスタンス管理マップ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chartInstances = new Map<ChartSlot, any>();

/**
 * 作品名などの長いテキストを指定文字数で省略する
 */
export function truncateLabel(text: string, maxLen = 22): string {
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/**
 * HEX カラーに透明度を付与した RGBA 文字列を返す
 */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 現在のテーマに応じたグラフ配色を取得する
 */
function getThemeColors() {
  const isLight = document.documentElement.dataset.theme === "light";
  return {
    isLight,
    text: isLight ? "#334155" : "#cbd5e1",
    muted: isLight ? "#64748b" : "#94a3b8",
    grid: isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(148, 163, 184, 0.12)",
    guide: isLight ? "rgba(15, 23, 42, 0.22)" : "rgba(226, 232, 240, 0.25)",
    tooltipBg: isLight ? "rgba(15, 23, 42, 0.94)" : "rgba(15, 23, 42, 0.96)",
    tooltipBorder: isLight ? "rgba(148, 163, 184, 0.3)" : "rgba(148, 163, 184, 0.24)",
    surface: isLight ? "#ffffff" : "#151e2e",
  };
}

/**
 * 指定スロットの既存チャートを破棄する
 */
export function destroyChart(slot: ChartSlot): void {
  const existing = chartInstances.get(slot);
  if (existing) {
    existing.destroy();
    chartInstances.delete(slot);
  }
}

/**
 * すべてのチャートを破棄する
 */
export function destroyAllCharts(): void {
  for (const slot of chartInstances.keys()) {
    destroyChart(slot);
  }
}

/**
 * 比較チャートを描画する（折れ線推移 / 累積推移 / 指標比較棒グラフ）
 */
export function renderCompareChart(
  canvas: HTMLCanvasElement,
  params: {
    chartType: "line" | "cumulative" | "bar";
    seriesData: ComparisonSeriesData;
    selectedAnimes: AnimeAnalytics[];
    scaleType: "linear" | "logarithmic";
    colorMap: Map<number, string>;
  }
): void {
  destroyChart("compare");
  const theme = getThemeColors();
  const { chartType, seriesData, selectedAnimes, scaleType, colorMap } = params;

  if (chartType === "bar") {
    // 選択作品の「最新話 / 平均 / 最高話」を並べて比較する棒グラフ
    const labels = selectedAnimes.map((a) => truncateLabel(a.nameJp, 16));
    const fullNames = selectedAnimes.map((a) => a.nameJp);

    const makeVal = (v: number) => (scaleType === "logarithmic" && v <= 0 ? null : v);

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "最新話",
            data: selectedAnimes.map((a) => makeVal(a.latestComments)),
            rawValues: selectedAnimes.map((a) => a.latestComments),
            backgroundColor: hexToRgba("#f97316", 0.85),
            borderColor: "#f97316",
            borderWidth: 1,
            borderRadius: 6,
          },
          {
            label: "平均",
            data: selectedAnimes.map((a) => makeVal(a.avgComments)),
            rawValues: selectedAnimes.map((a) => a.avgComments),
            backgroundColor: hexToRgba("#38bdf8", 0.85),
            borderColor: "#38bdf8",
            borderWidth: 1,
            borderRadius: 6,
          },
          {
            label: "最高話",
            data: selectedAnimes.map((a) => makeVal(a.maxComments)),
            rawValues: selectedAnimes.map((a) => a.maxComments),
            backgroundColor: hexToRgba("#10b981", 0.82),
            borderColor: "#10b981",
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: theme.text, font: { size: 12 } },
          },
          y: {
            type: scaleType,
            beginAtZero: scaleType === "linear",
            grid: { color: theme.grid },
            ticks: {
              color: theme.muted,
              callback: (v: number) => Number(v).toLocaleString(),
            },
            title: {
              display: true,
              text: "コメント数",
              color: theme.muted,
            },
          },
        },
        plugins: {
          legend: {
            position: "top",
            labels: { color: theme.text, usePointStyle: true, padding: 16 },
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 12,
            callbacks: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              title: (items: any[]) => {
                const idx = items[0]?.dataIndex ?? 0;
                return fullNames[idx] ?? "";
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              label: (ctx: any) => {
                const raw = ctx.dataset.rawValues?.[ctx.dataIndex] ?? ctx.parsed.y ?? 0;
                return ` ${ctx.dataset.label}: ${Number(raw).toLocaleString()} 件`;
              },
            },
          },
        },
      },
    });

    chartInstances.set("compare", chart);
    return;
  }

  // 折れ線推移 / 累積推移
  const isCumulative = chartType === "cumulative";
  const datasets = seriesData.series.map((s, idx) => {
    const color = colorMap.get(s.id) ?? CHART_PALETTE[idx % CHART_PALETTE.length];
    const plotData = s.data.map((v) => {
      if (v === null) return null;
      if (scaleType === "logarithmic" && v <= 0) return null;
      return v;
    });

    return {
      label: s.nameJp,
      data: plotData,
      rawValues: s.data,
      borderColor: color,
      backgroundColor: isCumulative ? hexToRgba(color, 0.16) : color,
      borderWidth: 2.5,
      pointRadius: 3.5,
      pointHoverRadius: 6,
      pointBackgroundColor: color,
      pointBorderColor: theme.surface,
      pointBorderWidth: 1.5,
      tension: 0.25,
      fill: isCumulative,
      spanGaps: true,
    };
  });

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: seriesData.labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { color: theme.grid },
          ticks: { color: theme.muted, maxRotation: 0, autoSkip: true },
        },
        y: {
          type: scaleType,
          beginAtZero: scaleType === "linear",
          grid: { color: theme.grid },
          ticks: {
            color: theme.muted,
            callback: (v: number) => Number(v).toLocaleString(),
          },
          title: {
            display: true,
            text: isCumulative ? "累積コメント数" : "コメント数",
            color: theme.muted,
          },
        },
      },
      plugins: {
        legend: {
          display: false, // 上部のチップUIで作品管理するためチャート内凡例は非表示
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          itemSort: (a: { parsed: { y: number } }, b: { parsed: { y: number } }) =>
            (b.parsed?.y ?? 0) - (a.parsed?.y ?? 0),
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (ctx: any) => {
              const raw = ctx.dataset.rawValues?.[ctx.dataIndex];
              if (raw === null || raw === undefined) return undefined;
              return ` ${truncateLabel(ctx.dataset.label, 24)}: ${Number(raw).toLocaleString()} 件`;
            },
          },
        },
      },
    },
  });

  chartInstances.set("compare", chart);
}

/**
 * バンプチャート（順位推移）を描画する
 */
export function renderBumpChart(
  canvas: HTMLCanvasElement,
  bumpData: BumpChartData,
  colorMap: Map<number, string>,
  highlightedId: number | null
): void {
  destroyChart("bump");
  const theme = getThemeColors();

  // 全表示対象の中の最大順位を算出してY軸上限をすっきりさせる
  let maxRank = 10;
  for (const s of bumpData.series) {
    for (const r of s.ranks) {
      if (r !== null && r > maxRank) maxRank = r;
    }
  }

  const datasets = bumpData.series.map((s, idx) => {
    const baseColor = colorMap.get(s.id) ?? CHART_PALETTE[idx % CHART_PALETTE.length];
    const isFocused = highlightedId === null || highlightedId === s.id;
    const stroke = isFocused ? baseColor : hexToRgba(baseColor, 0.16);

    return {
      animeId: s.id,
      baseColor,
      label: s.nameJp,
      data: s.ranks,
      commentsMeta: s.comments,
      episodesMeta: s.episodes,
      borderColor: stroke,
      backgroundColor: stroke,
      borderWidth: highlightedId === s.id ? 4 : isFocused ? 2.5 : 1.5,
      pointRadius: highlightedId === s.id ? 5 : isFocused ? 3.5 : 2,
      pointHoverRadius: 6,
      tension: 0.22,
      fill: false,
      spanGaps: true,
    };
  });

  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: bumpData.labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: {
          grid: { color: theme.grid },
          ticks: { color: theme.muted },
        },
        y: {
          reverse: true,
          min: 1,
          suggestedMax: maxRank,
          grid: { color: theme.grid },
          ticks: {
            color: theme.muted,
            stepSize: 1,
            precision: 0,
            callback: (val: number) => `${val}位`,
          },
          title: {
            display: true,
            text: "コメント数順位（全作品内）",
            color: theme.muted,
          },
        },
      },
      plugins: {
        legend: {
          display: false, // 右側のインタラクティブ凡例パネルと連動
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (ctx: any) => {
              const rank = ctx.parsed.y;
              const comments = ctx.dataset.commentsMeta?.[ctx.dataIndex];
              const ep = ctx.dataset.episodesMeta?.[ctx.dataIndex];
              const epText = ep ? `第${ep}話 ` : "";
              const cText = comments !== null && comments !== undefined ? `（${Number(comments).toLocaleString()}件）` : "";
              return ` ${truncateLabel(ctx.dataset.label, 24)}: ${rank}位 ${epText}${cText}`;
            },
          },
        },
      },
    },
  });

  chartInstances.set("bump", chart);
}

/**
 * バンプチャート上の特定作品だけを再描画なしで高速ハイライトする
 */
export function highlightBumpSeries(animeId: number | null): void {
  const chart = chartInstances.get("bump");
  if (!chart) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ds of chart.data.datasets as any[]) {
    const isFocused = animeId === null || ds.animeId === animeId;
    const stroke = isFocused ? ds.baseColor : hexToRgba(ds.baseColor, 0.14);
    ds.borderColor = stroke;
    ds.backgroundColor = stroke;
    ds.borderWidth = animeId === ds.animeId ? 4.2 : isFocused ? 2.5 : 1.4;
    ds.pointRadius = animeId === ds.animeId ? 5.5 : isFocused ? 3.5 : 1.8;
    ds.order = animeId === ds.animeId ? 0 : 1;
  }
  chart.update("none");
}

/**
 * 熱量 × 勢い ポジショニングマップ（バブル散布図）を描画する
 */
export function renderPositioningScatter(
  canvas: HTMLCanvasElement,
  animes: AnimeAnalytics[],
  medianAvg: number,
  onSelectAnime: (animeId: number) => void
): void {
  destroyChart("scatter");
  const theme = getThemeColors();

  const maxTotal = Math.max(1, ...animes.map((a) => a.totalComments));

  const points = animes.map((a, idx) => {
    const ratio = Math.sqrt(a.totalComments / maxTotal);
    const r = Math.round(5 + ratio * 15);
    const isHot = a.latestVsAvgPct >= 0 && a.avgComments >= medianAvg;
    const isSurge = a.latestVsAvgPct >= 0 && a.avgComments < medianAvg;
    const isSteady = a.latestVsAvgPct < 0 && a.avgComments >= medianAvg;
    const color = isHot
      ? "#f97316"
      : isSurge
      ? "#10b981"
      : isSteady
      ? "#38bdf8"
      : "#94a3b8";

    return {
      x: a.avgComments,
      y: Math.round(a.latestVsAvgPct * 10) / 10,
      r,
      anime: a,
      color,
      idx,
    };
  });

  // 4象限ガイドラインとラベルをキャンバスに描画するカスタムプラグイン
  const quadrantPlugin = {
    id: "quadrantGuides",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeDatasetsDraw(chart: any) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales?.x || !scales?.y) return;

      const xMid = scales.x.getPixelForValue(medianAvg);
      const yZero = scales.y.getPixelForValue(0);

      ctx.save();
      ctx.strokeStyle = theme.guide;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);

      if (xMid >= chartArea.left && xMid <= chartArea.right) {
        ctx.beginPath();
        ctx.moveTo(xMid, chartArea.top);
        ctx.lineTo(xMid, chartArea.bottom);
        ctx.stroke();
      }

      if (yZero >= chartArea.top && yZero <= chartArea.bottom) {
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yZero);
        ctx.lineTo(chartArea.right, yZero);
        ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.font = "600 11px Inter, 'Noto Sans JP', sans-serif";
      ctx.fillStyle = theme.muted;
      ctx.globalAlpha = 0.72;

      ctx.textAlign = "right";
      ctx.fillText("覇権・絶好調", chartArea.right - 8, chartArea.top + 16);
      ctx.fillText("安定人気", chartArea.right - 8, chartArea.bottom - 10);

      ctx.textAlign = "left";
      ctx.fillText("神回・急上昇", chartArea.left + 8, chartArea.top + 16);
      ctx.fillText("静観・ニッチ", chartArea.left + 8, chartArea.bottom - 10);

      ctx.restore();
    },
  };

  const chart = new Chart(canvas, {
    type: "bubble",
    data: {
      datasets: [
        {
          label: "作品分布",
          data: points,
          backgroundColor: points.map((p) => hexToRgba(p.color, 0.68)),
          borderColor: points.map((p) => p.color),
          borderWidth: 1.5,
          hoverBorderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onClick: (_event: any, elements: any[]) => {
        if (elements.length > 0) {
          const point = points[elements[0].index];
          if (point) onSelectAnime(point.anime.id);
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: theme.grid },
          ticks: { color: theme.muted },
          title: {
            display: true,
            text: "1話あたり平均コメント数（基礎人気）",
            color: theme.muted,
          },
        },
        y: {
          grid: { color: theme.grid },
          ticks: {
            color: theme.muted,
            callback: (v: number) => `${v > 0 ? "+" : ""}${v}%`,
          },
          title: {
            display: true,
            text: "最新話の対平均比（勢い %）",
            color: theme.muted,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            title: (items: any[]) => {
              const p = points[items[0]?.dataIndex ?? 0];
              return p?.anime.nameJp ?? "";
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (ctx: any) => {
              const p = points[ctx.dataIndex];
              if (!p) return "";
              const a = p.anime;
              const sign = p.y > 0 ? "+" : "";
              return [
                ` 平均: ${a.avgComments.toLocaleString()} 件 / 最新話: ${a.latestComments.toLocaleString()} 件`,
                ` 勢い(対平均): ${sign}${p.y}% / 累計: ${a.totalComments.toLocaleString()} 件`,
              ];
            },
          },
        },
      },
    },
    plugins: [quadrantPlugin],
  });

  chartInstances.set("scatter", chart);
}

/**
 * コメントシェア構成（Top 10 + その他）のドーナツチャートを描画する
 */
export function renderShareDoughnut(
  canvas: HTMLCanvasElement,
  animes: AnimeAnalytics[],
  totalSeasonComments: number
): void {
  destroyChart("share");
  const theme = getThemeColors();

  const sorted = [...animes].sort((a, b) => b.totalComments - a.totalComments);
  const top10 = sorted.slice(0, 10);
  const othersTotal = sorted.slice(10).reduce((s, a) => s + a.totalComments, 0);

  const labels = top10.map((a) => truncateLabel(a.nameJp, 18));
  const fullLabels = top10.map((a) => a.nameJp);
  const values = top10.map((a) => a.totalComments);
  const colors = top10.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]);

  if (othersTotal > 0) {
    labels.push(`その他（${sorted.length - 10}作品）`);
    fullLabels.push(`その他（${sorted.length - 10}作品）`);
    values.push(othersTotal);
    colors.push(theme.isLight ? "#cbd5e1" : "#475569");
  }

  // ドーナツ中央に総コメント数を描画するプラグイン
  const centerTextPlugin = {
    id: "doughnutCenterText",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterDraw(chart: any) {
      const meta = chart.getDatasetMeta(0);
      if (!meta?.data?.[0]) return;
      const { x, y } = meta.data[0];
      const { ctx } = chart;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = theme.muted;
      ctx.font = "500 11px Inter, 'Noto Sans JP', sans-serif";
      ctx.fillText("総コメント", x, y - 10);
      ctx.fillStyle = theme.text;
      ctx.font = "700 17px Inter, 'Noto Sans JP', sans-serif";
      ctx.fillText(totalSeasonComments.toLocaleString(), x, y + 10);
      ctx.restore();
    },
  };

  const chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors.map((c) => hexToRgba(c, 0.88)),
          borderColor: theme.surface,
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "64%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: theme.text,
            boxWidth: 10,
            boxHeight: 10,
            padding: 10,
            font: { size: 11 },
          },
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            title: (items: any[]) => fullLabels[items[0]?.dataIndex ?? 0] ?? "",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (ctx: any) => {
              const val = Number(ctx.parsed ?? 0);
              const pct = totalSeasonComments > 0 ? ((val / totalSeasonComments) * 100).toFixed(1) : "0.0";
              return ` ${val.toLocaleString()} 件（${pct}%）`;
            },
          },
        },
      },
    },
    plugins: [centerTextPlugin],
  });

  chartInstances.set("share", chart);
}

/**
 * 全シーズン横断比較（総コメント数棒グラフ + 1話平均折れ線）を描画する
 */
export function renderCrossSeasonChart(
  canvas: HTMLCanvasElement,
  summaries: CrossSeasonSummary[]
): void {
  destroyChart("crossSeason");
  const theme = getThemeColors();

  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: summaries.map((s) => s.label),
      datasets: [
        {
          type: "bar",
          label: "シーズン総コメント数",
          data: summaries.map((s) => s.totalComments),
          backgroundColor: hexToRgba("#38bdf8", 0.72),
          borderColor: "#38bdf8",
          borderWidth: 1,
          borderRadius: 8,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "line",
          label: "1話あたり平均コメント数",
          data: summaries.map((s) => s.avgPerEpisode),
          borderColor: "#f97316",
          backgroundColor: "#f97316",
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 7,
          tension: 0.25,
          yAxisID: "y1",
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: theme.text },
        },
        y: {
          position: "left",
          beginAtZero: true,
          grid: { color: theme.grid },
          ticks: {
            color: theme.muted,
            callback: (v: number) => Number(v).toLocaleString(),
          },
          title: {
            display: true,
            text: "総コメント数",
            color: theme.muted,
          },
        },
        y1: {
          position: "right",
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: {
            color: "#f97316",
            callback: (v: number) => `${Number(v).toLocaleString()}件`,
          },
          title: {
            display: true,
            text: "1話あたり平均",
            color: "#f97316",
          },
        },
      },
      plugins: {
        legend: {
          position: "top",
          labels: { color: theme.text, usePointStyle: true, padding: 16 },
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            afterBody: (items: any[]) => {
              const idx = items[0]?.dataIndex ?? 0;
              const s = summaries[idx];
              if (!s) return [];
              return [
                `作品数: ${s.animeCount}作品 / 収録話数: ${s.totalEpisodes}話`,
                `累計1位: ${truncateLabel(s.topAnimeName, 26)} (${s.topAnimeTotal.toLocaleString()}件)`,
              ];
            },
          },
        },
      },
    },
  });

  chartInstances.set("crossSeason", chart);
}

/**
 * 作品詳細モーダル内の全話コメント推移棒グラフ（平均ライン付き）を描画する
 */
export function renderModalEpisodeChart(
  canvas: HTMLCanvasElement,
  anime: AnimeAnalytics
): void {
  destroyChart("modal");
  const theme = getThemeColors();

  const labels = anime.episodes.map((e) => `第${e.episode}話`);
  const values = anime.episodes.map((e) => e.comments);
  const avgLine = anime.episodes.map(() => anime.avgComments);

  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "コメント数",
          data: values,
          backgroundColor: anime.episodes.map((e) =>
            e.episode === anime.maxEpisode
              ? hexToRgba("#f97316", 0.9)
              : hexToRgba("#38bdf8", 0.72)
          ),
          borderColor: anime.episodes.map((e) =>
            e.episode === anime.maxEpisode ? "#f97316" : "#38bdf8"
          ),
          borderWidth: 1,
          borderRadius: 6,
          order: 2,
        },
        {
          type: "line",
          label: `平均 (${anime.avgComments.toLocaleString()}件)`,
          data: avgLine,
          borderColor: "#10b981",
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: theme.muted },
        },
        y: {
          beginAtZero: true,
          grid: { color: theme.grid },
          ticks: { color: theme.muted },
        },
      },
      plugins: {
        legend: {
          position: "top",
          labels: { color: theme.text, usePointStyle: true },
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          padding: 10,
        },
      },
    },
  });

  chartInstances.set("modal", chart);
}
