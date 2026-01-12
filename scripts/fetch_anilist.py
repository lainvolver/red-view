try:
  import requests
except ImportError as e:
  raise RuntimeError(
    "Missing dependency 'requests'. Install dependencies with:\n"
    "python -m pip install -r requirements.txt"
  ) from e
import json
import os
from datetime import date

def _month_to_season(m: int) -> str:
  if 1 <= m <= 3:
    return "WINTER"
  if 4 <= m <= 6:
    return "SPRING"
  if 7 <= m <= 9:
    return "SUMMER"
  return "FALL"

def _prev_season(season: str, year: int) -> tuple[int, str]:
  order = ["WINTER", "SPRING", "SUMMER", "FALL"]
  idx = order.index(season)
  if idx == 0:
    return (year - 1, order[-1])
  return (year, order[idx - 1])

def _enum_token(s: str) -> str:
  t = s.strip()
  if t.startswith('"') and t.endswith('"'):
    t = t[1:-1]
  return t.upper()

def _format_list_token(formats: list[str]) -> str:
  tokens = []
  for f in formats:
    tokens.append(_enum_token(f))
  return "[" + ",".join(tokens) + "]"

def get_current_season_anime(save_path: str | None = "data/anilist.json",
                             format_filters: list[str] | None = None):
    """Fetch AniList media for the current season and the previous season.

    - Determines today's season/year (e.g. 2025, FALL) and also the previous season.
    - Fetches media matching format_in: [TV, TV_SHORT, ONA] by default.
    - Keeps pagination and file saving behavior as before.
    """
    if format_filters is None:
      # Accept user-friendly names; map to enum tokens via _enum_token
      format_filters = ["TV", "TV_SHORT", "ONA"]

    url = "https://graphql.anilist.co"

    today = date.today()
    season = _month_to_season(today.month)
    year = today.year
    seasons = [(year, season)]
    prev = _prev_season(season, year)
    seasons.append(prev)

    format_list = [_enum_token(f) for f in format_filters]

    titles = []
    seen_ids = set()

    query = """
    query ($page:Int, $perPage:Int, $season: MediaSeason, $seasonYear: Int, $format_in: [MediaFormat]) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, format_in: $format_in, season: $season, seasonYear: $seasonYear) {
          id
          title {
            romaji
            english
            native
          }
        }
      }
    }
    """

    for sy, ss in seasons:
      page = 1
      per_page = 50

      while True:
        variables = {
          "page": page,
          "perPage": per_page,
          "season": ss,
          "seasonYear": sy,
          "format_in": format_list,
        }

        # Debug: print the query and variables for the first page of each season
        if page == 1:
          print(f"--- GraphQL query for season {ss} {sy} ---")
          print(query)
          print("--- variables ---")
          print(variables)

        resp = requests.post(url, json={"query": query, "variables": variables})
        try:
          resp.raise_for_status()
        except Exception:
          content = None
          try:
            content = resp.json()
          except Exception:
            content = resp.text
          raise RuntimeError(f"AniList request failed: status={resp.status_code} body={content}")
        data = resp.json()

        media = data.get("data", {}).get("Page", {}).get("media", [])
        if not media:
          break

        for m in media:
          mid = m["id"]
          if mid in seen_ids:
            continue
          seen_ids.add(mid)
          titles.append({
            "id": mid,
            "romaji": m["title"]["romaji"],
            "english": m["title"]["english"],
            "native": m["title"]["native"],
            "seasonYear": sy,
            "season": ss,
          })

        if len(media) < per_page:
          break

        page += 1

    # Save fetched titles to local file for offline/testing use (same behavior as before)
    if save_path:
      dirpath = os.path.dirname(save_path)
      if dirpath:
        os.makedirs(dirpath, exist_ok=True)
      with open(save_path, "w", encoding="utf-8") as f:
        json.dump(titles, f, ensure_ascii=False, indent=2)

    return titles

if __name__ == "__main__":
    titles = get_current_season_anime()
    print(f"{len(titles)} titles found and saved to data/anilist.json.")
    for t in titles[:5]:
        print(t)