import type { ImageSummary } from "@contracts/contracts.ts";

export function imageDisplayReference(image: ImageSummary): string {
  return image.tag === "<none>" ? image.repository : `${image.repository}:${image.tag}`;
}
