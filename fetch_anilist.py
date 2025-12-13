try:
  import requests
except ImportError as e:
  raise RuntimeError(
    "Missing dependency 'requests'. Install dependencies with:\n"
    "python -m pip install -r requirements.txt"
  ) from e
import json
import os


def get_current_season_anime(save_path: str | None = "data/anilist.json"):
    query = """
    query {
      Page(perPage: 100) {
        media(season: FALL, seasonYear: 2025, type: ANIME, format_not_in: [MUSIC, SPECIAL]) {
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
    url = "https://graphql.anilist.co"
    resp = requests.post(url, json={'query': query})
    resp.raise_for_status()
    data = resp.json()
    titles = []
    for m in data["data"]["Page"]["media"]:
      titles.append({
        "id": m["id"],
        "romaji": m["title"]["romaji"],
        "english": m["title"]["english"],
        "native": m["title"]["native"]
      })

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