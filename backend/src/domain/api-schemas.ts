import { z } from 'zod';
import { strategyConfigurationSchema } from './strategy-schema';

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/u, 'Phone number must be in E.164 format.');
export const passwordSchema = z.string().min(12).max(128);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

const identityFields = {
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
};
export const signUpSchema = z
  .object({
    ...identityFields,
    password: passwordSchema,
    referralCode: z.string().min(4).max(32).optional(),
  })
  .strict()
  .refine(
    (value) => (value.phone === undefined) !== (value.email === undefined),
    'Provide exactly one of phone or email.',
  );
export const loginSchema = z
  .object({ ...identityFields, password: z.string().min(1).max(128) })
  .strict()
  .refine(
    (value) => (value.phone === undefined) !== (value.email === undefined),
    'Provide exactly one of phone or email.',
  );
export const resetRequestSchema = z
  .object(identityFields)
  .strict()
  .refine(
    (value) => (value.phone === undefined) !== (value.email === undefined),
    'Provide exactly one of phone or email.',
  );
export const resetConfirmSchema = z
  .object({ token: z.string().min(32).max(256), password: passwordSchema })
  .strict();

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).nullable().optional(),
    invoiceName: z.string().trim().min(1).max(150).nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/u)
      .optional(),
    preferences: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional(),
  })
  .strict();

export const createStrategySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    configuration: strategyConfigurationSchema,
  })
  .strict();
export const createVersionSchema = z
  .object({ configuration: strategyConfigurationSchema })
  .strict();
export const patchStrategySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
export const createShareSchema = z
  .object({ expiresAt: z.string().datetime().nullable().optional() })
  .strict();

export const createFolderSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const createBasketSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    notes: z.string().max(4000).optional(),
    folderId: z.string().max(80).nullable().optional(),
    commonConfig: z.record(z.string(), z.unknown()).default({}),
    items: z
      .array(
        z
          .object({
            strategyVersionId: z.string().min(1).max(80),
            multiplier: z.number().int().min(1).max(100).default(1),
            selected: z.boolean().default(true),
            notes: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const mergeBasketSchema = z.object({ sourceBasketId: z.string().min(1).max(80) }).strict();
export const patchBasketSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    notes: z.string().max(4000).nullable().optional(),
    folderId: z.string().min(1).max(80).nullable().optional(),
    commonConfig: z.record(z.string(), z.unknown()).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const runRequestSchema = z
  .object({
    strategyVersionId: z.string().min(1).max(80).optional(),
    basketId: z.string().min(1).max(80).optional(),
    datasetId: z.string().min(1).max(80),
    configuration: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .refine((value) => (value.strategyVersionId === undefined) !== (value.basketId === undefined), {
    message: 'Exactly one of strategyVersionId or basketId is required.',
  });

export const saveRunSchema = z
  .object({
    manifest: z
      .object({
        strategyConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/u),
        datasetId: z.string().min(1).max(80),
        partitionHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
        instrumentMasterVersion: z.string().min(1).max(80),
        calendarVersion: z.string().min(1).max(80),
        engineVersion: z.string().min(1).max(80),
        engineBuildHash: z.string().min(1).max(128),
        executionAdapter: z.enum(['browser_worker', 'local_cli', 'hosted_job']),
        fillModel: z.string().min(1).max(80),
        rulePrecedenceVersion: z.string().min(1).max(80),
        costTableVersion: z.string().min(1).max(80).nullable(),
        capabilities: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean(), z.null()]),
        ),
      })
      .strict(),
    summary: z.record(z.string(), z.unknown()),
    qualityGrade: z.enum(['A', 'B', 'C', 'D', 'F']),
    trades: z.array(z.record(z.string(), z.unknown())).max(250_000).optional(),
  })
  .strict();

export const runTransitionSchema = z
  .object({ state: z.enum(['preparing_data', 'running', 'aggregating']) })
  .strict();

export const manifestRequestSchema = z
  .object({ symbol: z.string().min(1).max(40), from: z.string().date(), to: z.string().date() })
  .strict()
  .refine((value) => value.from <= value.to, 'from must not be after to.');

export const createPortfolioSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startingCapitalPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const draftOrderSchema = z
  .object({
    clientOrderId: z.string().min(1).max(80),
    instrumentKey: z.string().min(1).max(160),
    side: z.enum(['buy', 'sell']),
    quantity: z.number().int().positive().max(10_000_000),
    orderType: z.enum(['market', 'limit']),
    limitPricePaise: z.number().int().positive().optional(),
    referencePricePaise: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) => value.orderType !== 'limit' || value.limitPricePaise !== undefined,
    'Limit orders require a limit price.',
  );

export const createTradeGroupSchema = z
  .object({
    portfolioId: z.string().min(1).max(80).optional(),
    brokerConnectionId: z.string().min(1).max(80).optional(),
    mode: z.enum(['paper', 'live']),
    symbol: z.string().min(1).max(40),
    quoteAsOf: z.string().datetime(),
    orders: z.array(draftOrderSchema).min(1).max(20),
  })
  .strict();
