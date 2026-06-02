import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/** Wordmark paths start around x=564; keep only the K mark for favicon / collapsed sidebar. */
const ICON_MAX_X = 563;

function extractIconPaths(svg) {
  const paths = [...svg.matchAll(/<path\b[^>]*\/>/g)].map((m) => m[0]);
  return paths.filter((p) => {
    const t = p.match(/transform="translate\(([-\d.]+)/);
    if (!t) return true;
    return Number(t[1]) <= ICON_MAX_X;
  });
}

function buildIconSvg(paths) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 526 526" width="526" height="526" preserveAspectRatio="xMidYMid meet">\n' +
    paths.join("\n") +
    "\n</svg>\n"
  );
}

function processPair(name) {
  const src = path.join(root, "src", "assets", `${name}.svg`);
  const iconName = `${name}_icon`;
  const outAssets = path.join(root, "src", "assets", `${iconName}.svg`);
  const outPublic = path.join(root, "public", `${iconName}.svg`);

  const svg = fs.readFileSync(src, "utf8");
  const paths = extractIconPaths(svg);
  if (paths.length < 5) {
    console.error(`${name}: expected icon paths, got ${paths.length}`);
    process.exit(1);
  }
  const iconSvg = buildIconSvg(paths);
  fs.writeFileSync(outAssets, iconSvg);
  fs.writeFileSync(outPublic, iconSvg);
  console.log(`${iconName}: ${paths.length} paths`);
}

processPair("white_logo");
processPair("black_logo");
