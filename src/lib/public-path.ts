/** Site prefix for files in `public/`. Empty locally, `/ocr` on GitHub Pages. */
export function publicPath(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
