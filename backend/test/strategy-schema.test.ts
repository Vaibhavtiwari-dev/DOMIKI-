import { describe, expect, it } from 'vitest';
import { demoStrategy } from '../src/domain/demo-engine';
import { strategyConfigurationSchema } from '../src/domain/strategy-schema';

describe('strategy schema', () => {
  it('accepts the versioned showcase strategy', () => {
    expect(strategyConfigurationSchema.parse(demoStrategy)).toEqual(demoStrategy);
  });

  it('rejects entry after exit', () => {
    const invalid = {
      ...demoStrategy,
      entry: { type: 'fixed_time' as const, time: '15:20' },
    };

    const result = strategyConfigurationSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'entry.time')).toBe(true);
    }
  });

  it('rejects duplicate leg identifiers', () => {
    const firstLeg = demoStrategy.legs[0];
    const secondLeg = demoStrategy.legs[1];
    if (!firstLeg || !secondLeg) throw new Error('The demo fixture must contain two legs.');
    const invalid = {
      ...demoStrategy,
      legs: [firstLeg, { ...secondLeg, id: firstLeg.id }],
    };

    expect(strategyConfigurationSchema.safeParse(invalid).success).toBe(false);
  });
});
