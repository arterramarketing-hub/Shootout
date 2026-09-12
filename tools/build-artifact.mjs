/**
 * Repackage the Vite build as a single hostable page.
 *
 * Some hosts (Claude Artifacts among them) wrap the supplied markup in their
 * own document shell, so the page must not carry its own <html>, <head> or
 * <body> tags. This script lifts the body markup out of the built index.html,
 * inlines the stylesheet, and rewrites the script reference to a relative path.
 *
 * Usage: node tools/build-artifact.mjs   (run after `npm run build`)
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIST = "dist";
const OUT = "artifact";

const html = await readFile(join(DIST, "index.html"), "utf8");

const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error("could not find <body> in the built index.html");

const scriptMatch = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
if (!scriptMatch) throw new Error("could not find the module script in the built index.html");
const entry = scriptMatch[1].replace(/^\.\//, "");

const cssMatch = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
const css = cssMatch
  ? await readFile(join(DIST, cssMatch[1].replace(/^\.\//, "")), "utf8")
  : "";

// The body markup already excludes the script tag, which Vite puts in <head>.
const body = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, "").trim();

const page = `<title>Shootout</title>
<style>
${css}
</style>
${body}
<script type="module" src="${entry}"></script>
`;

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "page.html"), page, "utf8");

// Report the JavaScript chunks so the caller knows what to publish alongside.
const assets = await readdir(join(DIST, "assets"));
const scripts = assets.filter((name) => name.endsWith(".js"));
console.log(JSON.stringify({ entry, scripts, pageBytes: page.length }, null, 2));
