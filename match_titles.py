import json
from datetime import datetime, timezone
from rapidfuzz import fuzz, process
from fetch_anilist import get_current_season_anime

def load_latest_snapshot():
    with open("data/latest.json", encoding="utf-8") as f:
        return json.load(f)

def match_titles(reddit_data, anime_titles, threshold=75):
    all_titles = []
    for t in anime_titles:
        for v in [t["romaji"], t["english"], t["native"]]:
            if v:
                all_titles.append(v)

    matches = []
    for post in reddit_data["posts"]:
        title = post["title"]
        match, score, _ = process.extractOne(title, all_titles, scorer=fuzz.partial_ratio)
        if score >= threshold:
            matches.append({
                "reddit_title": title,
                "matched_anime": match,
                "score": score,
                "num_comments": post["num_comments"],
                "url": "https://reddit.com" + post["permalink"]
            })
    return matches

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
