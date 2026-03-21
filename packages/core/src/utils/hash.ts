const textEncoder = new TextEncoder();

function toUint8Array(input: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof input === "string") {
    return textEncoder.encode(input);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  return new Uint8Array(input);
}

export async function sha256(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toUint8Array(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
