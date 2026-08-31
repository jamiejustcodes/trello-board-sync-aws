import { TrelloClient } from './trelloClient.js';
import { DynamoDbService } from './dynamoDbService.js';
import { generateCardContentHash } from '../utils/signature.js';
import { TrelloCard, TrelloWebhookPayload } from '../types/trello.js';
import { getConfig } from '../config/env.js';

export interface SyncResult {
  status: 'skipped' | 'created' | 'updated' | 'deleted' | 'error';
  reason?: string;
  sourceCardId?: string;
  targetCardId?: string;
}

/**
 * Synchronization Engine
 *
 * Implements bidirectional card synchronization, field mapping, and
 * multi-layered infinite loop protection.
 */
export class SyncEngine {
  private readonly trello: TrelloClient;
  private readonly db: DynamoDbService;
  private botMemberId: string;
  private readonly sourceBoardId?: string;
  private readonly targetBoardId?: string;

  constructor(
    trelloClient?: TrelloClient,
    dynamoDbService?: DynamoDbService
  ) {
    const config = getConfig();
    this.trello = trelloClient || new TrelloClient();
    this.db = dynamoDbService || new DynamoDbService();
    this.botMemberId = config.botMemberId;
    this.sourceBoardId = config.sourceBoardId;
    this.targetBoardId = config.targetBoardId;
  }

  /**
   * Lazily resolves and caches the bot's Trello member ID to ignore self-triggered actions.
   */
  private async ensureBotMemberId(): Promise<string> {
    if (!this.botMemberId) {
      try {
        const me = await this.trello.getMe();
        this.botMemberId = me.id;
        console.log(`[SyncEngine] Resolved bot member ID: ${this.botMemberId} (${me.username})`);
      } catch (err) {
        console.warn('[SyncEngine] Failed to resolve bot member ID automatically:', err);
      }
    }
    return this.botMemberId;
  }

  /**
   * Main entrypoint: Processes an individual Trello webhook event.
   */
  async processEvent(payload: TrelloWebhookPayload): Promise<SyncResult> {
    const action = payload.action;
    if (!action) {
      return { status: 'skipped', reason: 'Missing action payload' };
    }

    const actionType = action.type;
    const creatorId = action.idMemberCreator || action.memberCreator?.id;
    const sourceCardId = action.data?.card?.id;
    const sourceBoardId = action.data?.board?.id || payload.model?.id;

    // 1. Loop Prevention Layer 1: Filter out actions initiated by our own bot account
    const botId = await this.ensureBotMemberId();
    if (botId && creatorId === botId) {
      console.log(
        `[SyncEngine] Skipping self-triggered action '${actionType}' by bot member '${creatorId}'`
      );
      return {
        status: 'skipped',
        reason: 'Self-triggered action ignored (Loop prevention)',
      };
    }

    // 2. Ignore non-card events
    if (!sourceCardId) {
      return {
        status: 'skipped',
        reason: `Ignored non-card action '${actionType}'`,
      };
    }

    // 3. Determine the target board for synchronization
    const targetBoardId = this.determineTargetBoard(sourceBoardId);
    if (!targetBoardId) {
      console.log(
        `[SyncEngine] Action on board ${sourceBoardId} has no paired target board configured.`
      );
      return {
        status: 'skipped',
        reason: 'No paired target board configured',
      };
    }

    // 4. Handle card deletion / archiving
    if (actionType === 'deleteCard') {
      return this.handleCardDeletion(sourceCardId);
    }

    // 5. Fetch fresh source card state from Trello API
    let sourceCard: TrelloCard;
    try {
      sourceCard = await this.trello.getCard(sourceCardId);
    } catch (err: any) {
      if (err.response?.status === 404) {
        console.log(`[SyncEngine] Source card ${sourceCardId} not found on Trello.`);
        return { status: 'skipped', reason: 'Card not found' };
      }
      throw err;
    }

    // 6. Loop Prevention Layer 2: Compute SHA-256 content checksum
    const currentContentHash = generateCardContentHash(sourceCard);

    // 7. Check DynamoDB for existing card mapping
    const mapping = await this.db.getCardMapping(sourceCardId);

    if (!mapping) {
      // Create new linked card on target board
      return this.createLinkedCard(sourceCard, sourceBoardId, targetBoardId, currentContentHash, action.id);
    }

    // Loop Prevention Layer 3: Checksum comparison
    if (mapping.lastSyncHash === currentContentHash) {
      console.log(
        `[SyncEngine] Content hash unchanged for card ${sourceCardId} (${currentContentHash}). Skipping update.`
      );
      return {
        status: 'skipped',
        reason: 'Content hash identical (No changes to sync)',
        sourceCardId,
        targetCardId: mapping.targetCardId,
      };
    }

    // Update existing linked card
    return this.updateLinkedCard(
      sourceCard,
      mapping.targetCardId,
      targetBoardId,
      currentContentHash,
      action.id
    );
  }

  /**
   * Resolves the opposite board ID for bidirectional sync.
   */
  private determineTargetBoard(sourceBoardId: string): string | undefined {
    if (!this.sourceBoardId || !this.targetBoardId) {
      // If boards aren't explicitly restricted in env, default to pairing them
      return undefined;
    }

    if (sourceBoardId === this.sourceBoardId) {
      return this.targetBoardId;
    }
    if (sourceBoardId === this.targetBoardId) {
      return this.sourceBoardId;
    }

    return undefined;
  }

  /**
   * Creates a counterpart card on the target board and establishes bidirectional DynamoDB mapping.
   */
  private async createLinkedCard(
    sourceCard: TrelloCard,
    sourceBoardId: string,
    targetBoardId: string,
    contentHash: string,
    actionId?: string
  ): Promise<SyncResult> {
    console.log(`[SyncEngine] Creating linked card for '${sourceCard.name}' on board ${targetBoardId}`);

    // Find destination list on target board
    const targetLists = await this.trello.getBoardLists(targetBoardId);
    if (!targetLists.length) {
      throw new Error(`Target board ${targetBoardId} has no lists.`);
    }

    // Attempt list name matching; fallback to first list
    let targetList = targetLists[0];
    try {
      const sourceLists = await this.trello.getBoardLists(sourceBoardId);
      const sourceList = sourceLists.find((l) => l.id === sourceCard.idList);
      if (sourceList) {
        const matchingList = targetLists.find(
          (tl) => tl.name.toLowerCase() === sourceList.name.toLowerCase()
        );
        if (matchingList) {
          targetList = matchingList;
        }
      }
    } catch (err) {
      console.warn('[SyncEngine] List name matching failed, falling back to first list:', err);
    }

    // Create target card
    const targetCard = await this.trello.createCard(targetList.id, {
      name: sourceCard.name,
      desc: sourceCard.desc,
      due: sourceCard.due,
      dueComplete: sourceCard.dueComplete,
      pos: sourceCard.pos,
    });

    // Sync checklists if present
    try {
      await this.trello.syncChecklists(sourceCard.id, targetCard.id);
    } catch (err) {
      console.warn(`[SyncEngine] Failed to sync checklists to new card ${targetCard.id}:`, err);
    }

    // Persist bidirectional mapping in DynamoDB
    await this.db.saveBidirectionalMapping(
      sourceCard.id,
      sourceBoardId,
      targetCard.id,
      targetBoardId,
      contentHash,
      actionId
    );

    console.log(
      `[SyncEngine] Successfully linked card '${sourceCard.id}' <--> '${targetCard.id}'`
    );

    return {
      status: 'created',
      sourceCardId: sourceCard.id,
      targetCardId: targetCard.id,
    };
  }

  /**
   * Updates an existing linked card on the target board.
   */
  private async updateLinkedCard(
    sourceCard: TrelloCard,
    targetCardId: string,
    targetBoardId: string,
    contentHash: string,
    actionId?: string
  ): Promise<SyncResult> {
    console.log(
      `[SyncEngine] Synchronizing updates from source card ${sourceCard.id} to target card ${targetCardId}`
    );

    // Update primary card fields
    await this.trello.updateCard(targetCardId, {
      name: sourceCard.name,
      desc: sourceCard.desc,
      closed: sourceCard.closed,
      due: sourceCard.due,
      dueComplete: sourceCard.dueComplete,
    });

    // Synchronize checklists
    try {
      await this.trello.syncChecklists(sourceCard.id, targetCardId);
    } catch (err) {
      console.warn(`[SyncEngine] Checklist sync failed for target card ${targetCardId}:`, err);
    }

    // Update DynamoDB hash record to prevent reciprocal sync loop
    await this.db.updateSyncHash(sourceCard.id, targetCardId, contentHash, actionId);

    console.log(`[SyncEngine] Successfully updated target card ${targetCardId}`);

    return {
      status: 'updated',
      sourceCardId: sourceCard.id,
      targetCardId,
    };
  }

  /**
   * Handles card deletion and mapping cleanup.
   */
  private async handleCardDeletion(sourceCardId: string): Promise<SyncResult> {
    const mapping = await this.db.getCardMapping(sourceCardId);
    if (!mapping) {
      return { status: 'skipped', reason: 'No mapping found for deleted card' };
    }

    console.log(
      `[SyncEngine] Cleaning up mapping for deleted card ${sourceCardId} (linked to ${mapping.targetCardId})`
    );

    await this.db.removeMapping(sourceCardId, mapping.targetCardId);

    return {
      status: 'deleted',
      sourceCardId,
      targetCardId: mapping.targetCardId,
    };
  }
}
