import { request } from "../api/http";

export type SessionOperationsPayload = {
  health?: any;
  telemetry?: any;
  monitor?: any;
  runtime?: {
    providers?: any;
    locks?: any;
    cache?: any;
  };
  sessions?: any[];
  backoff?: any[];
  metrics?: any;
};

export async function getSessionOperations(): Promise<{
  source: "aggregated" | "fallback";
  data: SessionOperationsPayload;
}> {
  try {
    const data = await request<any>("/api/operations/sessions");
    if (!data?.success) throw new Error("Invalid response");
    return {
      source: "aggregated",
      data,
    };
  } catch (err) {
    console.warn("FALLBACK_OPERATIONS", err);
    const [debug, health, telemetry] = await Promise.all([
      request<any>("/api/debug/sessions"),
      request<any>("/api/health/messaging"),
      request<any>("/api/telemetry"),
    ]);
    return {
      source: "fallback",
      data: {
        health,
        telemetry,
        monitor: debug?.monitor,
        runtime: {
          providers: debug?.providers,
          locks: debug?.locks,
          cache: debug?.cache,
        },
        sessions: debug?.sessions || [],
        backoff: debug?.backoff || [],
        metrics: debug?.metrics || {},
      },
    };
  }
}
