# 実装計画：選択作品名の表示追加

## 概要
ユーザーの要望に従い、「コメント数推移」グラフを表示している際、現在選択されている作品名がグラフの上部に大きく表示されるようにUIを改善します。

## 変更内容
### 1. HTML要素の追加
`index.astro` の `chartContainer` 内に、作品名を表示するための `<h2>` タグ（`id="selectedAnimeTitle"`）を追加します。最初は非表示（`display: none`）としておきます。

### 2. JavaScriptの処理追加
#### `mode === "history"` (ランキング推移) の場合
ランキング推移では特定の単一作品を選ぶという概念がないため、`selectedAnimeTitle` 要素を非表示（`display: none`）にします。

#### `mode === "comments_history"` (コメント数推移) の場合
現在選択されている作品名（`selectedAnimeForCommentsHistory` の値）を `selectedAnimeTitle` のテキストにセットし、要素を表示（`display: block` または `display: flex` 等）します。

## 対象ファイル
- `astro/src/pages/index.astro`
