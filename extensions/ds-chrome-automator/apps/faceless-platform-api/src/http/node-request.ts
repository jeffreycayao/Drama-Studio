export const MAXIMUM_NODE_REQUEST_BYTES = 1_100_000;

export async function readBoundedNodeRequest(
  request: AsyncIterable<unknown>,
  maximumBytes = MAXIMUM_NODE_REQUEST_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
      throw new Error('Unsupported request body chunk');
    }
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
