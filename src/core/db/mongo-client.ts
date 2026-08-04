import { MongoClient } from "mongodb";

/** Native driver client, used only by the Auth.js MongoDB adapter (it doesn't speak Mongoose). */

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
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
  const client = new MongoClient(uri);
  return client.connect();
}

const clientPromise = global._mongoClientPromise ?? createClientPromise();
global._mongoClientPromise = clientPromise;

// Mark the rejection as handled so an unset MONGODB_URI doesn't crash the process via Node's
// unhandledRejection behavior before any route ever awaits this — the real error still surfaces
// to whoever awaits `clientPromise` (or the adapter) when a request actually needs the DB.
clientPromise.catch(() => {});

export default clientPromise;
