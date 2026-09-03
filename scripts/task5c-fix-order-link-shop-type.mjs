import { readFile, writeFile } from 'node:fs/promises';

const path = 'packages/persistence/src/browser/IndexedDbWhatsAppStore.ts';
let text = await readFile(path, 'utf8');
const before = `    for (const link of snapshot.orderLinks) {\n      writes.push(\n        requestResult(\n          orderLinks.put({\n            shopId: conversationShops.get(link.conversationId),\n            conversationId: link.conversationId,\n            orderId: link.orderId,\n            linkedAt: link.linkedAt,\n          } satisfies StoredOrderLink),\n        ),\n      );\n    }`;
const after = `    for (const link of snapshot.orderLinks) {\n      const shopId = conversationShops.get(link.conversationId);\n      if (shopId === undefined) {\n        throw new Error(\n          \`Cannot cache WhatsApp order link without a tenant-fenced conversation: \${link.conversationId}\`,\n        );\n      }\n      writes.push(\n        requestResult(\n          orderLinks.put({\n            shopId,\n            conversationId: link.conversationId,\n            orderId: link.orderId,\n            linkedAt: link.linkedAt,\n          } satisfies StoredOrderLink),\n        ),\n      );\n    }`;
if (!text.includes(before)) throw new Error('Task 5C type-fix target was not found.');
text = text.replace(before, after);
await writeFile(path, text);
