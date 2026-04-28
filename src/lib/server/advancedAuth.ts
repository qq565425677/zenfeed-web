import { createHmac, timingSafeEqual } from "crypto";

export const advancedUnlockCookieName = "zenfeed_advanced_unlocked";
const advancedUnlockVersion = "v1";

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

function sign(payloadB64: string, secret: string): string {
    const mac = createHmac("sha256", secret);
    mac.update(payloadB64);

    return toBase64URL(mac.digest());
}

export function buildAdvancedUnlockCookieValue(
    secret: string,
    nowUnix: number,
    maxAgeSeconds: number,
): string {
    const payload = {
        v: advancedUnlockVersion,
        exp: nowUnix + maxAgeSeconds,
    };
    const payloadJSON = JSON.stringify(payload);
    const payloadB64 = toBase64URL(payloadJSON);
    const sigB64 = sign(payloadB64, secret);

    return `${payloadB64}.${sigB64}`;
}

export function isAdvancedUnlockCookieValid(
    cookieValue: string | undefined,
    secret: string,
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

    if (payload?.v !== advancedUnlockVersion) {
        return false;
    }
    if (typeof payload?.exp !== "number") {
        return false;
    }

    return payload.exp > nowUnix;
}

