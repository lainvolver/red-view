# fetch_r_anime.py
import os
import time
import json
from datetime import datetime, timezone
import praw

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

SUB = "anime"
MAX_PER_LIST = 800  # hot/new で取る数。1000がAPI上の深さ制限に近いので余裕を持たせる

def pull_listing(list_type="hot", limit=MAX_PER_LIST):
    """hot or new listing を取得して dict のリストで返す"""
    subreddit = reddit.subreddit(SUB)
    if list_type == "hot":
        gen = subreddit.hot(limit=limit)
    elif list_type == "new":
        gen = subreddit.new(limit=limit)
    elif list_type == "top":
        gen = subreddit.top(time_filter="day", limit=limit)
    else:
        raise ValueError("unknown list_type")
    items = []
    for post in gen:
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
            # 取得で稀にエラー出ることがあるので無理せずスキップ
            print("warn: skipping post due to", e)
        time.sleep(1)  # API負荷を下げるためにわずかに待つ
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
    # 取得：hot と new を両方取ってユニーク化
    hot = pull_listing("hot")
    new = pull_listing("new")
    top_day = pull_listing("top")
    merged = merge_unique([hot, new, top_day])

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
