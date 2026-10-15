/** Exact JSON UTF-8 bytes for immutable reducer state. Unchanged array elements
 * reuse their prior size; no transition is skipped. The trace independently
 * compares against JSON.stringify at every issue and at its recorded peak. */
export function createMeter() {
  const cache = new WeakMap<object, number>();
  const strings = new Map<string, number>();
  const topArrays = new Map<
    string,
    { value: readonly unknown[]; bytes: number }
  >();
  const str = (value: string) => {
    let bytes = strings.get(value);
    if (bytes === undefined) {
      bytes = Buffer.byteLength(JSON.stringify(value));
      if (strings.size < 8192) strings.set(value, bytes);
    }
    return bytes;
  };
  function size(value: unknown): number {
    if (value === null || value === undefined) return 4;
    if (typeof value === "string") return str(value);
    if (typeof value === "number" || typeof value === "boolean")
      return Buffer.byteLength(JSON.stringify(value));
    if (typeof value !== "object")
      throw new Error("Unsupported capacity JSON value");
    const cached = cache.get(value);
    if (cached !== undefined) return cached;
    let bytes = 2,
      first = true;
    if (Array.isArray(value))
      for (const entry of value) {
        if (!first) bytes++;
        first = false;
        bytes += size(entry);
      }
    else
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue;
        if (!first) bytes++;
        first = false;
        bytes += str(key) + 1 + size(entry);
      }
    cache.set(value, bytes);
    return bytes;
  }
  function arraySize(key: string, value: readonly unknown[]) {
    const cached = cache.get(value);
    if (cached !== undefined) return cached;
    const prior = topArrays.get(key);
    if (!prior) {
      const bytes = size(value);
      topArrays.set(key, { value, bytes });
      return bytes;
    }
    let bytes =
      prior.bytes +
      Math.max(0, value.length - 1) -
      Math.max(0, prior.value.length - 1);
    for (let i = 0; i < Math.max(value.length, prior.value.length); i++) {
      if (i >= prior.value.length) bytes += size(value[i]);
      else if (i >= value.length) bytes -= size(prior.value[i]);
      else if (value[i] !== prior.value[i])
        bytes += size(value[i]) - size(prior.value[i]);
    }
    cache.set(value, bytes);
    topArrays.set(key, { value, bytes });
    return bytes;
  }
  return (state: object): number => {
    const cached = cache.get(state);
    if (cached !== undefined) return cached;
    let bytes = 2,
      first = true;
    for (const [key, value] of Object.entries(state)) {
      if (value === undefined) continue;
      if (!first) bytes++;
      first = false;
      bytes +=
        str(key) +
        1 +
        (Array.isArray(value) ? arraySize(key, value) : size(value));
    }
    cache.set(state, bytes);
    return bytes;
  };
}
