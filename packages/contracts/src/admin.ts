import { z } from 'zod'

export const adminOverviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict()

const adminUserSchema = z.object({
  id: z.string().uuid(),
  login: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.string().datetime(),
}).strict()

export const adminOverviewSchema = z.object({
  generatedAt: z.string().datetime(),
  totals: z.object({
    users: z.number().int().nonnegative(),
    activeSessions: z.number().int().nonnegative(),
    rooms: z.number().int().nonnegative(),
    tenders: z.number().int().nonnegative(),
  }).strict(),
  roomsByStatus: z.object({
    waiting: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  }).strict(),
  tendersByPhase: z.array(z.object({
    phase: z.string().min(1),
    count: z.number().int().nonnegative(),
  }).strict()),
  users: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().min(1),
    items: z.array(adminUserSchema).max(100),
  }).strict(),
}).strict()

export type AdminOverviewQuery = z.infer<typeof adminOverviewQuerySchema>
export type AdminOverview = z.infer<typeof adminOverviewSchema>
