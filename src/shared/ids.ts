const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short random id, works in Node and the browser. */
export function uid(len = 10): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function line(text: string) {
  return { id: uid(), text };
}

export function lines(...texts: string[]) {
  return texts.map(line);
}
