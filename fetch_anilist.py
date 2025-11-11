import requests

def get_current_season_anime():
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
    return titles

if __name__ == "__main__":
    titles = get_current_season_anime()
    print(f"{len(titles)} titles found.")
    for t in titles[:5]:
        print(t)