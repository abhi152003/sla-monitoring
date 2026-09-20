-- Database-level default so raw-driver inserts can omit the id.
ALTER TABLE "uploads" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
