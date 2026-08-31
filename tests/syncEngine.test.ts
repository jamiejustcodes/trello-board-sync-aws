import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../src/services/syncEngine.js';
import { TrelloClient } from '../src/services/trelloClient.js';
import { DynamoDbService } from '../src/services/dynamoDbService.js';
import { TrelloCard, TrelloWebhookPayload } from '../src/types/trello.js';
import { generateCardContentHash } from '../src/utils/signature.js';

describe('SyncEngine', () => {
  let mockTrello: TrelloClient;
  let mockDb: DynamoDbService;
  let syncEngine: SyncEngine;

  const mockBotMemberId = 'bot_member_123';
  const mockSourceBoardId = 'board_source_aaa';
  const mockTargetBoardId = 'board_target_bbb';

  beforeEach(() => {
    vi.clearAllMocks();

    mockTrello = {
      getMe: vi.fn().mockResolvedValue({ id: mockBotMemberId, username: 'syncbot' }),
      getCard: vi.fn(),
      createCard: vi.fn(),
      updateCard: vi.fn(),
      getBoardLists: vi.fn().mockResolvedValue([
        { id: 'list_target_1', name: 'To Do', idBoard: mockTargetBoardId, closed: false, pos: 1 },
        { id: 'list_target_2', name: 'In Progress', idBoard: mockTargetBoardId, closed: false, pos: 2 },
      ]),
      getBoardLabels: vi.fn().mockResolvedValue([]),
      createBoardLabel: vi.fn(),
      getCardChecklists: vi.fn().mockResolvedValue([]),
      createChecklist: vi.fn(),
      addCheckItem: vi.fn(),
      syncChecklists: vi.fn().mockResolvedValue(undefined),
      createWebhook: vi.fn(),
      listWebhooks: vi.fn(),
      deleteWebhook: vi.fn(),
    } as unknown as TrelloClient;

    mockDb = {
      getCardMapping: vi.fn(),
      saveBidirectionalMapping: vi.fn().mockResolvedValue(undefined),
      updateSyncHash: vi.fn().mockResolvedValue(undefined),
      removeMapping: vi.fn().mockResolvedValue(undefined),
    } as unknown as DynamoDbService;

    // Set process.env board pairing for tests
    process.env.SOURCE_BOARD_ID = mockSourceBoardId;
    process.env.TARGET_BOARD_ID = mockTargetBoardId;
    process.env.BOT_MEMBER_ID = mockBotMemberId;

    syncEngine = new SyncEngine(mockTrello, mockDb);
  });

  it('should ignore actions triggered by the integration bot itself (Layer 1 loop prevention)', async () => {
    const payload: TrelloWebhookPayload = {
      action: {
        id: 'act_1',
        idMemberCreator: mockBotMemberId,
        type: 'updateCard',
        date: new Date().toISOString(),
        data: {
          board: { id: mockSourceBoardId, name: 'Source Board' },
          card: { id: 'card_123', name: 'Test Card' },
        },
        memberCreator: { id: mockBotMemberId, username: 'syncbot', fullName: 'Sync Bot' },
      },
      model: {
        id: mockSourceBoardId,
        name: 'Source Board',
        desc: '',
        closed: false,
        idOrganization: '',
        pinned: false,
        url: '',
        shortUrl: '',
      },
    };

    const result = await syncEngine.processEvent(payload);

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('Loop prevention');
    expect(mockTrello.getCard).not.toHaveBeenCalled();
    expect(mockDb.saveBidirectionalMapping).not.toHaveBeenCalled();
  });

  it('should create a new linked card on the target board when no prior mapping exists', async () => {
    const sourceCard: TrelloCard = {
      id: 'card_source_999',
      name: 'Implement OAuth Flow',
      desc: 'Connect Google & GitHub providers',
      idBoard: mockSourceBoardId,
      idList: 'list_source_todo',
      closed: false,
      due: null,
      dueComplete: false,
      pos: 1000,
      url: 'https://trello.com/c/xxx',
      shortUrl: 'https://trello.com/c/xxx',
      labels: [],
    };

    const createdTargetCard: TrelloCard = {
      ...sourceCard,
      id: 'card_target_888',
      idBoard: mockTargetBoardId,
      idList: 'list_target_1',
    };

    vi.mocked(mockTrello.getCard).mockResolvedValue(sourceCard);
    vi.mocked(mockTrello.createCard).mockResolvedValue(createdTargetCard);
    vi.mocked(mockDb.getCardMapping).mockResolvedValue(null);

    const payload: TrelloWebhookPayload = {
      action: {
        id: 'act_user_create',
        idMemberCreator: 'human_user_456',
        type: 'createCard',
        date: new Date().toISOString(),
        data: {
          board: { id: mockSourceBoardId, name: 'Source Board' },
          card: { id: 'card_source_999', name: 'Implement OAuth Flow' },
        },
        memberCreator: { id: 'human_user_456', username: 'jamie', fullName: 'Jamie' },
      },
      model: {
        id: mockSourceBoardId,
        name: 'Source Board',
        desc: '',
        closed: false,
        idOrganization: '',
        pinned: false,
        url: '',
        shortUrl: '',
      },
    };

    const result = await syncEngine.processEvent(payload);

    expect(result.status).toBe('created');
    expect(result.sourceCardId).toBe('card_source_999');
    expect(result.targetCardId).toBe('card_target_888');

    expect(mockTrello.createCard).toHaveBeenCalledWith('list_target_1', {
      name: 'Implement OAuth Flow',
      desc: 'Connect Google & GitHub providers',
      due: null,
      dueComplete: false,
      pos: 1000,
    });

    expect(mockDb.saveBidirectionalMapping).toHaveBeenCalled();
  });

  it('should skip update when card content hash is unchanged (Layer 3 loop prevention)', async () => {
    const sourceCard: TrelloCard = {
      id: 'card_source_999',
      name: 'Implement OAuth Flow',
      desc: 'Connect Google & GitHub providers',
      idBoard: mockSourceBoardId,
      idList: 'list_source_todo',
      closed: false,
      due: null,
      dueComplete: false,
      pos: 1000,
      url: '',
      shortUrl: '',
      labels: [],
    };

    const hash = generateCardContentHash(sourceCard);

    vi.mocked(mockTrello.getCard).mockResolvedValue(sourceCard);
    vi.mocked(mockDb.getCardMapping).mockResolvedValue({
      PK: 'CARD#card_source_999',
      SK: 'MAPPING#card_target_888',
      sourceCardId: 'card_source_999',
      sourceBoardId: mockSourceBoardId,
      targetCardId: 'card_target_888',
      targetBoardId: mockTargetBoardId,
      lastSyncHash: hash, // Exactly matches current hash!
      lastSyncedAt: new Date().toISOString(),
    });

    const payload: TrelloWebhookPayload = {
      action: {
        id: 'act_user_touch',
        idMemberCreator: 'human_user_456',
        type: 'updateCard',
        date: new Date().toISOString(),
        data: {
          board: { id: mockSourceBoardId, name: 'Source Board' },
          card: { id: 'card_source_999', name: 'Implement OAuth Flow' },
        },
        memberCreator: { id: 'human_user_456', username: 'jamie', fullName: 'Jamie' },
      },
      model: {
        id: mockSourceBoardId,
        name: 'Source Board',
        desc: '',
        closed: false,
        idOrganization: '',
        pinned: false,
        url: '',
        shortUrl: '',
      },
    };

    const result = await syncEngine.processEvent(payload);

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('Content hash identical');
    expect(mockTrello.updateCard).not.toHaveBeenCalled();
    expect(mockDb.updateSyncHash).not.toHaveBeenCalled();
  });

  it('should update target card when content hash has changed', async () => {
    const updatedSourceCard: TrelloCard = {
      id: 'card_source_999',
      name: 'Implement OAuth Flow (Updated)',
      desc: 'Add Apple Sign-In support',
      idBoard: mockSourceBoardId,
      idList: 'list_source_todo',
      closed: false,
      due: '2026-10-01T00:00:00.000Z',
      dueComplete: true,
      pos: 1000,
      url: '',
      shortUrl: '',
      labels: [],
    };

    vi.mocked(mockTrello.getCard).mockResolvedValue(updatedSourceCard);
    vi.mocked(mockTrello.updateCard).mockResolvedValue({} as TrelloCard);
    vi.mocked(mockDb.getCardMapping).mockResolvedValue({
      PK: 'CARD#card_source_999',
      SK: 'MAPPING#card_target_888',
      sourceCardId: 'card_source_999',
      sourceBoardId: mockSourceBoardId,
      targetCardId: 'card_target_888',
      targetBoardId: mockTargetBoardId,
      lastSyncHash: 'old_obsolete_hash_111',
      lastSyncedAt: new Date().toISOString(),
    });

    const payload: TrelloWebhookPayload = {
      action: {
        id: 'act_user_update',
        idMemberCreator: 'human_user_456',
        type: 'updateCard',
        date: new Date().toISOString(),
        data: {
          board: { id: mockSourceBoardId, name: 'Source Board' },
          card: { id: 'card_source_999' },
        },
        memberCreator: { id: 'human_user_456', username: 'jamie', fullName: 'Jamie' },
      },
      model: {
        id: mockSourceBoardId,
        name: 'Source Board',
        desc: '',
        closed: false,
        idOrganization: '',
        pinned: false,
        url: '',
        shortUrl: '',
      },
    };

    const result = await syncEngine.processEvent(payload);

    expect(result.status).toBe('updated');
    expect(mockTrello.updateCard).toHaveBeenCalledWith('card_target_888', {
      name: 'Implement OAuth Flow (Updated)',
      desc: 'Add Apple Sign-In support',
      closed: false,
      due: '2026-10-01T00:00:00.000Z',
      dueComplete: true,
    });
    expect(mockDb.updateSyncHash).toHaveBeenCalled();
  });

  it('should clean up mapping records when a card is permanently deleted', async () => {
    vi.mocked(mockDb.getCardMapping).mockResolvedValue({
      PK: 'CARD#card_source_del',
      SK: 'MAPPING#card_target_del',
      sourceCardId: 'card_source_del',
      sourceBoardId: mockSourceBoardId,
      targetCardId: 'card_target_del',
      targetBoardId: mockTargetBoardId,
      lastSyncHash: 'some_hash',
      lastSyncedAt: new Date().toISOString(),
    });

    const payload: TrelloWebhookPayload = {
      action: {
        id: 'act_user_delete',
        idMemberCreator: 'human_user_456',
        type: 'deleteCard',
        date: new Date().toISOString(),
        data: {
          board: { id: mockSourceBoardId, name: 'Source Board' },
          card: { id: 'card_source_del' },
        },
        memberCreator: { id: 'human_user_456', username: 'jamie', fullName: 'Jamie' },
      },
      model: {
        id: mockSourceBoardId,
        name: 'Source Board',
        desc: '',
        closed: false,
        idOrganization: '',
        pinned: false,
        url: '',
        shortUrl: '',
      },
    };

    const result = await syncEngine.processEvent(payload);

    expect(result.status).toBe('deleted');
    expect(mockDb.removeMapping).toHaveBeenCalledWith('card_source_del', 'card_target_del');
  });
});
