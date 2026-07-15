/**
 * Add a one-off cache-busting query to a network image URL. Blob/data URLs
 * are local and must be left untouched.
 */
export function withImageRetry(src: string, token?: string | null): string {
  if (!token || src.startsWith("blob:") || src.startsWith("data:")) return src;
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}retry=${encodeURIComponent(token)}`;
}
