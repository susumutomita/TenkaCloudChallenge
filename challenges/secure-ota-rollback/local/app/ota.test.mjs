import { describe, expect, it } from 'bun:test';
import { isCampaignResult } from './ota.mjs';

describe('OTA internal campaign contract', () => {
  it('should accept completed and expected failed campaigns with matching identity', () => {
    expect(
      isCampaignResult(
        { campaignId: 'campaign-1', status: 'completed', events: [] },
        'campaign-1',
        200
      )
    ).toBe(true);
    expect(
      isCampaignResult(
        { campaignId: 'campaign-1', status: 'failed', events: [] },
        'campaign-1',
        409
      )
    ).toBe(true);
  });

  it('should reject malformed or misrouted campaign responses', () => {
    for (const data of [
      {},
      { campaignId: 'other', status: 'completed', events: [] },
      { campaignId: 'campaign-1', status: 'unknown', events: [] },
      { campaignId: 'campaign-1', status: 'failed', events: {} },
    ]) {
      expect(isCampaignResult(data, 'campaign-1', 200)).toBe(false);
    }
    expect(
      isCampaignResult(
        { campaignId: 'campaign-1', status: 'failed', events: [] },
        'campaign-1',
        500
      )
    ).toBe(false);
  });
});
