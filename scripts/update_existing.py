import json
import time
import requests
from datetime import datetime
from pathlib import Path
import shutil

SEASON_COUNT = 4  # 直近何シーズン分を更新するか 1~
EPISODE_COUNT = 6  # 直近何話分を更新するか 1~

HEADERS = {
    "User-Agent": "anime-comment-tracker/0.1"
}

def fetch_comment_count(reddit_url):
    post_id = reddit_url.split("/comments/")[1].split("/")[0]
    api_url = f"https://www.reddit.com/comments/{post_id}.json"

    r = requests.get(api_url, headers=HEADERS, timeout=10)
    r.raise_for_status()
    j = r.json()
    return j[0]["data"]["children"][0]["data"]["num_comments"]

def get_current_season():
    now = datetime.now()
    y, m = now.year, now.month

    if m <= 3:
        return (y, 1)  # winter
    if m <= 6:
        return (y, 2)  # spring
    if m <= 9:
        return (y, 3)  # summer
    return (y, 4)      # fall


def get_season_keys(back=2):
    y, s = get_current_season()
    keys = []

    for _ in range(back):
        name = ["winter", "spring", "summer", "fall"][s - 1]
        keys.append(f"{y}_{s}_{name}")

        s -= 1
        if s == 0:
            s = 4
            y -= 1

    return keys


def iter_target_posts(data):
    for anime in data["anime"].values():
        latest = anime.get("latest_episode")
        if not latest:
            continue

        # 最新エピソードの (EPISODE_COUNT-1) 話前から最新までの投稿を対象とする
        for ep in range(max(1, latest - (EPISODE_COUNT - 1) ), latest + 1):
            posts = anime.get("episodes", {}).get(str(ep))
            if not posts:
                continue
            for post in posts:
                yield post

season_keys = get_season_keys(SEASON_COUNT)

for key in season_keys:
    path = Path(f"data/reddit/{key}.json")
    if not path.exists():
        continue

    print("updating:", path)

    with path.open(encoding="utf-8") as f:
        data = json.load(f)

    updated = 0
    for post in iter_target_posts(data):
        try:
            post["num_comments"] = fetch_comment_count(post["reddit_id"])
            post["archived_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            updated += 1
            time.sleep(1)
        except Exception as e:
            print("failed:", post["reddit_id"], e)

    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("updated posts:", updated)

# 最新のデータを astro/public/data/reddit にコピーする
shutil.copytree(
    "./data/reddit",
    "./astro/public/data/reddit",
    dirs_exist_ok=True
)