import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Cached connection across hot reloads (dev) and warm serverless invocations (prod) — Mongoose
 * connections are expensive to establish and Vercel functions reuse the module scope between
 * invocations on the same instance.
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

function createConnectionPromise(): Promise<typeof mongoose> {
  if (!MONGODB_URI) {
    return Promise.reject(
      new Error("MONGODB_URI is not set — configure your MongoDB Atlas connection string."),
    );
  }
  // mongoose.connect() can throw synchronously (not just reject) for a structurally invalid URI
  // (e.g. MongoParseError: Invalid scheme) — wrapping in try/catch guarantees callers always get a
  // rejected promise to await/catch, never an exception that escapes uncaught during Next.js's
  // build-time route evaluation. See core/db/mongo-client.ts for the same pattern and why it matters.
  try {
    return mongoose.connect(MONGODB_URI, { bufferCommands: false, maxPoolSize: 10 });
  } catch (err) {
    return Promise.reject(err);
  }
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = createConnectionPromise();
    // Mark handled immediately so a bad/unreachable MONGODB_URI can't surface as an unhandled
    // rejection before any caller awaits this — the real error still reaches whoever awaits
    // connectToDatabase() below.
    cache.promise.catch(() => {});
  }

  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null; // allow retrying on the next call instead of caching a permanent failure
    throw err;
  }
  return cache.conn;
}
