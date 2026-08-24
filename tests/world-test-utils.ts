/**
 * Shared helpers for world subsystem tests. Pure typed-array math so no node
 * globals (@types/node not enabled in this project's tsconfig).
 */

/** Byte-level equality of two typed arrays' backing buffers. */
export function bytesIdentical(
  a: Float32Array | Uint8Array,
  b: Float32Array | Uint8Array,
): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const vb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false;
  }
  return true;
}
