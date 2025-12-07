import json
import re
from datetime import datetime, timezone
from rapidfuzz import fuzz
from fetch_anilist import get_current_season_anime

# ------------------------------------------------------------
# ユーティリティ：タイトルのクリーニング
# ------------------------------------------------------------
def clean_title(text):
    text = text.lower()

    # [DISC], [SPOILERS] などを削除
    text = re.sub(r'\[.*?\]', '', text)

    # episode番号削除
    text = re.sub(r'episode\s*\d+', '', text)
    text = re.sub(r'ep\s*\d+', '', text)

    # 多すぎる記号削除
    text = re.sub(r'[^a-zA-Z0-9\s]', ' ', text)

    # 連続スペース除去
    text = re.sub(r'\s+', ' ', text).strip()

    return text

# ------------------------------------------------------------
# アニメタイトル候補のクリーニング
# ------------------------------------------------------------
def prepare_anime_titles(anime_titles):
    cleaned = []
    for t in anime_titles:
        for v in [t["romaji"], t["english"], t["native"]]:
            if v:
                cleaned.append((v, clean_title(v)))
    return cleaned

# ------------------------------------------------------------
# Redditタイトルとアニメタイトルを厳密マッチ
# ------------------------------------------------------------
def strict_match(reddit_title, anime_title_pairs):
    cleaned_r = clean_title(reddit_title)
    words_r = set(cleaned_r.split())

    best = None
    best_score = 0

    for original, cleaned_a in anime_title_pairs:
        # fuzzy の厳密度を上げる
        score = fuzz.ratio(cleaned_r, cleaned_a)

        # 共通単語チェック（誤爆回避）
        words_a = set(cleaned_a.split())
        common = words_r & words_a

        # 共通語がゼロならスキップ（WanDance → Philosophy no Dance 対策）
        if len(common) == 0:
            continue

        if score > best_score:
            best_score = score
            best = original

    # 閾値設定（80前後が安全）
    if best_score >= 80:
        return best, best_score

    return None, 0

# ------------------------------------------------------------
# json読み込み
# ------------------------------------------------------------
def load_latest_snapshot():
    with open("data/latest.json", encoding="utf-8") as f:
        return json.load(f)

# ------------------------------------------------------------
# メインマッチ関数
# ------------------------------------------------------------
def match_titles(reddit_data, anime_titles):
    anime_pairs = prepare_anime_titles(anime_titles)

    matches = []
    for post in reddit_data["posts"]:
        title = post["title"]

        matched, score = strict_match(title, anime_pairs)

        if matched:
            matches.append({
                "reddit_title": title,
                "matched_anime": matched,
                "score": score,
                "num_comments": post["num_comments"],
                "url": "https://reddit.com" + post["permalink"]
            })

    return matches

# ------------------------------------------------------------
# メイン処理
# ------------------------------------------------------------
def main():
    reddit_data = load_latest_snapshot()
    anime_titles = get_current_season_anime()

    matches = match_titles(reddit_data, anime_titles)

    now = datetime.now(timezone.utc)
    out = {
        "snapshot_at": now.isoformat(),
        "matched_posts": matches
    }

    filename = f"data/matched_{now.strftime('%Y%m%d')}.json"
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    with open("data/matched_latest.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Matched {len(matches)} posts. Saved to {filename}")

if __name__ == "__main__":
    main()
