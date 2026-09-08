import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

type Asset = { bytes: Buffer; type: string };
const types: Record<string, string> = {
  "background.mp4": "video/mp4",
  "background.webp": "image/webp",
  "latin.woff2": "font/woff2",
  "latin-ext.woff2": "font/woff2",
};

export function loadAssets(directory: string): Map<string, Asset> {
  const manifest = JSON.parse(
    readFileSync(join(directory, "ui-assets.json"), "utf8"),
  ) as Record<string, { bytes: number; sha256: string }>;
  const assets = new Map<string, Asset>();
  for (const [path, info] of Object.entries(manifest)) {
    const match = path.match(
      /^ui-assets\/([a-f0-9]{64})\/(background\.mp4|background\.webp|latin(?:-ext)?\.woff2)$/,
    );
    if (!match || match[1] !== info.sha256)
      throw new Error("Invalid packaged asset manifest");
    const bytes = readFileSync(join(directory, path));
    if (
      bytes.length !== info.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== info.sha256
    )
      throw new Error("Packaged asset checksum mismatch");
    assets.set("/" + path, { bytes, type: types[match[2]] });
  }
  const packaged = readdirSync(join(directory, "ui-assets"), {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile());
  if (
    assets.size !== 4 ||
    packaged.length !== 4 ||
    new Set([...assets.keys()].map((path) => path.split("/").at(-1))).size !== 4
  )
    throw new Error("Incomplete packaged assets");
  return assets;
}

// Exact manifest lookup: request paths are never decoded or joined to the filesystem.
export function serveAsset(
  request: IncomingMessage,
  response: ServerResponse,
  assets: Map<string, Asset>,
) {
  const asset = assets.get(request.url ?? "");
  if (!asset) return false;
  const headers: Record<string, string | number> = {
    "Content-Type": asset.type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "bytes",
    "Content-Length": asset.bytes.length,
  };
  if (!["GET", "HEAD"].includes(request.method ?? "")) {
    response.writeHead(405, {
      Allow: "GET, HEAD",
      "X-Content-Type-Options": "nosniff",
    });
    response.end();
    return true;
  }
  let start = 0,
    end = asset.bytes.length - 1,
    status = 200;
  if (request.headers.range) {
    const match = request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, asset.bytes.length - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
    }
    if (
      !match ||
      (!match[1] && !match[2]) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= asset.bytes.length
    ) {
      response.writeHead(416, {
        ...headers,
        "Content-Range": `bytes */${asset.bytes.length}`,
        "Content-Length": 0,
      });
      response.end();
      return true;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${asset.bytes.length}`;
    headers["Content-Length"] = end - start + 1;
  }
  response.writeHead(status, headers);
  response.end(
    request.method === "HEAD"
      ? undefined
      : asset.bytes.subarray(start, end + 1),
  );
  return true;
}
