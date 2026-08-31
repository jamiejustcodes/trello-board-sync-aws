import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifyTrelloSignature } from '../utils/signature.js';
import { SqsService } from '../services/sqsService.js';
import { getConfig } from '../config/env.js';
import { TrelloWebhookPayload } from '../types/trello.js';

const sqsService = new SqsService();
const config = getConfig();

/**
 * Lambda Handler: Webhook Receiver
 *
 * Responsibilities:
 * 1. Respond 200 OK to HEAD requests during Trello webhook creation.
 * 2. Validate HMAC-SHA1 signature using Trello webhook secret.
 * 3. Enqueue event payload into SQS within < 200ms.
 * 4. Return fast 200 OK to satisfy Trello's strict webhook delivery timeout.
 */
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext?.http?.method?.toUpperCase() || 'POST';

  console.log(`[WebhookReceiver] Received ${method} request to ${event.rawPath}`);

  // 1. Handle Trello Webhook verification probe (HEAD request)
  if (method === 'HEAD') {
    console.log('[WebhookReceiver] Responding 200 OK to Trello HEAD health probe');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Webhook endpoint active' }),
    };
  }

  // 2. Validate request body
  const rawBody = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body || '';

  if (!rawBody) {
    console.warn('[WebhookReceiver] Empty request body received');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  // 3. Verify HMAC Signature
  const signatureHeader =
    event.headers['x-trello-webhook'] ||
    event.headers['X-Trello-Webhook'] ||
    event.headers['x-trello-signature'];

  const callbackUrl = `https://${event.requestContext?.domainName || 'localhost'}${event.rawPath}`;

  if (config.trelloWebhookSecret) {
    const isValid = verifyTrelloSignature(
      rawBody,
      callbackUrl,
      signatureHeader,
      config.trelloWebhookSecret
    );

    if (!isValid) {
      console.warn('[WebhookReceiver] Unauthorized: Invalid webhook signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid webhook signature' }),
      };
    }
  }

  // 4. Parse payload and enqueue to SQS
  try {
    const payload: TrelloWebhookPayload = JSON.parse(rawBody);

    const actionType = payload.action?.type;
    const cardId = payload.action?.data?.card?.id;
    const creator = payload.action?.memberCreator?.username;

    console.log(
      `[WebhookReceiver] Enqueuing action '${actionType}' for card '${cardId}' by user '${creator}'`
    );

    const messageId = await sqsService.enqueueWebhookEvent(payload);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'queued',
        messageId,
        actionId: payload.action?.id,
      }),
    };
  } catch (err: any) {
    console.error('[WebhookReceiver] Error processing payload:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to enqueue webhook payload',
        details: err?.message,
      }),
    };
  }
};
