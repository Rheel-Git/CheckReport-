// Cloudflare Workers currently rejects PBKDF2 requests above 100,000 iterations.
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;
const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function randomToken(cryptoProvider = globalThis.crypto) {
  return base64Url(cryptoProvider.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token, cryptoProvider = globalThis.crypto) {
  const digest = await cryptoProvider.subtle.digest("SHA-256", encoder.encode(token));
  return base64Url(new Uint8Array(digest));
}

async function derivePassword(password, salt, iterations, cryptoProvider) {
  const key = await cryptoProvider.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await cryptoProvider.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password, cryptoProvider = globalThis.crypto) {
  if (typeof password !== "string" || [...password].length < 15 || encoder.encode(password).length > 256) {
    throw new TypeError("password_out_of_range");
  }

  const salt = cryptoProvider.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS, cryptoProvider);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${base64Url(salt)}$${base64Url(hash)}`;
}

export async function verifyPassword(password, encoded, cryptoProvider = globalThis.crypto) {
  if (typeof password !== "string" || encoder.encode(password).length > 256 || typeof encoded !== "string") return false;
  const [algorithm, iterationText, saltText, hashText, extra] = encoded.split("$");
  const iterations = Number.parseInt(iterationText, 10);
  if (algorithm !== "pbkdf2-sha256" || extra !== undefined || !Number.isInteger(iterations) || iterations < PASSWORD_ITERATIONS || iterations > 1_000_000) return false;

  try {
    const expected = fromBase64Url(hashText);
    const actual = await derivePassword(password, fromBase64Url(saltText), iterations, cryptoProvider);
    if (expected.length !== actual.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
    return difference === 0;
  } catch {
    return false;
  }
}

export const passwordHashParameters = Object.freeze({
  algorithm: "PBKDF2-HMAC-SHA256",
  iterations: PASSWORD_ITERATIONS,
  saltBytes: PASSWORD_SALT_BYTES,
  hashBytes: PASSWORD_HASH_BYTES,
});
