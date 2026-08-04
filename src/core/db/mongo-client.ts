import { MongoClient } from "mongodb";

/** Native driver client, used only by the Auth.js MongoDB adapter (it doesn't speak Mongoose). */

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

const CONNECT_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Auth.js's MongoDBAdapter takes a single Promise<MongoClient>, bound once at module load — if that
// promise ever rejects, every sign-in on this warm serverless instance is stuck with that same
// rejection forever (there's no way to hand the adapter a fresh promise later). Confirmed live: one
// Atlas node briefly refused connections ("connection <monitor> to X:27017 closed") and every retry
// from the user failed identically for several minutes straight, because the first cold start's
// single connect() attempt lost to that node and the failure was cached indefinitely. Retrying a
// few times *before* the exported promise ever settles fixes that: a transient node hiccup no longer
// needs to survive as a permanent rejection for the rest of this instance's lifetime.
async function connectWithRetry(uri: string): Promise<MongoClient> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    try {
      const client = new MongoClient(uri);
      return await client.connect();
    } catch (err) {
      lastErr = err;
      if (attempt < CONNECT_ATTEMPTS) await sleep(500 * attempt);
    }
  }
  throw lastErr;
}

function createClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    // Rejects lazily, on first actual use — importing this module (e.g. transitively, while Next.js
    // collects route metadata at build time) must never throw synchronously just because env vars
    // aren't loaded yet.
    return Promise.reject(
      new Error("MONGODB_URI is not set — configure your MongoDB Atlas connection string."),
    );
  }
  // connectWithRetry is async, so a synchronous throw from `new MongoClient(uri)` (e.g.
  // MongoParseError for a structurally invalid URI) becomes a rejected promise automatically —
  // no separate try/catch needed here the way the old single-attempt version required.
  return connectWithRetry(uri);
}

const clientPromise = global._mongoClientPromise ?? createClientPromise();
global._mongoClientPromise = clientPromise;

// Mark the rejection as handled so an unset MONGODB_URI doesn't crash the process via Node's
// unhandledRejection behavior before any route ever awaits this — the real error still surfaces
// to whoever awaits `clientPromise` (or the adapter) when a request actually needs the DB.
clientPromise.catch(() => {});

export default clientPromise;
