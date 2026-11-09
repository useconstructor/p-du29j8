import "server-only";
import { createClient, type Client } from "@libsql/client";

let client: Client | undefined;

// Lazy construction keeps builds and the public health error path independent
// of credential availability. There is deliberately no fallback database.
function connection(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error("Database configuration unavailable");
    client = createClient({ url, authToken, intMode: "number" });
  }
  return client;
}

export const db = new Proxy({} as Client, {
  get(_target, property) {
    const actual = connection();
    const value = Reflect.get(actual, property, actual);
    return typeof value === "function" ? value.bind(actual) : value;
  },
});
