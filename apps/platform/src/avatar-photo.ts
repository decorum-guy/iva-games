import { createHash } from 'node:crypto';
import { decode, encode } from 'jpeg-js';
import { PlatformError } from './types.js';

export const MAX_AVATAR_BYTES = 128 * 1024;
export const MAX_PROFILE_BODY = 192 * 1024;

/** Only accept the small JPEG produced by the profile cropper. Re-encoding
 * strips metadata and keeps user-supplied bytes out of the image response. */
export function normalizeAvatarPhoto(value: unknown): { bytes: Buffer; version: string } {
  const invalid = (): never => { throw new PlatformError('INVALID_AVATAR_PHOTO', 'Выберите подходящее фото', 400); };
  if (typeof value !== 'string') return invalid();
  const encoded = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)?.[1];
  if (!encoded || encoded.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4) return invalid();
  const input = Buffer.from(encoded, 'base64');
  if (!input.length || input.length > MAX_AVATAR_BYTES || input.toString('base64') !== encoded) return invalid();
  try {
    const image = decode(input, { useTArray: true, tolerantDecoding: false,
      maxResolutionInMP: 0.07, maxMemoryUsageInMB: 32 });
    if (image.width !== 256 || image.height !== 256) return invalid();
    const bytes = encode({ data: image.data, width: image.width, height: image.height }, 86).data;
    if (bytes.length > MAX_AVATAR_BYTES) return invalid();
    return { bytes, version: createHash('sha256').update(bytes).digest('hex').slice(0, 24) };
  } catch { return invalid(); }
}
