import { describe, expect, it, vi } from 'vitest';
import { runWhatsAppMediaRetention } from './whatsappMediaRetention';

describe('WhatsApp media retention', () => {
  it('deletes each expired object before marking metadata deleted and treats not-found as deleted', async () => {
    const calls: string[] = [];
    const repository = {
      listExpired: vi.fn(async () => [
        { mediaKey: 'a', bucketId: 'tux-whatsapp-media', objectPath: 'media/shop/a' },
        { mediaKey: 'b', bucketId: 'tux-whatsapp-media', objectPath: 'media/shop/b' },
      ]),
      markDeleted: vi.fn(async ({ mediaKey }: { mediaKey: string }) =>
        calls.push(`mark:${mediaKey}`),
      ),
    };
    const storage = {
      deleteObject: vi.fn(async ({ objectPath }: { objectPath: string }) => {
        calls.push(`delete:${objectPath}`);
        return objectPath.endsWith('/b') ? 'NOT_FOUND' : 'DELETED';
      }),
    };
    const result = await runWhatsAppMediaRetention({
      repository,
      storage,
      now: '2026-10-05T03:17:00.000Z',
    });
    expect(result).toEqual({ scanned: 2, deleted: 2, failed: 0 });
    expect(calls).toEqual(['delete:media/shop/a', 'mark:a', 'delete:media/shop/b', 'mark:b']);
    expect(repository.listExpired).toHaveBeenCalledWith({
      now: '2026-10-05T03:17:00.000Z',
      limit: 100,
    });
  });

  it('does not mark metadata when Storage deletion fails', async () => {
    const repository = {
      listExpired: vi.fn(async () => [
        { mediaKey: 'a', bucketId: 'tux-whatsapp-media', objectPath: 'media/shop/a' },
      ]),
      markDeleted: vi.fn(),
    };
    const storage = { deleteObject: vi.fn(async () => 'FAILED' as const) };
    await expect(
      runWhatsAppMediaRetention({
        repository,
        storage,
        now: '2026-10-05T03:17:00.000Z',
      }),
    ).resolves.toEqual({ scanned: 1, deleted: 0, failed: 1 });
    expect(repository.markDeleted).not.toHaveBeenCalled();
  });
});
