import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  verifyTrelloSignature,
  generateCardContentHash,
} from '../src/utils/signature.js';
import { TrelloCard } from '../src/types/trello.js';

describe('Signature and Checksum Utilities', () => {
  const secret = 'super_secret_webhook_token_123';
  const callbackUrl = 'https://api.example.com/webhook';
  const sampleBody = JSON.stringify({
    action: { id: 'action_123', type: 'updateCard' },
    model: { id: 'board_456', name: 'Sprint Board' },
  });

  describe('verifyTrelloSignature', () => {
    it('should return true for a valid signature matching body + callbackURL', () => {
      const validSignature = crypto
        .createHmac('sha1', secret)
        .update(sampleBody + callbackUrl)
        .digest('base64');

      const result = verifyTrelloSignature(
        sampleBody,
        callbackUrl,
        validSignature,
        secret
      );

      expect(result).toBe(true);
    });

    it('should return true for a valid signature matching body only (proxy fallback)', () => {
      const validSignature = crypto
        .createHmac('sha1', secret)
        .update(sampleBody)
        .digest('base64');

      const result = verifyTrelloSignature(
        sampleBody,
        callbackUrl,
        validSignature,
        secret
      );

      expect(result).toBe(true);
    });

    it('should return false for a tampered payload', () => {
      const validSignature = crypto
        .createHmac('sha1', secret)
        .update(sampleBody + callbackUrl)
        .digest('base64');

      const tamperedBody = JSON.stringify({
        action: { id: 'action_123', type: 'hackedCard' },
      });

      const result = verifyTrelloSignature(
        tamperedBody,
        callbackUrl,
        validSignature,
        secret
      );

      expect(result).toBe(false);
    });

    it('should return false when signature header is missing', () => {
      const result = verifyTrelloSignature(
        sampleBody,
        callbackUrl,
        undefined,
        secret
      );

      expect(result).toBe(false);
    });

    it('should return true if no secret is configured (dev mode)', () => {
      const result = verifyTrelloSignature(
        sampleBody,
        callbackUrl,
        undefined,
        ''
      );

      expect(result).toBe(true);
    });
  });

  describe('generateCardContentHash', () => {
    it('should produce identical hashes for identical card contents', () => {
      const cardA: Partial<TrelloCard> = {
        name: 'Implement AWS Lambda',
        desc: 'Build serverless webhook handler',
        due: '2026-09-10T12:00:00.000Z',
        dueComplete: false,
        closed: false,
        labels: [{ name: 'Backend', color: 'blue' }],
      };

      const cardB: Partial<TrelloCard> = {
        name: 'Implement AWS Lambda',
        desc: 'Build serverless webhook handler',
        due: '2026-09-10T12:00:00.000Z',
        dueComplete: false,
        closed: false,
        labels: [{ name: 'Backend', color: 'blue' }],
      };

      expect(generateCardContentHash(cardA)).toBe(generateCardContentHash(cardB));
    });

    it('should produce different hashes when synchronized fields change', () => {
      const baseCard: Partial<TrelloCard> = {
        name: 'Feature A',
        desc: 'Original description',
        closed: false,
      };

      const updatedCard: Partial<TrelloCard> = {
        name: 'Feature A',
        desc: 'Updated description with new acceptance criteria',
        closed: false,
      };

      expect(generateCardContentHash(baseCard)).not.toBe(
        generateCardContentHash(updatedCard)
      );
    });

    it('should handle missing or empty fields consistently', () => {
      const minimalCard: Partial<TrelloCard> = {
        name: 'Minimal Card',
      };

      const hash = generateCardContentHash(minimalCard);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 hex string length
    });
  });
});
