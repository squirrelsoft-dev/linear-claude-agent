import { z } from "zod";

export const linearWebhookPayloadSchema = z.object({
  action: z.enum(["create", "update", "remove"]),
  type: z.string(),
  createdAt: z.string(),
  webhookTimestamp: z.number(),
  data: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    description: z.string().optional(),
    state: z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
    }),
    team: z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
    }),
    assignee: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .optional(),
    labels: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    ),
    priority: z.number(),
    url: z.string(),
  }),
  updatedFrom: z
    .object({
      stateId: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

export type LinearWebhookPayload = z.infer<typeof linearWebhookPayloadSchema>;
