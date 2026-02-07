import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const MAX_TIMESTAMP_AGE_MS = 60_000;

declare module "express" {
  interface Request {
    rawBody?: Buffer;
  }
}

export function captureRawBody(
  req: Request,
  _res: Response,
  buf: Buffer,
): void {
  req.rawBody = buf;
}

export function verifyLinearSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const signature = req.headers["linear-signature"] as string | undefined;
  const timestampHeader = req.headers["linear-delivery-timestamp"] as
    | string
    | undefined;

  if (!signature) {
    logger.warn("Missing linear-signature header");
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  // Replay protection
  if (timestampHeader) {
    const timestamp = Number(timestampHeader);
    const age = Date.now() - timestamp;
    if (age > MAX_TIMESTAMP_AGE_MS) {
      logger.warn({ age }, "Webhook timestamp too old");
      res.status(401).json({ error: "Timestamp too old" });
      return;
    }
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.warn("No raw body captured");
    res.status(400).json({ error: "No body" });
    return;
  }

  const hmac = crypto.createHmac("sha256", config.LINEAR_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const expected = hmac.digest();

  const provided = Buffer.from(signature, "hex");

  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    logger.warn("Invalid webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  next();
}
