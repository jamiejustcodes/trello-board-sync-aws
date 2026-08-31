import { TrelloClient } from '../src/services/trelloClient.js';
import { getConfig } from '../src/config/env.js';

/**
 * CLI Tool for Trello Webhook and Bot Management
 *
 * Usage:
 *   npx tsx scripts/manage-webhooks.ts me
 *   npx tsx scripts/manage-webhooks.ts list
 *   npx tsx scripts/manage-webhooks.ts create <boardId> <callbackUrl> [description]
 *   npx tsx scripts/manage-webhooks.ts delete <webhookId>
 */

const client = new TrelloClient();
const config = getConfig();

async function main() {
  const [,, command, arg1, arg2, arg3] = process.argv;

  if (!config.trelloApiKey || !config.trelloToken) {
    console.error('Error: TRELLO_API_KEY and TRELLO_TOKEN must be set in .env');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'me': {
        console.log('Fetching authenticated Trello member info...');
        const me = await client.getMe();
        console.log('\n--- Authenticated Member Info ---');
        console.log(`ID:       ${me.id}`);
        console.log(`Username: ${me.username}`);
        console.log(`Full Name:${me.fullName}`);
        console.log('\nCopy the ID into your .env file as BOT_MEMBER_ID to prevent self-triggered loops.');
        break;
      }

      case 'list': {
        console.log('Fetching active Trello webhooks for this token...');
        const webhooks = await client.listWebhooks();
        if (webhooks.length === 0) {
          console.log('No active webhooks found.');
        } else {
          console.log(`\nFound ${webhooks.length} webhook(s):`);
          webhooks.forEach((wh, idx) => {
            console.log(`\n[${idx + 1}] ID:          ${wh.id}`);
            console.log(`    Description: ${wh.description}`);
            console.log(`    Model ID:    ${wh.idModel}`);
            console.log(`    Callback:    ${wh.callbackURL}`);
            console.log(`    Active:      ${wh.active}`);
          });
        }
        break;
      }

      case 'create': {
        const boardId = arg1;
        const callbackUrl = arg2;
        const desc = arg3 || `Sync Webhook for board ${boardId}`;

        if (!boardId || !callbackUrl) {
          console.error('Usage: npx tsx scripts/manage-webhooks.ts create <boardId> <callbackUrl> [description]');
          process.exit(1);
        }

        console.log(`Registering webhook for board ${boardId} -> ${callbackUrl}...`);
        const result = await client.createWebhook(boardId, callbackUrl, desc);
        console.log('\nWebhook registered successfully:');
        console.log(`ID:       ${result.id}`);
        console.log(`Callback: ${result.callbackURL}`);
        break;
      }

      case 'delete': {
        const webhookId = arg1;
        if (!webhookId) {
          console.error('Usage: npx tsx scripts/manage-webhooks.ts delete <webhookId>');
          process.exit(1);
        }

        console.log(`Deleting webhook ${webhookId}...`);
        await client.deleteWebhook(webhookId);
        console.log('Webhook deleted successfully.');
        break;
      }

      default: {
        console.log(`
Trello Webhook Management CLI

Available commands:
  me                                           Display bot member ID and username
  list                                         List all webhooks registered for token
  create <boardId> <callbackUrl> [description] Register a new webhook pointing to Lambda
  delete <webhookId>                           Delete an existing webhook

Examples:
  npx tsx scripts/manage-webhooks.ts me
  npx tsx scripts/manage-webhooks.ts list
  npx tsx scripts/manage-webhooks.ts create 64f123... https://xyz.execute-api.us-east-1.amazonaws.com/webhook "Board A Sync"
  npx tsx scripts/manage-webhooks.ts delete 64f999...
        `);
      }
    }
  } catch (err: any) {
    console.error('\nAPI Error:', err.response?.data || err.message);
    process.exit(1);
  }
}

main();
