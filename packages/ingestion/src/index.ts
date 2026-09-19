export type IngestionPlaceholder = {
  ready: false;
  note: string;
};

export const INGESTION_STATUS: IngestionPlaceholder = {
  ready: false,
  note: "CSV parsing, cleaning, and SLA rules land here in later work orders (see root README, rules R1-R27).",
};
