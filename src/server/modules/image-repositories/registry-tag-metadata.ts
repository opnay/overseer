export interface RemoteRepositoryTag {
  digest?: string;
  name: string;
  lastUpdated?: string;
  platforms?: string[];
}

export function imagePlatforms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item: unknown) => {
        if (!item || typeof item !== "object") return [];
        const { os, architecture, variant } = item as Record<string, unknown>;
        const part = (value: unknown): value is string =>
          typeof value === "string" && /^[a-z0-9._-]{1,64}$/i.test(value) && value !== "unknown";
        if (!part(os) || !part(architecture)) return [];
        return [`${os}/${architecture}${part(variant) ? `/${variant}` : ""}`];
      }),
    ),
  ].sort();
}

export function manifestDigest(value: unknown): string | undefined {
  return typeof value === "string" && /^(sha256:[a-f0-9]{64}|sha512:[a-f0-9]{128})$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

export function mayMatchManifestDigest(query: string): boolean {
  const value = query.toLowerCase();
  if (/^[a-f0-9]+$/.test(value)) return value.length <= 128;

  return ["sha256:", "sha512:"].some((prefix) => {
    if (prefix.includes(value)) return true;
    for (let start = 0; start < prefix.length; start += 1) {
      const suffix = prefix.slice(start);
      if (!value.startsWith(suffix)) continue;
      const hash = value.slice(suffix.length);
      if (/^[a-f0-9]*$/.test(hash) && hash.length <= (prefix === "sha256:" ? 64 : 128)) return true;
    }
    return false;
  });
}
