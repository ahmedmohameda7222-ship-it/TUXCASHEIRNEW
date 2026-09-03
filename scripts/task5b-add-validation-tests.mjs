import { readFileSync, writeFileSync } from 'node:fs';

const path = 'packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts';
const text = readFileSync(path, 'utf8');
if (!text.includes('rejects malformed cached WhatsApp message payloads on read')) {
  const marker = '\n});\n';
  const addition = `

  it('rejects malformed cached WhatsApp message payloads on read', async () => {
    const path = await databasePath('malformed-message');
    const store = new SqliteWhatsAppStore(path);
    await store.initialize();
    await store.close();

    const database = new DatabaseSync(path);
    database
      .prepare(\`
INSERT INTO whatsapp_cache_messages(id, shop_id, conversation_id, created_at, payload_json)
VALUES (?, ?, ?, ?, ?)
\`)
      .run(
        'malformed-message',
        SHOP_A,
        'conversation-a',
        '2026-09-03T11:00:00.000Z',
        JSON.stringify({ id: 'malformed-message', shopId: SHOP_A }),
      );
    database.close();

    const reopened = new SqliteWhatsAppStore(path);
    await reopened.initialize();
    await expect(reopened.loadInbox(SHOP_A)).rejects.toThrow();
    await reopened.close();
  });

  it('rejects cached conversation payloads whose tenant identity disagrees with the fenced row', async () => {
    const path = await databasePath('tenant-mismatch');
    const store = new SqliteWhatsAppStore(path);
    await store.initialize();
    await store.close();

    const database = new DatabaseSync(path);
    database
      .prepare(\`
INSERT INTO whatsapp_cache_conversations(id, shop_id, last_message_at, payload_json)
VALUES (?, ?, ?, ?)
\`)
      .run(
        'conversation-a',
        SHOP_A,
        '2026-09-03T11:00:00.000Z',
        JSON.stringify(conversation(SHOP_B, 'conversation-a', '2026-09-03T11:00:00.000Z')),
      );
    database.close();

    const reopened = new SqliteWhatsAppStore(path);
    await reopened.initialize();
    await expect(reopened.loadInbox(SHOP_A)).rejects.toThrow(/shop|tenant/i);
    await reopened.close();
  });
`;
  const index = text.lastIndexOf(marker);
  if (index < 0) throw new Error('Could not locate final describe terminator.');
  writeFileSync(path, text.slice(0, index) + addition + text.slice(index));
}
