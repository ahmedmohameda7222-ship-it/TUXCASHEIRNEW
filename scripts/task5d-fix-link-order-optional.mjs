import { readFile, writeFile } from 'node:fs/promises';

const servicePath = 'packages/application/src/whatsapp.ts';
let service = await readFile(servicePath, 'utf8');
const before = `      await this.#remote.linkOrder({\n        businessDayId: claims.value.businessDayId,\n        workerId: claims.value.workerId,\n        conversationId: input.conversationId,\n        orderId: input.orderId,\n        linked: input.linked,\n      });`;
const after = `      await this.#remote.linkOrder({\n        businessDayId: claims.value.businessDayId,\n        workerId: claims.value.workerId,\n        conversationId: input.conversationId,\n        orderId: input.orderId,\n        ...(input.linked === undefined ? {} : { linked: input.linked }),\n      });`;
if (!service.includes(before)) throw new Error('Task 5D linkOrder target was not found.');
service = service.replace(before, after);
await writeFile(servicePath, service);

const testPath = 'packages/application/src/whatsapp.test.ts';
let test = await readFile(testPath, 'utf8');
test = test.replace(
  `      conversationId,\n      orderId,\n      linked: undefined,\n    });`,
  `      conversationId,\n      orderId,\n    });`,
);
await writeFile(testPath, test);
