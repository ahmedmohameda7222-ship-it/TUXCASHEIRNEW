import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WhatsAppAdminCommand,
  WhatsAppAdminCommandResult,
  WhatsAppAdminResponse,
  WhatsAppAdminView,
} from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

export function useWhatsApp(shopId: string | undefined, view: WhatsAppAdminView, id?: string) {
  return useQuery({
    queryKey: ['admin', 'whatsapp', shopId ?? 'no-shop', view, id ?? null],
    enabled: Boolean(shopId) && (view !== 'conversation' || Boolean(id)),
    queryFn: () => {
      if (!shopId) throw new Error('concrete_shop_required');
      const params = new URLSearchParams({ view, shopId, limit: '20' });
      if (id) params.set('id', id);
      return adminFetch<WhatsAppAdminResponse>(`/api/admin/whatsapp?${params}`);
    },
  });
}

export function useWhatsAppMutation() {
  const session = useAdminSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: WhatsAppAdminCommand) => {
      const csrf =
        session.state.status === 'authenticated' ? session.state.session.csrfToken : undefined;
      return adminFetch<WhatsAppAdminCommandResult>(
        '/api/admin/whatsapp',
        { method: 'POST', body: JSON.stringify(command) },
        csrf,
      );
    },
    onSuccess: async (_result, command) =>
      client.invalidateQueries({ queryKey: ['admin', 'whatsapp', command.shopId] }),
  });
}
