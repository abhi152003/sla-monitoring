export const APP_NAME = "sla-monitoring";

export type HealthResponse = {
  status: "ok";
  service: string;
  app: string;
  timestamp: string;
};

export type ApiError = {
  error: string;
  message: string;
};
