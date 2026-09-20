import { setEnv } from "../src/env";

setEnv({
  DATABASE_URL: "postgres://test:test@db.local/test",
  ALLOWED_ORIGIN: "http://localhost:3000",
});
