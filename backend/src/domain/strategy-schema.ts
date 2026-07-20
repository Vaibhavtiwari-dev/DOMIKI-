import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Expected HH:mm.');
const isoDate = z.string().date();
const positiveAmount = z.number().finite().positive();

const expirySelector = z.discriminatedUnion('type', [
  z.object({ type: z.literal('current_week'), nextWeekOnExpiryDay: z.boolean().default(false) }),
  z.object({ type: z.literal('current_month') }),
  z.object({ type: z.literal('weekly_dte'), dte: z.number().int().min(0).max(90) }),
  z.object({ type: z.literal('monthly_dte'), dte: z.number().int().min(0).max(365) }),
]);

const strikeSelector = z.discriminatedUnion('type', [
  z.object({ type: z.literal('atm') }),
  z.object({ type: z.literal('atm_offset'), steps: z.number().int().min(-100).max(100) }),
  z.object({ type: z.literal('fixed'), strike: positiveAmount }),
  z.object({
    type: z.literal('spot_points'),
    points: z.number().finite().min(-100_000).max(100_000),
  }),
  z.object({ type: z.literal('spot_percent'), percent: z.number().finite().min(-100).max(100) }),
  z.object({ type: z.literal('closest_premium'), premium: positiveAmount }),
  z.object({ type: z.literal('premium_range'), min: positiveAmount, max: positiveAmount }),
  z.object({ type: z.literal('combined_straddle_premium'), premium: positiveAmount }),
  z.object({ type: z.literal('delta'), delta: z.number().finite().min(-1).max(1) }),
  z.object({ type: z.literal('highest_oi') }),
]);

const threshold = z
  .object({
    unit: z.enum(['points', 'percent', 'premium']),
    value: positiveAmount,
  })
  .strict();

const trailingStop = z
  .object({ trigger: positiveAmount, trail: positiveAmount, unit: z.enum(['points', 'percent']) })
  .strict();

const reentryPolicy = z
  .object({
    after: z.enum(['stop_loss', 'target', 'either']),
    mode: z.enum(['same_contract', 'reexecute']),
    delayMinutes: z.number().int().min(0).max(390),
    maxCount: z.number().int().min(1).max(20),
    noEntryAfter: time,
  })
  .strict();

const leg = z
  .object({
    id: z.string().min(1).max(64),
    instrument: z.enum(['future', 'call', 'put']),
    side: z.enum(['buy', 'sell']),
    quantity: z.discriminatedUnion('unit', [
      z.object({ unit: z.literal('lots'), value: z.number().int().min(1).max(10_000) }),
      z.object({ unit: z.literal('contracts'), value: z.number().int().min(1).max(10_000_000) }),
    ]),
    expiry: expirySelector,
    strike: strikeSelector.optional(),
    stopLoss: threshold.optional(),
    target: threshold.optional(),
    trailingStop: trailingStop.optional(),
    moveStopToCost: z.boolean().default(false),
    squareOff: z.enum(['leg', 'strategy']).default('leg'),
    reentry: reentryPolicy.optional(),
    tags: z.array(z.string().min(1).max(32)).max(16).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.instrument === 'future' && value.strike !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['strike'],
        message: 'Futures cannot select a strike.',
      });
    }
    if (value.instrument !== 'future' && value.strike === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['strike'],
        message: 'Option legs require a strike selector.',
      });
    }
    if (value.reentry?.after === 'stop_loss' && value.stopLoss === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reentry'],
        message: 'Stop-loss re-entry requires a stop loss.',
      });
    }
    if (value.reentry?.after === 'target' && value.target === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reentry'],
        message: 'Target re-entry requires a target.',
      });
    }
    if (
      value.reentry?.after === 'either' &&
      value.stopLoss === undefined &&
      value.target === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reentry'],
        message: 'Re-entry requires a stop loss or target.',
      });
    }
  });

const entryPolicy = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed_time'), time }),
  z.object({
    type: z.literal('premium_range'),
    startTime: time,
    endTime: time,
    min: positiveAmount,
    max: positiveAmount,
  }),
  z.object({
    type: z.literal('wait_and_trade'),
    startTime: time,
    endTime: time,
    movement: positiveAmount,
    unit: z.enum(['points', 'percent']),
  }),
  z.object({
    type: z.literal('range_breakout'),
    rangeStart: time,
    rangeEnd: time,
    entryEnd: time,
    direction: z.enum(['above', 'below', 'either']),
  }),
]);

const protectProfits = z
  .object({
    trigger: positiveAmount,
    lock: positiveAmount,
    profitIncrement: positiveAmount,
    trailIncrement: positiveAmount,
  })
  .strict();

const costModel = z
  .object({
    slippagePercent: z.number().finite().min(0).max(25).default(0),
    directionAware: z.boolean().default(true),
    brokerageProfile: z.string().min(1).max(64).nullable().default(null),
    costTableVersion: z.string().min(1).max(64).nullable().default(null),
  })
  .strict();

export const strategyConfigurationSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    underlying: z.enum(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX', 'BANKEX']),
    exchange: z.enum(['NSE', 'BSE']),
    dateRange: z.object({ from: isoDate, to: isoDate }).strict(),
    session: z
      .object({
        timezone: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
        weekdays: z.array(z.number().int().min(1).max(5)).min(1).max(5),
      })
      .strict(),
    entry: entryPolicy,
    exit: z
      .object({
        time,
        strategyStopLoss: threshold.optional(),
        strategyTarget: threshold.optional(),
        protectProfits: protectProfits.optional(),
      })
      .strict(),
    legs: z.array(leg).min(1).max(20),
    priceResolution: z.enum([
      'candle_open',
      'interval',
      'ohlc_conservative',
      'ohlc_optimistic',
      'tick',
    ]),
    intervalMinutes: z.union([z.literal(1), z.literal(5), z.literal(15)]).default(1),
    missingDataPolicy: z
      .enum(['exclude_date', 'skip_leg', 'no_trade', 'fail'])
      .default('exclude_date'),
    costModel,
    filters: z
      .object({
        minVix: z.number().finite().min(0).max(200).optional(),
        maxVix: z.number().finite().min(0).max(200).optional(),
        includeExpiryDays: z.boolean().optional(),
        excludedDates: z.array(isoDate).max(366).default([]),
      })
      .strict()
      .default({ excludedDates: [] }),
    metadata: z
      .object({
        tags: z.array(z.string().min(1).max(32)).max(32).default([]),
        notes: z.string().max(4000).optional(),
      })
      .strict()
      .default({ tags: [] }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dateRange.from > value.dateRange.to) {
      context.addIssue({
        code: 'custom',
        path: ['dateRange'],
        message: 'from must not be after to.',
      });
    }
    if (value.entry.type === 'fixed_time' && value.entry.time >= value.exit.time) {
      context.addIssue({
        code: 'custom',
        path: ['entry', 'time'],
        message: 'Entry must be before exit.',
      });
    }
    const ids = new Set<string>();
    for (const [index, valueLeg] of value.legs.entries()) {
      if (ids.has(valueLeg.id)) {
        context.addIssue({
          code: 'custom',
          path: ['legs', index, 'id'],
          message: 'Leg IDs must be unique.',
        });
      }
      ids.add(valueLeg.id);
      if (valueLeg.reentry !== undefined && valueLeg.reentry.noEntryAfter > value.exit.time) {
        context.addIssue({
          code: 'custom',
          path: ['legs', index, 'reentry', 'noEntryAfter'],
          message: 'No-entry-after cannot be after strategy exit.',
        });
      }
    }
    if (
      value.filters.minVix !== undefined &&
      value.filters.maxVix !== undefined &&
      value.filters.minVix > value.filters.maxVix
    ) {
      context.addIssue({
        code: 'custom',
        path: ['filters'],
        message: 'Minimum VIX cannot exceed maximum VIX.',
      });
    }
  });

export type StrategyConfiguration = z.infer<typeof strategyConfigurationSchema>;
