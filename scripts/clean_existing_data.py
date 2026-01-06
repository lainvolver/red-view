import json
import os
import glob
import shutil

# 管理用スクリプト: 既存のRedditアーカイブデータをクリーンアップし、無効なエントリを削除する

def clean_season_file(filepath: str) -> dict:
    """
    Cleans a single season JSON file by removing entries that are not valid episode discussion threads.
    Returns a summary of the cleaning process.
    """
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"error": f"Could not read or parse {filepath}"}

    cleaned_count = 0
    anime_to_remove = []

    if not isinstance(data.get("anime"), dict):
        return {"info": f"No 'anime' dictionary in {filepath}, skipping."}

    for anime_id, anime_data in data["anime"].items():
        if not isinstance(anime_data.get("episodes"), dict):
            continue

        episodes_to_remove = []
        
        # 1. Remove the entire '_unknown' bucket if it exists
        if "_unknown" in anime_data["episodes"]:
            cleaned_count += len(anime_data["episodes"]["_unknown"])
            del anime_data["episodes"]["_unknown"]

        # 2. Check other episode buckets for titles without "discussion"
        for ep_key, posts in anime_data["episodes"].items():
            original_post_count = len(posts)
            
            # Keep only posts that contain "discussion"
            posts_to_keep = [
                post for post in posts 
                if "discussion" in post.get("reddit_title", "").lower()
            ]
            
            # If the list has changed, update it
            if len(posts_to_keep) < original_post_count:
                anime_data["episodes"][ep_key] = posts_to_keep
                cleaned_count += (original_post_count - len(posts_to_keep))
            
            # If an episode bucket becomes empty, mark it for removal
            if not posts_to_keep:
                episodes_to_remove.append(ep_key)
        
        # Remove empty episode buckets
        for ep_key in episodes_to_remove:
            del anime_data["episodes"][ep_key]
            
        # If an anime has no episodes left, mark it for removal
        if not anime_data["episodes"]:
            anime_to_remove.append(anime_id)

    # Remove anime with no episodes
    for anime_id in anime_to_remove:
        del data["anime"][anime_id]

    # Save the cleaned data back to the file
    if cleaned_count > 0 or anime_to_remove:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    return {"cleaned_posts": cleaned_count, "removed_anime": len(anime_to_remove)}

def main():
    """
    Main function to find and clean all season JSON files.
    """
    search_path = os.path.join("data", "reddit", "*.json")
    season_files = glob.glob(search_path)
    
    total_cleaned_posts = 0
    total_removed_anime = 0
    
    print(f"Found {len(season_files)} season files to clean in data/reddit/...")

    for filepath in season_files:
        if os.path.basename(filepath) == 'seasons.json': # Don't process seasons.json
            continue
        print(f"Cleaning {filepath}...")
        summary = clean_season_file(filepath)
        if "error" in summary:
            print(f"  Error: {summary['error']}")
        elif "info" in summary:
            print(f"  Info: {summary['info']}")
        else:
            total_cleaned_posts += summary["cleaned_posts"]
            total_removed_anime += summary["removed_anime"]
            print(f"  - Removed {summary['cleaned_posts']} posts.")
            print(f"  - Emptied and removed {summary['removed_anime']} anime entries.")
            
    print("\nCleaning complete.")
    print(f"Total posts removed: {total_cleaned_posts}")
    print(f"Total anime entries removed: {total_removed_anime}")

    # Copy the cleaned data to the astro public directory
    print("\nCopying cleaned data to astro/public/data/reddit...")
    try:
        shutil.copytree(
            "./data/reddit",
            "./astro/public/data/reddit",
            dirs_exist_ok=True
        )
        print("Copy successful.")
    except Exception as e:
        print(f"Error during copy: {e}")

if __name__ == "__main__":
    main()
