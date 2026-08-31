import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { TrelloWebhookPayload } from '../types/trello.js';
import { getConfig } from '../config/env.js';

/**
 * AWS SQS Service Wrapper
 * Enqueues validated webhook payloads for asynchronous processing by worker Lambdas.
 */
export class SqsService {
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor(queueUrl?: string) {
    const config = getConfig();
    this.queueUrl = queueUrl || config.syncQueueUrl;
    this.client = new SQSClient({ region: config.awsRegion });
  }

  /**
   * Pushes a raw Trello webhook payload to the SQS queue.
   */
  async enqueueWebhookEvent(payload: TrelloWebhookPayload): Promise<string | undefined> {
    if (!this.queueUrl) {
      throw new Error(
        '[SqsService] SYNC_QUEUE_URL is not configured. Unable to enqueue webhook event.'
      );
    }

    const actionType = payload.action?.type || 'unknown';
    const cardId = payload.action?.data?.card?.id || 'unknown';
    const boardId = payload.action?.data?.board?.id || 'unknown';

    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(payload),
      MessageAttributes: {
        ActionType: {
          DataType: 'String',
          StringValue: actionType,
        },
        CardId: {
          DataType: 'String',
          StringValue: cardId,
        },
        BoardId: {
          DataType: 'String',
          StringValue: boardId,
        },
      },
    });

    const response = await this.client.send(command);
    return response.MessageId;
  }
}
