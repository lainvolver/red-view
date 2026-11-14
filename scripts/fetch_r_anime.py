# fetch_r_anime.py
import os
import time
import json
from datetime import datetime, timezone
import requests
import praw
import prawcore

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

SUB = "anime"
MAX_PER_LIST = 800  # hot/new で取る数。1000がAPI上の深さ制限に近いので余裕を持たせる
ARCTIC_SHIFT_SEARCH_URL = "https://arctic-shift.photon-reddit.com/api/posts/search"
MIN_FALLBACK_POSTS = 1000  # フォールバック時に最低限取得する件数
MAX_FALLBACK_PAGES = 30    # フォールバック時の最大ページ数（100件×30＝最大3000件）


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
    # Application-Only (client_credentials) モード：アカウントロック等の影響を受けにくい
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
praw_disabled = reddit is None


def _make_generator(client, list_type, limit):
    """指定されたリスト種別の PRAW ジェネレータを返す"""
    subreddit = client.subreddit(SUB)
    if list_type == "hot":
        return subreddit.hot(limit=limit)
    elif list_type == "new":
        return subreddit.new(limit=limit)
    elif list_type == "top":
        return subreddit.top(time_filter="day", limit=limit)
    else:
        raise ValueError(f"unknown list_type: {list_type}")


def pull_listing(list_type="hot", limit=MAX_PER_LIST):
    """hot / new / top listing を PRAW で取得して dict のリストで返す"""
    global reddit, praw_disabled
    if praw_disabled:
        return []

    items = []
    # 1回目: Read-Only モード (client_credentials)、失敗時は Password 認証にフォールバックして試行
    auth_modes = [True, False] if (USERNAME and PASSWORD) else [True]

    for attempt_idx, use_read_only in enumerate(auth_modes):
        if attempt_idx > 0 or reddit.read_only != use_read_only:
            mode_label = "read-only" if use_read_only else "user-auth"
            print(f"info: switching Reddit client to {mode_label} mode for '{list_type}'")
            reddit = create_reddit_client(read_only=use_read_only)

        gen = _make_generator(reddit, list_type, limit)
        try:
            for idx, post in enumerate(gen, start=1):
                try:
                    items.append({
                        "id": post.id,
                        "title": post.title,
                        "score": post.score,
                        "num_comments": post.num_comments,
                        "created_utc": int(post.created_utc),
                        "author": str(post.author) if post.author else None,
                        "permalink": post.permalink,
                        "url": post.url,
                        "is_self": post.is_self,
                        "flair": post.link_flair_text,
                    })
                except Exception as e:
                    # 個別投稿のパースでエラーが出た場合はスキップ
                    print("warn: skipping post due to", e)

                # PRAW は 100 件単位でバッチリクエストを行うため、100 件ごとにウェイトを入れる
                if idx % 100 == 0:
                    time.sleep(2)

            # 正常に取得完了したらループを抜ける
            break

        except prawcore.exceptions.PrawcoreException as e:
            status = getattr(getattr(e, "response", None), "status_code", "unknown")
            body = getattr(getattr(e, "response", None), "text", "")
            print(f"warn: Reddit API error on '{list_type}' (mode={'read-only' if use_read_only else 'user-auth'}, status={status}): {e}")
            if body:
                print(f"warn: response body preview: {body[:300]}")
            # 既に一部取得できている場合はそのまま活かし、0件なら次の認証モードでリトライ
            if items:
                print(f"info: keeping {len(items)} posts collected before error on '{list_type}'")
                break
            time.sleep(2)
        except Exception as e:
            print(f"warn: unexpected error while pulling '{list_type}': {e}")
            if items:
                break
            time.sleep(2)

    if not items:
        # 全ての認証モードで0件だった場合、以降のリストでも失敗するため PRAW を無効化してフォールバックへ移行する
        print(f"warn: PRAW failed for '{list_type}'; disabling PRAW for remaining listings and using fallback API.")
        praw_disabled = True

    print(f"info: pulled {len(items)} posts from '{list_type}'")
    return items


def _get_last_max_created_utc(path="data/reddit_latest.json") -> int:
    """既存の reddit_latest.json から最新の created_utc を取得する（ギャップ補完用）"""
    if not os.path.exists(path):
        return 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        posts = data.get("posts", []) if isinstance(data, dict) else data
        if not posts:
            return 0
        return max(int(p.get("created_utc") or 0) for p in posts)
    except Exception:
        return 0


def pull_via_arctic_shift(min_posts=MIN_FALLBACK_POSTS, max_pages=MAX_FALLBACK_PAGES):
    """PRAW が利用できない・403等で失敗した場合に Arctic Shift API から最新の投稿一覧を取得する"""
    last_max_utc = _get_last_max_created_utc()
    now_utc = int(datetime.now(timezone.utc).timestamp())
    # 既存データが直近14日以内の場合は、その時刻に追いつくまで遡って取得する
    target_utc = last_max_utc if (last_max_utc > 0 and (now_utc - last_max_utc) <= 14 * 86400) else 0

    if target_utc:
        print(f"info: fetching from Arctic Shift API (min {min_posts} posts, or back to created_utc={target_utc})")
    else:
        print(f"info: fetching from Arctic Shift API (target {min_posts} posts)")

    items = []
    seen_ids = set()
    before_utc = None
    headers = {"User-Agent": USER_AGENT}

    for page in range(1, max_pages + 1):
        params = {
            "subreddit": SUB,
            "limit": 100,
            "sort": "desc",
        }
        if before_utc is not None:
            params["before"] = before_utc

        batch = []
        for retry in range(3):
            try:
                resp = requests.get(ARCTIC_SHIFT_SEARCH_URL, params=params, headers=headers, timeout=20)
                if resp.status_code in (422, 429, 500, 502, 503, 504) and retry < 2:
                    time.sleep(2 * (retry + 1))
                    continue
                resp.raise_for_status()
                payload = resp.json()
                batch = payload.get("data") or []
                break
            except Exception as e:
                if retry < 2:
                    time.sleep(2 * (retry + 1))
                    continue
                print(f"warn: Arctic Shift API request failed on page {page}: {e}")
                batch = []

        if not batch:
            break

        oldest_in_batch = None
        added_in_batch = 0
        for post in batch:
            created_utc = int(post.get("created_utc") or 0)
            if oldest_in_batch is None or created_utc < oldest_in_batch:
                oldest_in_batch = created_utc

            pid = post.get("id")
            if not pid or pid in seen_ids:
                continue
            seen_ids.add(pid)
            added_in_batch += 1

            permalink = post.get("permalink") or f"/r/{SUB}/comments/{pid}/"
            url = post.get("url") or f"https://www.reddit.com{permalink}"

            items.append({
                "id": pid,
                "title": post.get("title") or "",
                "score": int(post.get("score") or 0),
                "num_comments": int(post.get("num_comments") or 0),
                "created_utc": created_utc,
                "author": post.get("author"),
                "permalink": permalink,
                "url": url,
                "is_self": bool(post.get("is_self", True)),
                "flair": post.get("link_flair_text"),
            })

        # 十分な件数を取得し、かつ前回スナップショットの最新時刻まで遡れたら終了
        if len(items) >= min_posts:
            if not target_utc or (oldest_in_batch is not None and oldest_in_batch <= target_utc):
                break

        if oldest_in_batch is None or added_in_batch == 0:
            break
        before_utc = oldest_in_batch
        time.sleep(0.5)

    print(f"info: pulled {len(items)} posts via Arctic Shift API")
    return items


def merge_unique(list_of_lists):
    seen = {}
    merged = []
    for lst in list_of_lists:
        for item in lst:
            if item["id"] not in seen:
                seen[item["id"]] = True
                merged.append(item)
    return merged


def main():
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%dT%H%M%SZ")
    # 取得：まず PRAW で hot / new / top を試み、取得できなければ Arctic Shift API にフォールバック
    hot = pull_listing("hot")
    new = pull_listing("new")
    top_day = pull_listing("top")
    merged = merge_unique([hot, new, top_day])

    if not merged:
        fallback_items = pull_via_arctic_shift()
        new = fallback_items
        merged = merge_unique([fallback_items])

    if not merged:
        raise SystemExit("Error: failed to fetch any posts from both Reddit API (PRAW) and fallback API.")

    out = {
        "snapshot_at": date_str,
        "source_subreddit": SUB,
        "counts": {
            "hot_count": len(hot),
            "new_count": len(new),
            "top_count": len(top_day),
            "merged_count": len(merged),
        },
        "posts": merged
    }

    os.makedirs("data", exist_ok=True)

    # reddit_latest.json を上書き（Pages 側で常に最新を参照する用）
    with open("data/reddit_latest.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Updated data/reddit_latest.json (total {len(merged)} posts).")


if __name__ == "__main__":
    main()
