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
ARCTIC_SHIFT_IDS_URL = "https://arctic-shift.photon-reddit.com/api/posts/ids"

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


reddit = create_reddit_client(read_only=True) if (CLIENT_ID and CLIENT_SECRET) else None
use_fallback_api = reddit is None


def extract_post_id(reddit_url: str) -> str:
    """Reddit URL から投稿 ID を抽出する"""
    if "/comments/" in reddit_url:
        return reddit_url.split("/comments/")[1].split("/")[0]
    return reddit_url.strip("/").split("/")[-1]


# PRAWを使ったコメント数取得
def fetch_comment_count_praw(reddit_url):
    post_id = extract_post_id(reddit_url)
    submission = reddit.submission(id=post_id)
    return submission.num_comments


def fetch_comment_counts_arctic_shift(post_ids: list[str]) -> dict[str, int]:
    """Arctic Shift API を使用して複数の投稿IDのコメント数を一括取得する（100件ずつバッチ処理）"""
    counts = {}
    unique_ids = list(dict.fromkeys(pid for pid in post_ids if pid))
    headers = {"User-Agent": USER_AGENT}

    for i in range(0, len(unique_ids), 100):
        batch = unique_ids[i:i + 100]
        for retry in range(3):
            try:
                resp = requests.get(
                    ARCTIC_SHIFT_IDS_URL,
                    params={"ids": ",".join(batch)},
                    headers=headers,
                    timeout=20,
                )
                if resp.status_code in (422, 429, 500, 502, 503, 504) and retry < 2:
                    time.sleep(2 * (retry + 1))
                    continue
                resp.raise_for_status()
                payload = resp.json()
                for item in payload.get("data") or []:
                    pid = item.get("id")
                    if pid and item.get("num_comments") is not None:
                        counts[pid] = int(item["num_comments"])
                break
            except Exception as e:
                if retry < 2:
                    time.sleep(2 * (retry + 1))
                    continue
                print(f"warn: Arctic Shift batch lookup failed (batch {i // 100 + 1}): {e}")
        time.sleep(0.8)

    return counts


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
        for ep in range(max(1, latest - (EPISODE_COUNT - 1)), latest + 1):
            posts = anime.get("episodes", {}).get(str(ep))
            if not posts:
                continue
            for post in posts:
                yield post


season_keys = get_season_keys(SEASON_COUNT)

MAX_403 = 3  # 認証・403エラーが連続したら PRAW を諦めてフォールバックAPIへ切り替える
count_403 = 0

# 各シーズンファイルを更新
for key in season_keys:
    path = Path(f"data/reddit/{key}.json")
    if not path.exists():
        continue

    print("updating:", path)

    with path.open(encoding="utf-8") as f:
        data = json.load(f)

    target_posts = list(iter_target_posts(data))
    updated = 0
    checked = 0
    remaining_for_fallback = []

    if not use_fallback_api:
        for idx, post in enumerate(target_posts):
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
            except (prawcore.exceptions.PrawcoreException, requests.exceptions.HTTPError) as e:
                status_code = getattr(getattr(e, "response", None), "status_code", None)
                is_auth_or_403 = (
                    isinstance(e, (prawcore.exceptions.Forbidden, prawcore.exceptions.OAuthException))
                    or status_code in (401, 403)
                )
                if is_auth_or_403:
                    count_403 += 1
                    print(f"auth/403 error ({count_403}/{MAX_403}):", post["reddit_id"], e)

                    # 初回のエラー発生時、認証情報があれば別モードへ切り替えて試行
                    if count_403 == 1 and USERNAME and PASSWORD and reddit and reddit.read_only:
                        print("info: switching Reddit client to user-auth mode")
                        reddit = create_reddit_client(read_only=False)

                    if count_403 >= MAX_403:
                        print("info: switching to Arctic Shift fallback API for remaining posts")
                        use_fallback_api = True
                        remaining_for_fallback = target_posts[idx:]
                        break

                    time.sleep(3)
                    continue
                else:
                    print("HTTP error:", post["reddit_id"], e)
            except Exception as e:
                print("other error:", post["reddit_id"], e)
    else:
        remaining_for_fallback = target_posts

    # PRAW が利用できない場合や途中でフォールバックに切り替わった場合は一括取得で更新
    if remaining_for_fallback:
        post_ids = [extract_post_id(p["reddit_id"]) for p in remaining_for_fallback]
        counts_map = fetch_comment_counts_arctic_shift(post_ids)
        for post in remaining_for_fallback:
            pid = extract_post_id(post["reddit_id"])
            if pid in counts_map:
                new_count = counts_map[pid]
                old_count = post.get("num_comments")
                if old_count != new_count:
                    post["num_comments"] = new_count
                    post["archived_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    updated += 1
                checked += 1

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
