import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

export const assetOrigin = "https://codesk-assets.invalid";
export const assetSources = [
  "background.mp4",
  "background.webp",
  "fonts/outfit/latin.woff2",
  "fonts/outfit/latin-ext.woff2",
];
export function designAssets(root) {
  return assetSources.map((source) => {
    const file = resolve(root, "src/assets/design", source),
      bytes = readFileSync(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `ui-assets/${sha256}/${basename(source)}`;
    return { source, file, bytes, sha256, path };
  });
}
export function uiAssets(root) {
  let building = false;
  const entries = designAssets(root);
  return {
    name: "codesk-packaged-assets",
    enforce: "pre",
    configResolved(config) {
      building = config.command === "build";
    },
    resolveId(source, importer) {
      if (!building || !source.endsWith("?no-inline") || !importer) return;
      const file = resolve(
        importer.split("/").slice(0, -1).join("/"),
        source.slice(0, -10),
      );
      const entry = entries.find((entry) => entry.file === file);
      if (entry) return `\0codesk-asset:${entry.path}`;
    },
    load(id) {
      if (id.startsWith("\0codesk-asset:"))
        return `export default ${JSON.stringify(assetOrigin + "/" + id.slice(14))}`;
    },
    transform(code, id) {
      if (!building || !id.endsWith("/src/index.css")) return;
      code = code.replace(
        "@import './styles/global.css';",
        readFileSync(resolve(root, "src/styles/global.css"), "utf8"),
      );
      for (const entry of entries)
        code = code.replaceAll(
          `../assets/design/${entry.source}?no-inline`,
          `${assetOrigin}/${entry.path}`,
        );
      return code;
    },
    generateBundle() {
      for (const entry of entries)
        this.emitFile({
          type: "asset",
          fileName: entry.path,
          source: entry.bytes,
        });
    },
  };
}
