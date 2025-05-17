import crypto from "crypto";

export function calculateSignature(key: string, data: string): string {
  const hmac = crypto.createHmac("sha256", key);
  hmac.update(data);
  return hmac.digest("hex");
}
