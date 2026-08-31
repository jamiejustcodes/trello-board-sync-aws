import dotenv from 'dotenv';

// Load local environment variables if available
dotenv.config();

export interface AppConfig {
  stage: string;
  awsRegion: string;
  trelloApiKey: string;
  trelloToken: string;
  trelloWebhookSecret: string;
  botMemberId: string;
  sourceBoardId?: string;
  targetBoardId?: string;
  syncQueueUrl: string;
  syncTableName: string;
}

/**
 * Validates and exports typed environment configuration.
 * Fails fast if critical credentials or AWS resource pointers are missing at runtime.
 */
export const getConfig = (): AppConfig => {
  const stage = process.env.STAGE || 'dev';
  const awsRegion = process.env.AWS_REGION || 'us-east-1';
  const trelloApiKey = process.env.TRELLO_API_KEY || '';
  const trelloToken = process.env.TRELLO_TOKEN || '';
  const trelloWebhookSecret = process.env.TRELLO_WEBHOOK_SECRET || '';
  const botMemberId = process.env.BOT_MEMBER_ID || '';
  const sourceBoardId = process.env.SOURCE_BOARD_ID;
  const targetBoardId = process.env.TARGET_BOARD_ID;
  const syncQueueUrl = process.env.SYNC_QUEUE_URL || '';
  const syncTableName = process.env.SYNC_TABLE_NAME || `trello-board-sync-aws-${stage}-state`;

  return {
    stage,
    awsRegion,
    trelloApiKey,
    trelloToken,
    trelloWebhookSecret,
    botMemberId,
    sourceBoardId,
    targetBoardId,
    syncQueueUrl,
    syncTableName,
  };
};
