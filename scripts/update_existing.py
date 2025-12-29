import json
import time
import requests
from datetime import datetime
from pathlib import Path
import shutil
import praw
import os

SEASON_COUNT = 4  # 直近何シーズン分を更新するか 1~
EPISODE_COUNT = 6  # 直近何話分を更新するか 1~

# 環境変数から取得
CLIENT_ID = os.getenv("REDDIT_CLIENT_ID")
CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET")
USERNAME = os.getenv("REDDIT_USERNAME")
PASSWORD = os.getenv("REDDIT_PASSWORD")
USER_AGENT = os.getenv("REDDIT_USER_AGENT", "r-anime-scraper/0.1 by example")

if not all([CLIENT_ID, CLIENT_SECRET, USERNAME, PASSWORD]):
    raise SystemExit("Missing Reddit credentials in environment variables.")

reddit = praw.Reddit(
    client_id=CLIENT_ID,
    client_secret=CLIENT_SECRET,
    username=USERNAME,
    password=PASSWORD,
    user_agent=USER_AGENT,
    check_for_updates=False,
    ratelimit_seconds=60
)

# PRAWを使ったコメント数取得
def fetch_comment_count_praw(reddit_url):
    post_id = reddit_url.split("/comments/")[1].split("/")[0]
    submission = reddit.submission(id=post_id)
    return submission.num_comments

# シーズン取得ヘルパー
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

# シーズンキーリスト取得
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

# 対象投稿イテレータ
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


MAX_403 = 3 # 403エラーが連続したら中断する
count_403 = 0

# 各シーズンファイルを更新
for key in season_keys:
    path = Path(f"data/reddit/{key}.json")
    if not path.exists():
        continue

    print("updating:", path)

    with path.open(encoding="utf-8") as f:
        data = json.load(f)

    updated = 0
    checked = 0
    for post in iter_target_posts(data):
        try:
            # コメント数取得
            new_count = fetch_comment_count_praw(post["reddit_id"])
            old_count = post.get("num_comments")

            # 更新があれば反映
            if old_count != new_count:
                post["num_comments"] = new_count
                post["archived_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                updated += 1
            checked += 1
            time.sleep(1.5) # API負荷を下げるためにわずかに待つ
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 403:
                count_403 += 1
                print(f"403 skip ({count_403}/{MAX_403}):", post["reddit_id"])

                if count_403 >= MAX_403:
                    print("Too many 403s, abort this season")
                    break   # ← このシーズンを中断

                time.sleep(10)  # クールダウン
                continue
            else:
                print("HTTP error:", post["reddit_id"], e)

        except Exception as e:
            print("other error:", post["reddit_id"], e)

    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("checked posts:", checked)
    print("updated posts:", updated)

# 最新のデータを astro/public/data/reddit にコピーする
shutil.copytree(
    "./data/reddit",
    "./astro/public/data/reddit",
    dirs_exist_ok=True
)