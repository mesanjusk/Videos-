import { MongoClient } from "mongodb";

/** Native driver client, used only by the Auth.js MongoDB adapter (it doesn't speak Mongoose). */
const MONGODB_URI = process.env.MONGODB_URI;

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function createClientPromise(): Promise<MongoClient> {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not set — configure your MongoDB Atlas connection string.");
  }
  const client = new MongoClient(MONGODB_URI);
  return client.connect();
}

const clientPromise = global._mongoClientPromise ?? createClientPromise();
global._mongoClientPromise = clientPromise;

export default clientPromise;
