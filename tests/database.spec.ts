import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { openTestDatabase } from "./fixtures/database";

test("fixture writes wait for another process to release its SQLite write lock", async ({}, testInfo) => {
  const filename = testInfo.outputPath("contention.sqlite");
  const database = openTestDatabase(filename);
  database.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE attempts (key TEXT PRIMARY KEY)",
  );
  database.prepare("INSERT INTO attempts VALUES (?)").run("register:fixture");
  const writer = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { DatabaseSync } from 'node:sqlite';
    const database = new DatabaseSync(process.argv[1]);
    database.exec('BEGIN IMMEDIATE');
    process.stdout.write('locked');
    setTimeout(() => { database.exec('COMMIT'); database.close(); }, 400);
  `,
      filename,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const finished = once(writer, "exit");
  try {
    await once(writer.stdout!, "data");
    // This failed immediately without busy_timeout, even though the other
    // process was about to commit. Keep the cleanup write from the CI failure.
    expect(
      database.prepare("DELETE FROM attempts WHERE key LIKE 'register:%'").run()
        .changes,
    ).toBe(1);
    expect((await finished)[0]).toBe(0);
  } finally {
    database.close();
    if (writer.exitCode === null) writer.kill();
  }
});
