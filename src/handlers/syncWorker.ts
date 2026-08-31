import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { SyncEngine } from '../services/syncEngine.js';
import { TrelloWebhookPayload } from '../types/trello.js';

const syncEngine = new SyncEngine();

/**
 * Lambda Handler: SQS Sync Worker
 *
 * Consumes webhook event batches from SQS.
 * Processes each event through the SyncEngine with loop prevention,
 * and reports partial batch item failures so SQS only retries failed messages.
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log(`[SyncWorker] Processing SQS batch with ${event.Records.length} message(s)`);

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    const messageId = record.messageId;
    const startTime = Date.now();

    try {
      const payload: TrelloWebhookPayload = JSON.parse(record.body);
      const actionType = payload.action?.type || 'unknown';
      const actionId = payload.action?.id || 'unknown';

      console.log(
        `[SyncWorker] [Message ${messageId}] Starting sync for action '${actionType}' (${actionId})`
      );

      const result = await syncEngine.processEvent(payload);

      const durationMs = Date.now() - startTime;
      console.log(
        `[SyncWorker] [Message ${messageId}] Finished with status '${result.status}' in ${durationMs}ms:`,
        result.reason || ''
      );
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      console.error(
        `[SyncWorker] [Message ${messageId}] Failed to process event after ${durationMs}ms:`,
        err
      );

      // Report failure for this specific message ID so SQS retries only this item
      batchItemFailures.push({ itemIdentifier: messageId });
    }
  }

  return { batchItemFailures };
};
