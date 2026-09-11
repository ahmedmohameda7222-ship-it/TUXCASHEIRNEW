import {
  createSupabaseCatalogSchedulerExecutors,
  createSupabaseCatalogSchedulerStore,
  handleCatalogSchedulerRequest,
  runCatalogScheduler,
} from '../../server/catalog/scheduler';
import { getAdminServerEnv } from '../../server/env';
import {
  firstHeader,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../../server/http';
import { AdminSupabaseClient } from '../../server/supabaseAdmin';

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  const result = await handleCatalogSchedulerRequest({
    method: request.method,
    authorization: firstHeader(request.headers.authorization),
    cronSecret: process.env['CRON_SECRET'],
    runScheduler: async () => {
      const client = new AdminSupabaseClient(getAdminServerEnv());
      const executors = createSupabaseCatalogSchedulerExecutors(client);
      return runCatalogScheduler({
        store: createSupabaseCatalogSchedulerStore(client),
        publish: executors.publish,
        setAvailability: executors.setAvailability,
      });
    },
  });

  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }
  sendJson(response, result.statusCode, result.body);
}
