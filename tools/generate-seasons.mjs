import fs from "fs";
import path from "path";

const SRC_DIR = "data/reddit";
const OUT_FILE = "astro/public/data/reddit/seasons.json";

const seasonLabel = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  fall: "秋",
};

const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith(".json"));

const seasons = files.map(file => {
  const key = file.replace(".json", ""); // 2025_4_fall
  const [year, , seasonRaw] = key.split("_");

  return {
    key,
    year: Number(year),
    season: seasonRaw.toUpperCase(),
    label: `${year}年 ${seasonLabel[seasonRaw] ?? seasonRaw}`,
  };
}).sort((a, b) => {
  if (a.year !== b.year) return b.year - a.year;
  return a.season.localeCompare(b.season);
});

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(seasons, null, 2));

console.log("seasons.json generated");
