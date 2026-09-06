import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./whatsappOutboundRepository.ts', import.meta.url), 'utf8');

describe('Task 10B outbound repository authority contract', () => {
  it('uses the canonical v2 outbound intent claim for media and location', () => {
    expect(source).toContain("'claim_tux_whatsapp_outbound_intent_v2'");
    expect(source).not.toContain("'claim_tux_whatsapp_outbound_media_v1'");
    expect(source).not.toContain("'claim_tux_whatsapp_outbound_location_v1'");
  });

  it('uses the binding failed-message parameter for retry lineage', () => {
    expect(source).toMatch(
      /claim_tux_whatsapp_retry_intent_v1[\s\S]{0,900}p_failed_message_id:\s*input\.messageId/,
    );
  });
});
