# match_titles.py
import json
import re
from datetime import datetime, timezone
from rapidfuzz import fuzz
from fetch_anilist import get_current_season_anime

# -------- settings ----------
MIN_WORD_LEN = 4          # 「意味のある単語」とみなす最小長
HIGH_SCORE = 90          # これ以上なら即採用
MID_SCORE = 72           # このレンジだと共通長単語が必要
# ----------------------------

def clean_title(text):
    """ノイズを除去して小文字英数字スペースにする"""
    if not text:
        return ""
    s = text.lower()
    # 削除したいノイズ語や表記
    s = re.sub(r'\[.*?\]', ' ', s)            # [Spoilers]
    s = re.sub(r'\(.*?\)', ' ', s)            # (spoiler)
    s = re.sub(r'episode\s*\d+', ' ', s)
    s = re.sub(r'\bep\s*\d+\b', ' ', s)
    s = re.sub(r'\bseason\s*\d+\b', ' ', s)
    s = re.sub(r'\bnew\b', ' ', s)
    s = re.sub(r'\btrailer\b', ' ', s)
    s = re.sub(r'\bvisual\b', ' ', s)
    s = re.sub(r'\bpreview\b', ' ', s)
    s = re.sub(r'[^0-9a-z\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\s]', ' ', s)  # 英数字＋日本語以外は削除
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def tokenize_significant(text):
    """意味のある単語集合を返す（長さフィルター）"""
    if not text:
        return set()
    toks = text.split()
    # 数字のみや短い単語は無視
    sig = {t for t in toks if len(t) >= MIN_WORD_LEN and not t.isdigit()}
    return sig

def prepare_anime_titles(anime_titles):
    """(original, cleaned, token_set) のリストを返す"""
    out = []
    for t in anime_titles:
        for v in [t.get("romaji"), t.get("english"), t.get("native")]:
            if v:
                cleaned = clean_title(v)
                tokens = tokenize_significant(cleaned)
                out.append({
                    "orig": v,
                    "clean": cleaned,
                    "tokens": tokens
                })
    # 重複削除（cleanが同じならまとめる）
    uniq = {}
    for a in out:
        key = a["clean"]
        if key not in uniq:
            uniq[key] = a
    return list(uniq.values())

def load_latest_snapshot():
    with open("data/latest.json", encoding="utf-8") as f:
        return json.load(f)

def match_single_post(title, anime_list):
    """1投稿をアニメリストと照合して (matched_orig, score, debug_top3) を返す"""
    cleaned_title = clean_title(title)
    title_tokens = tokenize_significant(cleaned_title)

    best = None
    best_score = 0
    top3 = []

    for a in anime_list:
        score = fuzz.token_set_ratio(cleaned_title, a["clean"])
        top3.append((a["orig"], score, a["tokens"]))

    # top3 をソートして上位3を取り出す（デバッグ用）
    top3.sort(key=lambda x: x[1], reverse=True)
    top3_short = top3[:3]

    for orig, score, tokens in top3_short:
        # まず高スコアなら無条件採用
        if score >= HIGH_SCORE:
            return orig, score, top3_short

    # そうでなければ上位候補を個別チェック
    for orig, score, tokens in top3_short:
        if score >= MID_SCORE:
            # 共通の「意味のある単語」が1つ以上あれば採用
            if len(title_tokens & tokens) >= 1:
                return orig, score, top3_short

    # NG
    return None, 0, top3_short

def match_titles(reddit_data, anime_titles):
    anime_list = prepare_anime_titles(anime_titles)

    matches = []
    debug_skipped = []
    for post in reddit_data["posts"]:
        title = post.get("title", "")
        matched, score, top3 = match_single_post(title, anime_list)
        if matched:
            matches.append({
                "reddit_title": title,
                "matched_anime": matched,
                "score": float(score),
                "num_comments": post.get("num_comments", 0),
                "url": "https://reddit.com" + post.get("permalink", "")
            })
        else:
            # デバッグ用にトップ候補を保存して閾値調整に使えるようにする
            debug_skipped.append({
                "reddit_title": title,
                "top_candidates": [{"title": t[0], "score": float(t[1])} for t in top3]
            })

    return matches, debug_skipped

def main():
    reddit_data = load_latest_snapshot()
    anime_titles = get_current_season_anime()

    matches, debug_skipped = match_titles(reddit_data, anime_titles)

    now = datetime.now(timezone.utc)
    out = {
        "snapshot_at": now.isoformat(),
        "matched_posts": matches,
        "debug_skipped_sample": debug_skipped[:50]  # もっと見たければ増やしてね
    }

    filename = f"data/matched_{now.strftime('%Y%m%d')}.json"
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    with open("data/matched_latest.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Matched {len(matches)} posts. Saved to {filename}")
    print(f"Skipped examples saved in debug_skipped_sample (count={len(debug_skipped[:50])})")

if __name__ == "__main__":
    main()
