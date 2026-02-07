export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment" | "Project" | string;
  createdAt: string;
  webhookTimestamp: number;
  data: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    state: {
      id: string;
      name: string;
      type: string;
    };
    team: {
      id: string;
      key: string;
      name: string;
    };
    assignee?: {
      id: string;
      name: string;
    };
    labels: Array<{
      id: string;
      name: string;
    }>;
    priority: number;
    url: string;
  };
  updatedFrom?: {
    stateId?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
}
