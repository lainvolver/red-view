import json
import re
from collections import defaultdict
from rapidfuzz import fuzz

# ========================
# 設定値
# ========================
FUZZY_THRESHOLD = 80
MIN_TOKEN_MATCH = 2
# If fuzzy score is >= this, allow match even when token overlap < MIN_TOKEN_MATCH
HIGH_FUZZY_OVERRIDE = 85

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
        # Allow a match when token overlap is sufficient, or when a high
        # fuzzy score indicates a strong match despite low token overlap
        low_token_overlap = len(shared) < MIN_TOKEN_MATCH

        # --- ファジーマッチ（タイトル全体） ---
        for alias in anime["aliases"]:
            score = fuzz.partial_ratio(
                normalize(reddit_title),
                normalize(alias)
            )

            # If tokens are few, require a high fuzzy score to override
            if low_token_overlap:
                if len(shared) == 1:
                    token = next(iter(shared))
                    # If that single token is common across many titles, prefer
                    # to skip unless fuzzy score is very high (override)
                    if token_usage[token] > 1 and score < HIGH_FUZZY_OVERRIDE:
                        continue
                else:
                    if score < HIGH_FUZZY_OVERRIDE:
                        continue

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
    # Load AniList data from local cache created by `fetch_anilist.py`.
    # To re-enable live fetching, uncomment the fallback below.
    try:
        with open("data/anilist.json", encoding="utf-8") as f:
            anime_list = json.load(f)
    except FileNotFoundError:
        # Fallback (commented): fetch from AniList and save
        # from fetch_anilist import get_current_season_anime
        # anime_list = get_current_season_anime()
        raise RuntimeError("data/anilist.json not found. Run fetch_anilist.py to create it.")

    with open("data/latest.json", encoding="utf-8") as f:
        loaded = json.load(f)
        if isinstance(loaded, dict) and "posts" in loaded:
            reddit_posts = loaded["posts"]
        elif isinstance(loaded, list):
            reddit_posts = loaded
        else:
            raise RuntimeError("data/latest.json has unexpected format; expected list or {'posts': [...]}")

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

    # Also create a filtered file containing only posts that mention "Episode XX"
    # and keep only the entry with the largest episode number for each `matched_anime`.
    ep_re = re.compile(r"Episode\s+(\d+)\s+discussion", re.IGNORECASE)
    ep_map = {}
    for entry in results:
        title = entry.get("reddit_title", "")
        nums = [int(n) for n in ep_re.findall(title)]
        if not nums:
            continue
        ep = max(nums)
        key = entry["matched_anime"]
        cur = ep_map.get(key)
        if cur is None or ep > cur[0]:
            ep_map[key] = (ep, entry)

    latest_episode_results = [v[1] for v in ep_map.values()]
    with open("data/matched_results_latest-Episode.json", "w", encoding="utf-8") as f:
        json.dump(latest_episode_results, f, ensure_ascii=False, indent=2)

    # Generate a GitHub README.md summarizing latest-episode results as a table
    try:
        sorted_rows = sorted(
            latest_episode_results,
            key=lambda e: e.get("num_comments", 0),
            reverse=True,
        )

        lines = [
            "# Reddit Latest Episode Ranking\n",
            "Generated from data/matched_results_latest-Episode.json\n",
            "| rank | matched_anime | num_comments | Episode | URL |",
            "|---|---|---:|---:|---|",
        ]

        def _escape_pipe(s: str) -> str:
            return (s or "").replace("|", "&#124;")

        for idx, r in enumerate(sorted_rows, start=1):
            rank = idx
            anime = _escape_pipe(r.get("matched_anime", ""))
            num = r.get("num_comments", 0)
            url = r.get("url", "")
            url_md = f"[URL]({url})" if url else ""
            # extract episode number from reddit_title
            title_txt = r.get("reddit_title", "")
            ep_match = ep_re.search(title_txt)
            episode = ep_match.group(1) if ep_match else ""
            lines.append(f"| {rank} | {anime} | {num} | {episode} | {url_md} |")

        readme_text = "\n".join(lines) + "\n"
        with open("README.md", "w", encoding="utf-8") as rf:
            rf.write(readme_text)
    except Exception:
        # Do not fail the whole run on README generation errors
        pass


if __name__ == "__main__":
    main()
