import json
import time
import requests
from datetime import datetime
from pathlib import Path
import shutil
import praw
import prawcore
import os

SEASON_COUNT = 4  # 直近何シーズン分を更新するか 1~
EPISODE_COUNT = 6  # 直近何話分を更新するか 1~

# 環境変数から取得
CLIENT_ID = (os.getenv("REDDIT_CLIENT_ID") or "").strip()
CLIENT_SECRET = (os.getenv("REDDIT_CLIENT_SECRET") or "").strip()
USERNAME = (os.getenv("REDDIT_USERNAME") or "").strip()
PASSWORD = (os.getenv("REDDIT_PASSWORD") or "").strip()

# GitHub Actions で未設定のシークレットは空文字になるため、空文字や汎用文字列の場合は
# Reddit 規約に準拠した User-Agent 形式へフォールバックする
_raw_ua = (os.getenv("REDDIT_USER_AGENT") or "").strip()
_ua_user = USERNAME or "LedazenOshyqizan"
if not _raw_ua or "example" in _raw_ua.lower() or "scraper" in _raw_ua.lower():
    USER_AGENT = f"linux:red-view:v1.0 (by /u/{_ua_user})"
else:
    USER_AGENT = _raw_ua

if not all([CLIENT_ID, CLIENT_SECRET]):
    raise SystemExit("Missing Reddit CLIENT_ID or CLIENT_SECRET in environment variables.")


def create_reddit_client(read_only=True):
    """PRAW クライアントを生成する（公開データ取得のためデフォルトは Read-Only モード）"""
    if not read_only and USERNAME and PASSWORD:
        return praw.Reddit(
            client_id=CLIENT_ID,
            client_secret=CLIENT_SECRET,
            username=USERNAME,
            password=PASSWORD,
            user_agent=USER_AGENT,
            check_for_updates=False,
            ratelimit_seconds=60,
        )
    client = praw.Reddit(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        user_agent=USER_AGENT,
        check_for_updates=False,
        ratelimit_seconds=60,
    )
    client.read_only = True
    return client


reddit = create_reddit_client(read_only=True)

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
            count_403 = 0
            time.sleep(1.5)  # API負荷を下げるためにわずかに待つ
        except (prawcore.exceptions.Forbidden, prawcore.exceptions.ResponseException, requests.exceptions.HTTPError) as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if isinstance(e, prawcore.exceptions.Forbidden) or status_code == 403:
                count_403 += 1
                print(f"403 skip ({count_403}/{MAX_403}):", post["reddit_id"])

                # 初回の403発生時、認証情報があれば別モードへ切り替えて試行
                if count_403 == 1 and USERNAME and PASSWORD and reddit.read_only:
                    print("info: switching Reddit client to user-auth mode after 403")
                    reddit = create_reddit_client(read_only=False)

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