try:
  import requests
except ImportError as e:
  raise RuntimeError(
    "Missing dependency 'requests'. Install dependencies with:\n"
    "python -m pip install -r requirements.txt"
  ) from e
import json
import os


def get_current_season_anime(save_path: str | None = "data/anilist.json",
                             format_filter: str = "TV",
                             status_filter: str = "RELEASING"):
    """Fetch AniList media matching `format_filter` and `status_filter`.

    Uses pagination to collect all pages (perPage=50). Saves results
    to `save_path` if provided and returns the list of title dicts.
    """
    url = "https://graphql.anilist.co"

    # Build query with enums inserted directly to avoid GraphQL enum/variable typing issues
    # Ensure enum tokens are unquoted and uppercase (GraphQL enum literals)
    def _enum_token(s: str) -> str:
      t = s.strip()
      if t.startswith('"') and t.endswith('"'):
        t = t[1:-1]
      return t.upper()

    format_token = _enum_token(format_filter)
    status_token = _enum_token(status_filter)
    # AniList MediaStatus uses 'RELEASING' for currently airing titles.
    if status_token == "AIRING":
      status_token = "RELEASING"
    media_filter = f"media(type: ANIME, format: {format_token}, status: {status_token})"
    query = f"""
    query ($page:Int,$perPage:Int) {{
      Page(page: $page, perPage: $perPage) {{
        {media_filter} {{
          id
          title {{
            romaji
            english
            native
          }}
        }}
      }}
    }}
    """

    titles = []
    page = 1
    per_page = 50

    while True:
        variables = {
          "page": page,
          "perPage": per_page,
        }

        # Debug: print the query and variables for the first page to diagnose enum issues
        if page == 1:
          print("--- GraphQL query being sent ---")
          print(query)
          print("--- variables ---")
          print(variables)

        resp = requests.post(url, json={"query": query, "variables": variables})
        try:
          resp.raise_for_status()
        except Exception:
          # Provide response body to help diagnose API/GraphQL errors
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
            titles.append({
                "id": m["id"],
                "romaji": m["title"]["romaji"],
                "english": m["title"]["english"],
                "native": m["title"]["native"],
            })

        # Stop if fewer than per_page returned (last page)
        if len(media) < per_page:
            break

        page += 1

    # Save fetched titles to local file for offline/testing use
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