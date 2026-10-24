import { DatabaseSync } from "node:sqlite";

// The browser and test runner are separate processes sharing this fixture DB.
// Match the application's bounded wait for short writes (including view counts).
export function openTestDatabase(filename: string): DatabaseSync {
  const database = new DatabaseSync(filename);
  try {
    database.exec("PRAGMA busy_timeout=5000");
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
