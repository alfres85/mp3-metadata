import type { ACRCloudMetadata } from './acrcloud.js';

const UNKNOWN_VALUES = new Set(['unknown artist', 'unknown title', 'unknown']);

export function hasUsefulMetadataValue(value: string | undefined): value is string {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && !UNKNOWN_VALUES.has(normalized));
}

export function isUsableMetadata(metadata: ACRCloudMetadata): boolean {
  return hasUsefulMetadataValue(metadata.artist) && hasUsefulMetadataValue(metadata.title);
}
