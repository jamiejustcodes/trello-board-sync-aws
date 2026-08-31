import crypto from 'crypto';
import { TrelloCard } from '../types/trello.js';

/**
 * Verifies the authenticity of incoming Trello webhooks.
 *
 * Trello computes the signature using HMAC-SHA1 of (rawRequestBody + callbackURL)
 * using the webhook secret, encoded as base64.
 *
 * We use crypto.timingSafeEqual to defend against timing attacks.
 */
export const verifyTrelloSignature = (
  rawBody: string,
  callbackUrl: string,
  signatureHeader: string | undefined,
  secret: string
): boolean => {
  // If secret is not set (e.g. initial testing), bypass or warn
  if (!secret) {
    return true;
  }

  if (!signatureHeader) {
    return false;
  }

  try {
    // Trello standard: HMAC-SHA1(rawBody + callbackUrl, secret)
    const hmacWithUrl = crypto
      .createHmac('sha1', secret)
      .update(rawBody + callbackUrl)
      .digest('base64');

    // Alternate standard (some proxies strip the URL parameter): HMAC-SHA1(rawBody, secret)
    const hmacBodyOnly = crypto
      .createHmac('sha1', secret)
      .update(rawBody)
      .digest('base64');

    const expectedBufferWithUrl = Buffer.from(hmacWithUrl, 'utf-8');
    const expectedBufferBodyOnly = Buffer.from(hmacBodyOnly, 'utf-8');
    const receivedBuffer = Buffer.from(signatureHeader, 'utf-8');

    if (
      expectedBufferWithUrl.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBufferWithUrl, receivedBuffer)
    ) {
      return true;
    }

    if (
      expectedBufferBodyOnly.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBufferBodyOnly, receivedBuffer)
    ) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error while verifying Trello signature:', error);
    return false;
  }
};

/**
 * Computes a deterministic SHA-256 hash of a card's synchronized fields.
 *
 * This allows the sync engine to determine if card content has actually changed,
 * preventing unnecessary updates and infinite echo loops between boards.
 */
export const generateCardContentHash = (card: Partial<TrelloCard>): string => {
  const payloadToHash = {
    name: card.name || '',
    desc: card.desc || '',
    due: card.due || null,
    dueComplete: Boolean(card.dueComplete),
    closed: Boolean(card.closed),
    labels: (card.labels || [])
      .map((l) => `${l.name}:${l.color}`)
      .sort()
      .join(','),
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payloadToHash))
    .digest('hex');
};
