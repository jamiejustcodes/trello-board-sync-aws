import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { CardSyncRecord } from '../types/trello.js';
import { getConfig } from '../config/env.js';

/**
 * DynamoDB State & Mapping Store
 *
 * Persists linked card associations across boards and stores content hashes
 * to break infinite loop cycles.
 */
export class DynamoDbService {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName?: string) {
    const config = getConfig();
    this.tableName = tableName || config.syncTableName;
    const client = new DynamoDBClient({ region: config.awsRegion });
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /**
   * Retrieves the sync mapping and last synced state for a given card.
   */
  async getCardMapping(cardId: string): Promise<CardSyncRecord | null> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `CARD#${cardId}`,
      },
      Limit: 1,
    });

    const response = await this.docClient.send(command);
    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    return response.Items[0] as CardSyncRecord;
  }

  /**
   * Saves a bidirectional mapping between two cards on different boards.
   */
  async saveBidirectionalMapping(
    cardAId: string,
    boardAId: string,
    cardBId: string,
    boardBId: string,
    contentHash: string,
    actionId?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30-day TTL

    // Forward record: Card A -> Card B
    const recordA: CardSyncRecord = {
      PK: `CARD#${cardAId}`,
      SK: `MAPPING#${cardBId}`,
      sourceCardId: cardAId,
      sourceBoardId: boardAId,
      targetCardId: cardBId,
      targetBoardId: boardBId,
      lastSyncHash: contentHash,
      lastSyncedAt: now,
      lastActionId: actionId,
      ttl,
    };

    // Reverse record: Card B -> Card A
    const recordB: CardSyncRecord = {
      PK: `CARD#${cardBId}`,
      SK: `MAPPING#${cardAId}`,
      sourceCardId: cardBId,
      sourceBoardId: boardBId,
      targetCardId: cardAId,
      targetBoardId: boardAId,
      lastSyncHash: contentHash,
      lastSyncedAt: now,
      lastActionId: actionId,
      ttl,
    };

    await Promise.all([
      this.docClient.send(new PutCommand({ TableName: this.tableName, Item: recordA })),
      this.docClient.send(new PutCommand({ TableName: this.tableName, Item: recordB })),
    ]);
  }

  /**
   * Updates the content hash and last synced timestamp for linked cards.
   */
  async updateSyncHash(
    sourceCardId: string,
    targetCardId: string,
    contentHash: string,
    actionId?: string
  ): Promise<void> {
    const now = new Date().toISOString();

    const forwardPut = this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `CARD#${sourceCardId}`,
          SK: `MAPPING#${targetCardId}`,
          sourceCardId,
          targetCardId,
          lastSyncHash: contentHash,
          lastSyncedAt: now,
          lastActionId: actionId,
        },
      })
    );

    const reversePut = this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `CARD#${targetCardId}`,
          SK: `MAPPING#${sourceCardId}`,
          sourceCardId: targetCardId,
          targetCardId: sourceCardId,
          lastSyncHash: contentHash,
          lastSyncedAt: now,
          lastActionId: actionId,
        },
      })
    );

    await Promise.all([forwardPut, reversePut]);
  }

  /**
   * Removes card mappings from DynamoDB when a card is permanently deleted.
   */
  async removeMapping(cardId: string, targetCardId: string): Promise<void> {
    await Promise.all([
      this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: `CARD#${cardId}`, SK: `MAPPING#${targetCardId}` },
        })
      ),
      this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: `CARD#${targetCardId}`, SK: `MAPPING#${cardId}` },
        })
      ),
    ]);
  }
}
