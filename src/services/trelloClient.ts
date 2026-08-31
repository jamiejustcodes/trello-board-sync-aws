import axios, { AxiosInstance } from 'axios';
import {
  TrelloCard,
  TrelloChecklist,
  TrelloLabel,
  TrelloList,
  TrelloMember,
} from '../types/trello.js';
import { getConfig } from '../config/env.js';

/**
 * Trello REST API Client
 * Wraps Atlassian Trello v1 endpoints for cards, boards, lists, checklists, and webhooks.
 */
export class TrelloClient {
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly token: string;

  constructor(apiKey?: string, token?: string) {
    const config = getConfig();
    this.apiKey = apiKey || config.trelloApiKey;
    this.token = token || config.trelloToken;

    if (!this.apiKey || !this.token) {
      console.warn(
        '[TrelloClient] Initialized without API key or token. Requests will fail if credentials are not configured.'
      );
    }

    this.client = axios.create({
      baseURL: 'https://api.trello.com/1',
      timeout: 10000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    // Automatically append auth query params to all outgoing requests
    this.client.interceptors.request.use((reqConfig) => {
      reqConfig.params = {
        ...reqConfig.params,
        key: this.apiKey,
        token: this.token,
      };
      return reqConfig;
    });
  }

  /**
   * Retrieves authenticated user details (useful to resolve bot member ID automatically)
   */
  async getMe(): Promise<TrelloMember> {
    const response = await this.client.get<TrelloMember>('/members/me');
    return response.data;
  }

  /**
   * Retrieves complete card details including checklists and labels
   */
  async getCard(cardId: string): Promise<TrelloCard> {
    const response = await this.client.get<TrelloCard>(`/cards/${cardId}`, {
      params: {
        checklists: 'all',
        checkItemStates: 'true',
        customFieldItems: 'true',
        fields: 'name,desc,idBoard,idList,closed,due,dueComplete,pos,url,shortUrl,labels,idLabels',
      },
    });
    return response.data;
  }

  /**
   * Updates fields on an existing card
   */
  async updateCard(
    cardId: string,
    updates: Partial<{
      name: string;
      desc: string;
      closed: boolean;
      idList: string;
      due: string | null;
      dueComplete: boolean;
      idLabels: string[];
      pos: number | 'top' | 'bottom';
    }>
  ): Promise<TrelloCard> {
    const response = await this.client.put<TrelloCard>(`/cards/${cardId}`, updates);
    return response.data;
  }

  /**
   * Creates a new card in a target list
   */
  async createCard(
    idList: string,
    cardData: {
      name: string;
      desc?: string;
      due?: string | null;
      dueComplete?: boolean;
      pos?: number | 'top' | 'bottom';
      idLabels?: string[];
    }
  ): Promise<TrelloCard> {
    const response = await this.client.post<TrelloCard>('/cards', {
      idList,
      ...cardData,
    });
    return response.data;
  }

  /**
   * Retrieves all lists for a given board
   */
  async getBoardLists(boardId: string): Promise<TrelloList[]> {
    const response = await this.client.get<TrelloList[]>(`/boards/${boardId}/lists`);
    return response.data;
  }

  /**
   * Retrieves labels available on a board
   */
  async getBoardLabels(boardId: string): Promise<TrelloLabel[]> {
    const response = await this.client.get<TrelloLabel[]>(`/boards/${boardId}/labels`);
    return response.data;
  }

  /**
   * Creates a new label on a board
   */
  async createBoardLabel(boardId: string, name: string, color: string | null): Promise<TrelloLabel> {
    const response = await this.client.post<TrelloLabel>(`/boards/${boardId}/labels`, {
      name,
      color,
    });
    return response.data;
  }

  /**
   * Retrieves checklists attached to a card
   */
  async getCardChecklists(cardId: string): Promise<TrelloChecklist[]> {
    const response = await this.client.get<TrelloChecklist[]>(`/cards/${cardId}/checklists`);
    return response.data;
  }

  /**
   * Creates a checklist on a card
   */
  async createChecklist(cardId: string, name: string): Promise<TrelloChecklist> {
    const response = await this.client.post<TrelloChecklist>(`/cards/${cardId}/checklists`, {
      name,
    });
    return response.data;
  }

  /**
   * Adds an item to a checklist
   */
  async addCheckItem(
    checklistId: string,
    name: string,
    state: 'complete' | 'incomplete' = 'incomplete',
    pos: number = 0
  ): Promise<void> {
    await this.client.post(`/checklists/${checklistId}/checkItems`, {
      name,
      checked: state === 'complete',
      pos,
    });
  }

  /**
   * Synchronizes checklists from source card to target card.
   * Deletes existing target checklists and replicates fresh copies to ensure consistency.
   */
  async syncChecklists(sourceCardId: string, targetCardId: string): Promise<void> {
    const [sourceChecklists, targetChecklists] = await Promise.all([
      this.getCardChecklists(sourceCardId),
      this.getCardChecklists(targetCardId),
    ]);

    // Remove existing checklists on target
    for (const targetCl of targetChecklists) {
      await this.client.delete(`/checklists/${targetCl.id}`);
    }

    // Recreate source checklists on target
    for (const sourceCl of sourceChecklists) {
      const newCl = await this.createChecklist(targetCardId, sourceCl.name);
      for (const item of sourceCl.checkItems) {
        await this.addCheckItem(newCl.id, item.name, item.state, item.pos);
      }
    }
  }

  /**
   * Webhook Management
   */

  async createWebhook(idModel: string, callbackURL: string, description: string): Promise<any> {
    const response = await this.client.post('/webhooks', {
      idModel,
      callbackURL,
      description,
      active: true,
    });
    return response.data;
  }

  async listWebhooks(): Promise<any[]> {
    const response = await this.client.get(`/tokens/${this.token}/webhooks`);
    return response.data;
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.client.delete(`/webhooks/${webhookId}`);
  }
}
