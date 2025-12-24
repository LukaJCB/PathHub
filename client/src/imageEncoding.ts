export function encodeBlobWithMime(imageBuffer: ArrayBuffer, mimeType: string): Uint8Array {
  const mimeBytes = new TextEncoder().encode(mimeType);

  if (mimeBytes.length > 0xffff) {
    throw new Error("MIME type too long");
  }

  const payload = new Uint8Array(
    2 + mimeBytes.length + imageBuffer.byteLength
  );

  const view = new DataView(payload.buffer);
  view.setUint16(0, mimeBytes.length, false);

  payload.set(mimeBytes, 2);
  payload.set(new Uint8Array(imageBuffer), 2 + mimeBytes.length);

  return payload;
}

export function decodeBlobWithMime(
  payload: Uint8Array
): { mimeType: string; bytes: Uint8Array } {
  if (payload.byteLength < 2) {
    throw new Error("Invalid payload");
  }

  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength
  );

  const mimeLength = view.getUint16(0, false);

  if (payload.byteLength < 2 + mimeLength) {
    throw new Error("Invalid MIME length");
  }

  const mimeBytes = payload.subarray(2, 2 + mimeLength);
  const mimeType = new TextDecoder().decode(mimeBytes);

  const bytes = payload.subarray(2 + mimeLength);

  return { mimeType, bytes };
}
