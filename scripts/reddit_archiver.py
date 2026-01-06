import json
import os
import re
import shutil
from datetime import datetime
from typing import Optional

SEASON_ORDER = {"WINTER": 1, "SPRING": 2, "SUMMER": 3, "FALL": 4}

EP_PATTERNS = [
    re.compile(r"第\s*(\d{1,3})\s*話"),
    re.compile(r"\bep(?:isode)?\.?\s*(\d{1,3})\b", re.I),
    re.compile(r"\bE(\d{1,3})\b", re.I),
    re.compile(r"\bS\d+E(\d{1,3})\b", re.I),
    re.compile(r"\b(\d{1,3})\s*話\b"),
    re.compile(r"\b(\d{1,3})\s*話目\b"),
    re.compile(r"\bepisode\s+(\d{1,3})\b", re.I),
]

def _extract_episode(title: str) -> Optional[int]:
    for p in EP_PATTERNS:
        m = p.search(title or "")
        if m:
            try:
                return int(m.group(1))
            except Exception:
                continue
    return None

def _load_json(path: str):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def _save_json(path: str, data):
    dirp = os.path.dirname(path)
    if dirp:
        os.makedirs(dirp, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _japanese_title_from_anilist(anime: dict) -> str:
    # try common shapes used in this project
    if not anime:
        return ""
    if "native" in anime and anime.get("native"):
        return anime.get("native")
    if "title" in anime and isinstance(anime["title"], dict):
        return anime["title"].get("native") or anime["title"].get("romaji") or anime["title"].get("english") or ""
    # fallback to romaji/english top-level keys
    return anime.get("romaji") or anime.get("english") or ""

def archive_reddit_latest(
    matched_path: str = "data/matched_results.json",
    anilist_path: str = "data/anilist.json",
    out_dir: str = "data/reddit",
):
    """
    Read matched_results_latest-Episode.json (produced by match_titles.py),
    and append per-anime episode/post records into season files:
      data/reddit/YYYY_{idx}_{season}.json

    Output file structure (example):
    {
      "metadata": {"year": 2025, "season": "SUMMER"},
      "anime": {
        "<anilist_id>": {
          "id": 123,
          "name_jp": "日本語タイトル",
          "seasonYear": 2025,
          "season": "SUMMER",
          "episodes": {
            "3": [
              { "reddit_id": "...", "reddit_title": "...", "created_utc": ..., "num_comments": 5, "url": "...", "archived_at": ... },
              ...
            ],
            "_unknown": [ ... ]
          },
          "latest_episode": 3
        },
        ...
      }
    }
    """
    matched = _load_json(matched_path)
    if matched is None:
        raise FileNotFoundError(f"{matched_path} not found")

    anilist = _load_json(anilist_path) or []
    anilist_map = {int(a.get("id")): a for a in anilist if a.get("id") is not None}

    if isinstance(matched, dict) and "data" in matched:
        items = matched["data"]
    elif isinstance(matched, list):
        items = matched
    else:
        items = [matched]

    summary = {"processed": 0, "archived": 0, "skipped_no_match": 0, "skipped_invalid": 0}
    for entry in items:
        summary["processed"] += 1

        reddit_title = entry.get("reddit_title") or entry.get("title") or ""
        matched_id = entry.get("matched_anime_id") or entry.get("matched_anime") or entry.get("matched_id")
        if matched_id is None:
            summary["skipped_no_match"] += 1
            continue

        try:
            mid = int(matched_id)
        except Exception:
            summary["skipped_invalid"] += 1
            continue

        anime = anilist_map.get(mid)
        # season/year prefer matched entry, fallback to anilist
        season = entry.get("season") or (anime.get("season") if anime else None)
        sy = entry.get("seasonYear") or (anime.get("seasonYear") if anime else None)
        if not season or not sy:
            summary["skipped_no_match"] += 1
            continue

        ep = entry.get("episode")
        if ep is None:
            ep = _extract_episode(reddit_title)

        # Skip if not a discussion thread or no episode number found
        if "discussion" not in reddit_title.lower() or ep is None:
            summary["skipped_invalid"] += 1
            continue

        year = int(sy)
        idx = SEASON_ORDER.get(season.upper(), None)
        if idx is None:
            summary["skipped_invalid"] += 1
            continue

        fname = f"{year}_{idx}_{season.lower()}.json"
        fpath = os.path.join(out_dir, fname)

        existing = _load_json(fpath)
        if existing is None or not isinstance(existing, dict):
            # initialize new structure
            existing = {
                "metadata": {"year": year, "season": season},
                "anime": {}
            }

        # ensure metadata matches (if mismatch, overwrite metadata but keep data)
        existing["metadata"] = {"year": year, "season": season}

        anime_key = str(mid)
        if anime_key not in existing["anime"]:
            existing["anime"][anime_key] = {
                "id": mid,
                "name_jp": _japanese_title_from_anilist(anime) or entry.get("matched_anime_native") or entry.get("matched_title") or "",
                "seasonYear": sy,
                "season": season,
                "episodes": {},   # map episode -> [posts]
                "latest_episode": None
            }

        anime_entry = existing["anime"][anime_key]

        # choose episode bucket
        ep_key = str(ep) if ep is not None else "_unknown"

        # prepare post record
        rid = entry.get("reddit_id") or entry.get("id") or entry.get("url") or reddit_title
        post_record = {
            "reddit_id": rid,
            "reddit_title": reddit_title,
            "created_utc": entry.get("created_utc") or entry.get("created"),
            "num_comments": entry.get("num_comments"),
            "url": entry.get("url"),
            "archived_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        # ensure list exists
        if ep_key not in anime_entry["episodes"]:
            anime_entry["episodes"][ep_key] = []

        # dedupe by reddit_id/url
        if any(p.get("reddit_id") == rid or (p.get("url") and p.get("url") == post_record.get("url")) for p in anime_entry["episodes"][ep_key]):
            # already present
            continue

        anime_entry["episodes"][ep_key].append(post_record)

        # update latest_episode numeric if applicable
        try:
            if ep is not None:
                cur = anime_entry.get("latest_episode")
                if cur is None or (isinstance(cur, int) and ep > cur):
                    anime_entry["latest_episode"] = int(ep)
        except Exception:
            pass

        _save_json(fpath, existing)
        summary["archived"] += 1

    # 最新のデータを astro/public/data/reddit にコピーする
    shutil.copytree(
        "./data/reddit",
        "./astro/public/data/reddit",
        dirs_exist_ok=True
    )

    return summary

if __name__ == "__main__":
    s = archive_reddit_latest()
    print(s)
