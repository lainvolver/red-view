# fetch_r_anime.py
import os
import time
import json
from datetime import datetime, timezone
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


reddit = create_reddit_client(read_only=True)

SUB = "anime"
MAX_PER_LIST = 800  # hot/new で取る数。1000がAPI上の深さ制限に近いので余裕を持たせる


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
    """hot / new / top listing を取得して dict のリストで返す"""
    global reddit
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

        except (prawcore.exceptions.Forbidden, prawcore.exceptions.ResponseException, prawcore.exceptions.OAuthException) as e:
            status = getattr(getattr(e, "response", None), "status_code", "unknown")
            body = getattr(getattr(e, "response", None), "text", "")
            print(f"warn: Reddit API error on '{list_type}' (mode={'read-only' if use_read_only else 'user-auth'}, status={status}): {e}")
            if body:
                print(f"warn: response body preview: {body[:300]}")
            # 既に一部取得できている場合はそのまま活かし、0件なら次の認証モードでリトライ
            if items:
                print(f"info: keeping {len(items)} posts collected before error on '{list_type}'")
                break
            time.sleep(5)
        except Exception as e:
            print(f"warn: unexpected error while pulling '{list_type}': {e}")
            if items:
                break
            time.sleep(5)

    print(f"info: pulled {len(items)} posts from '{list_type}'")
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
    # 取得：hot と new と top を取ってユニーク化
    hot = pull_listing("hot")
    new = pull_listing("new")
    top_day = pull_listing("top")
    merged = merge_unique([hot, new, top_day])

    if not merged:
        # 全リストが0件だった場合、既存の data/reddit_latest.json があれば空データで上書きしない
        if os.path.exists("data/reddit_latest.json"):
            print("warn: no posts fetched from Reddit API; keeping existing data/reddit_latest.json to prevent data loss.")
            return
        raise SystemExit("Error: failed to fetch any posts from Reddit API and no existing data/reddit_latest.json found.")

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
    # Test mode: skip writing full dated snapshot to avoid creating many files in tests
    # filename = f"data/r_anime_snapshot_{now.strftime('%Y%m%d')}.json"
    # with open(filename, "w", encoding="utf-8") as f:
    #     json.dump(out, f, ensure_ascii=False, indent=2)

    # reddit_latest.json を上書き（Pages 側で常に最新を参照する用）
    with open("data/reddit_latest.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Updated data/reddit_latest.json (total {len(merged)} posts). Snapshot file creation skipped in test mode.")


if __name__ == "__main__":
    main()
