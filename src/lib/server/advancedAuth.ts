import { env as privateEnv } from "$env/dynamic/private";
import { createHmac, timingSafeEqual } from "crypto";

export const webAccessCookieName = "zenfeed_web_access";
const webAccessTokenVersion = "v1";
const defaultSessionMaxAgeSeconds = 30 * 24 * 60 * 60;
const totpStepSeconds = 30;
const totpDigits = 6;
const totpWindow = 1;

function requireTotpSecret(): string {
    const secret = privateEnv.ZENFEED_WEB_TOTP_SECRET?.trim() || "";
    if (!secret) {
        throw new Error(
            "Missing required env ZENFEED_WEB_TOTP_SECRET. zenfeed-web refuses to start without a TOTP secret.",
        );
    }

    return secret;
}

function parseSessionMaxAgeSeconds(): number {
    const raw = privateEnv.ZENFEED_WEB_SESSION_MAX_AGE_SECONDS?.trim() || "";
    if (raw === "") {
        return defaultSessionMaxAgeSeconds;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(
            `Invalid ZENFEED_WEB_SESSION_MAX_AGE_SECONDS: ${raw}. Expected a positive integer number of seconds.`,
        );
    }

    return parsed;
}

function normalizeBase32Secret(input: string): string {
    const normalized = input
        .toUpperCase()
        .replace(/[\s-]+/g, "")
        .replace(/=+$/g, "");

    if (!/^[A-Z2-7]+$/.test(normalized)) {
        throw new Error(
            "Invalid ZENFEED_WEB_TOTP_SECRET. Expected a Base32 secret containing only A-Z and 2-7.",
        );
    }

    return normalized;
}

function decodeBase32(input: string): Buffer {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (const char of input) {
        const index = alphabet.indexOf(char);
        if (index === -1) {
            throw new Error(
                "Invalid ZENFEED_WEB_TOTP_SECRET. Expected a valid Base32 secret.",
            );
        }

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            bits -= 8;
            bytes.push((value >>> bits) & 0xff);
        }
    }

    if (bytes.length === 0) {
        throw new Error(
            "Invalid ZENFEED_WEB_TOTP_SECRET. Decoded secret is empty.",
        );
    }

    return Buffer.from(bytes);
}

let cachedNormalizedTotpSecret: string | null = null;
let cachedTotpSecretBytes: Buffer | null = null;

function getTotpSecretBytes(): Buffer {
    const normalizedTotpSecret = normalizeBase32Secret(requireTotpSecret());
    if (
        cachedTotpSecretBytes &&
        cachedNormalizedTotpSecret === normalizedTotpSecret
    ) {
        return cachedTotpSecretBytes;
    }

    const totpSecretBytes = decodeBase32(normalizedTotpSecret);
    cachedNormalizedTotpSecret = normalizedTotpSecret;
    cachedTotpSecretBytes = totpSecretBytes;

    return totpSecretBytes;
}

export function getWebAccessSessionMaxAgeSeconds(): number {
    return parseSessionMaxAgeSeconds();
}

function toBase64URL(input: Buffer | string): string {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
    return b
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function fromBase64URL(input: string): Buffer {
    let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const paddingLength = normalized.length % 4;
    if (paddingLength !== 0) {
        normalized += "=".repeat(4 - paddingLength);
    }

    return Buffer.from(normalized, "base64");
}

function getCookieSigningSecret(): Buffer {
    return createHmac("sha256", getTotpSecretBytes())
        .update("zenfeed-web-cookie-signing-secret")
        .digest();
}

function sign(payloadB64: string, secret: Buffer | string): string {
    const mac = createHmac("sha256", secret);
    mac.update(payloadB64);

    return toBase64URL(mac.digest());
}

export function buildWebAccessCookieValue(
    secret: Buffer | string,
    nowUnix: number,
    maxAgeSeconds: number,
): string {
    const payload = {
        v: webAccessTokenVersion,
        exp: nowUnix + maxAgeSeconds,
    };
    const payloadJSON = JSON.stringify(payload);
    const payloadB64 = toBase64URL(payloadJSON);
    const sigB64 = sign(payloadB64, secret);

    return `${payloadB64}.${sigB64}`;
}

export function isWebAccessCookieValid(
    cookieValue: string | undefined,
    secret: Buffer | string,
    nowUnix: number,
): boolean {
    if (!cookieValue || !secret) {
        return false;
    }
    const parts = cookieValue.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return false;
    }

    const payloadB64 = parts[0];
    const givenSigB64 = parts[1];
    const expectedSigB64 = sign(payloadB64, secret);

    const givenSig = fromBase64URL(givenSigB64);
    const expectedSig = fromBase64URL(expectedSigB64);
    if (givenSig.length !== expectedSig.length) {
        return false;
    }
    if (!timingSafeEqual(givenSig, expectedSig)) {
        return false;
    }

    let payload: { v?: string; exp?: number };
    try {
        payload = JSON.parse(fromBase64URL(payloadB64).toString("utf8"));
    } catch {
        return false;
    }

    if (payload?.v !== webAccessTokenVersion) {
        return false;
    }
    if (typeof payload?.exp !== "number") {
        return false;
    }

    return payload.exp > nowUnix;
}

export function getWebAccessCookieSecret(): Buffer {
    return getCookieSigningSecret();
}

function generateTotpCodeForCounter(counter: number): string {
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));

    const digest = createHmac("sha1", getTotpSecretBytes())
        .update(counterBuffer)
        .digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
        ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);

    return (binary % 10 ** totpDigits)
        .toString()
        .padStart(totpDigits, "0");
}

export function verifyWebAccessTotpCode(
    code: string,
    nowUnix: number,
): boolean {
    const normalized = code.trim().replace(/\s+/g, "");
    if (!/^\d{6}$/.test(normalized)) {
        return false;
    }

    const counter = Math.floor(nowUnix / totpStepSeconds);
    for (let offset = -totpWindow; offset <= totpWindow; offset += 1) {
        const candidate = generateTotpCodeForCounter(counter + offset);
        const left = Buffer.from(normalized, "utf8");
        const right = Buffer.from(candidate, "utf8");
        if (timingSafeEqual(left, right)) {
            return true;
        }
    }

    return false;
}
