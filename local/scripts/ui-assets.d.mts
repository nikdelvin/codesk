import type { Plugin } from "vite";
export const assetOrigin: string;
export const assetSources: string[];
export function designAssets(
  root: string,
): Array<{
  source: string;
  file: string;
  bytes: Buffer;
  sha256: string;
  path: string;
}>;
export function uiAssets(root: string): Plugin;
