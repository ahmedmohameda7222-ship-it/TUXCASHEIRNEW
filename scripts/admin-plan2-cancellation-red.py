from pathlib import Path

path = Path('packages/application/src/ordersBoard.reasonCodes.sqlite.test.ts')
source = path.read_text()
marker = "  it('keeps free-text cancellation only for a genuinely pre-feature configuration snapshot', async () => {"
if source.count(marker) != 1:
    raise SystemExit('cancellation RED insertion guard failed')

case = r'''  it('keeps free-text cancellation during rollout when settings exist but no active cancellation vocabulary is published', async () => {
    const test = await fixture();
    try {
      await test.database.transaction((transaction) =>
        transaction.configuration.put({
          shopId,
          version: 12,
          updatedAt: createdAt,
          categories: [],
          products: [],
          modifiers: [],
          productModifierLinks: [],
          comboBeverageOptions: [],
          recipeLines: [],
          orderTypes: [],
          paymentMethods: [],
          deliveryZones: [],
          settings: {
            version: 7,
            values: {},
            shopIdentity: {
              shopId,
              displayName: 'TUX Maadi',
              address: null,
              phone: null,
              latitude: null,
              longitude: null,
              timezone: 'Africa/Cairo',
              lifecycleState: 'ACTIVE',
              temporaryClosed: false,
              onlineOrdersPaused: false,
            },
            weeklyHours: [],
            specialHours: [],
            paymentMethodZoneRules: [],
          },
          reasonCodes: [],
        }),
      );

      const board = await test.service.loadBoard();
      expect(board.ok).toBe(true);
      if (!board.ok) throw new Error(board.error.message);
      expect(board.value.cancellationReasonMode).toBe('LEGACY');

      const result = await test.service.cancelOrder({
        orderId,
        foodPrepared: true,
        reason: 'Rollout free-text reason',
      });
      expect(result.ok).toBe(true);
    } finally {
      await test.readModel.close();
    }
  });

'''
path.write_text(source.replace(marker, case + marker, 1))
