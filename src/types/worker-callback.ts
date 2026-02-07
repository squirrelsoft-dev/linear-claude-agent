export interface WorkerCallbackPayload {
  status: "success" | "failure";
  branch: string;
  error?: string;
  issueId: string;
}
