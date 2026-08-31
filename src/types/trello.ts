/**
 * Trello API Data Models and Webhook Payloads
 */

export interface TrelloMember {
  id: string;
  username: string;
  fullName: string;
}

export interface TrelloLabel {
  id?: string;
  idBoard?: string;
  name: string;
  color: string | null;
}

export interface TrelloCheckItem {
  id: string;
  name: string;
  state: 'complete' | 'incomplete';
  pos: number;
}

export interface TrelloChecklist {
  id: string;
  name: string;
  idBoard: string;
  idCard: string;
  pos: number;
  checkItems: TrelloCheckItem[];
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idBoard: string;
  idList: string;
  closed: boolean;
  due: string | null;
  dueComplete: boolean;
  pos: number;
  url: string;
  shortUrl: string;
  labels: TrelloLabel[];
  idLabels?: string[];
  idChecklists?: string[];
  checklists?: TrelloChecklist[];
  customFieldItems?: Array<{
    id: string;
    idCustomField: string;
    value?: { text?: string; number?: string; date?: string; checked?: string };
  }>;
}

export interface TrelloList {
  id: string;
  name: string;
  idBoard: string;
  closed: boolean;
  pos: number;
}

export interface TrelloWebhookAction {
  id: string;
  idMemberCreator: string;
  type: string;
  date: string;
  data: {
    board?: { id: string; name: string; shortLink?: string };
    card?: {
      id: string;
      name?: string;
      desc?: string;
      idList?: string;
      closed?: boolean;
      due?: string | null;
      dueComplete?: boolean;
    };
    list?: { id: string; name: string };
    listBefore?: { id: string; name: string };
    listAfter?: { id: string; name: string };
    old?: {
      name?: string;
      desc?: string;
      idList?: string;
      closed?: boolean;
      due?: string | null;
      dueComplete?: boolean;
    };
    member?: TrelloMember;
    text?: string;
  };
  memberCreator: TrelloMember;
}

export interface TrelloWebhookPayload {
  action: TrelloWebhookAction;
  model: {
    id: string;
    name: string;
    desc: string;
    closed: boolean;
    idOrganization: string;
    pinned: boolean;
    url: string;
    shortUrl: string;
  };
}

export interface CardSyncRecord {
  PK: string; // e.g. CARD#<cardId>
  SK: string; // e.g. MAPPING#<targetCardId>
  sourceCardId: string;
  sourceBoardId: string;
  targetCardId: string;
  targetBoardId: string;
  lastSyncHash: string;
  lastSyncedAt: string;
  lastActionId?: string;
  ttl?: number;
}
