import json
import re
from collections import defaultdict
from rapidfuzz import fuzz

# ========================
# 設定値
# ========================
FUZZY_THRESHOLD = 80
MIN_TOKEN_MATCH = 2

STOPWORDS = {
    "the", "a", "an", "of", "to", "and", "or", "in", "on",
    "season", "part", "episode", "ep", "discussion",
    "new", "visual", "trailer", "pv"
}

# ========================
# ユーティリティ
# ========================
def normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def tokenize(text: str) -> set[str]:
    return {
        t for t in normalize(text).split()
        if t not in STOPWORDS and len(t) >= 3
    }


# ========================
# AniListタイトル整理
# ========================
def build_anime_index(anime_list):
    """
    1作品 = 1エントリ
    romaji / english / native を alias としてまとめる
    """
    index = []
    token_usage = defaultdict(int)

    for a in anime_list:
        aliases = set(filter(None, [
            a.get("romaji"),
            a.get("english"),
            a.get("native"),
        ]))

        all_tokens = set()
        for title in aliases:
            all_tokens |= tokenize(title)

        for t in all_tokens:
            token_usage[t] += 1

        index.append({
            "native": a["native"],     # 出力用
            "aliases": list(aliases),  # マッチ用
            "tokens": all_tokens,
        })

    return index, token_usage


# ========================
# マッチ判定
# ========================
def match_title(reddit_title, anime_index, token_usage):
    r_tokens = tokenize(reddit_title)

    best = None
    best_score = 0

    for anime in anime_index:
        shared = r_tokens & anime["tokens"]

        # --- 1単語マッチ制限 ---
        if len(shared) < MIN_TOKEN_MATCH:
            if len(shared) == 1:
                token = next(iter(shared))
                # その単語が今期で唯一なら許可
                if token_usage[token] > 1:
                    continue
            else:
                continue

        # --- ファジーマッチ（タイトル全体） ---
        for alias in anime["aliases"]:
            score = fuzz.partial_ratio(
                normalize(reddit_title),
                normalize(alias)
            )

            if score > best_score:
                best = anime
                best_score = score

    if best and best_score >= FUZZY_THRESHOLD:
        return best["native"], best_score

    return None, None


# ========================
# メイン処理
# ========================
def main():
    from fetch_anilist import get_current_season_anime
    anime_list = get_current_season_anime()

    with open("data/latest.json", encoding="utf-8") as f:
        reddit_posts = json.load(f)

    anime_index, token_usage = build_anime_index(anime_list)

    results = []

    for post in reddit_posts:
        matched, score = match_title(post["title"], anime_index, token_usage)
        if not matched:
            continue

        results.append({
            "reddit_title": post["title"],
            "matched_anime": matched,   # ← 日本語タイトル固定
            "score": score,
            "num_comments": post.get("num_comments", 0),
            "url": post["url"],
        })

    with open("data/matched_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
