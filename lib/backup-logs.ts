import "server-only";
import { open } from "node:fs/promises";
import { backupJobs } from "./operation-rules";

export type BackupLog = {
  available: boolean;
  lines: { at: string | null; message: string }[];
};

export async function getBackupLogs(): Promise<{
  generated: string | null;
  jobs: Record<string, BackupLog>;
}> {
  const empty = { generated: null, jobs: {} };
  try {
    const file = await open(
      process.env.RENDERGALLERY_MONITOR_FILE ||
        "/var/lib/rendergallery-monitor/backup-logs.json",
      "r",
    );
    let text: string;
    try {
      if ((await file.stat()).size > 1024 * 1024) return empty;
      text = await file.readFile("utf8");
    } finally {
      await file.close();
    }
    const data = JSON.parse(text);
    if (
      data.version !== 1 ||
      typeof data.generated !== "string" ||
      !Number.isFinite(Date.parse(data.generated)) ||
      !data.jobs
    )
      return empty;
    const jobs: Record<string, BackupLog> = {};
    for (const { key } of backupJobs) {
      const log = data.jobs[key];
      if (
        !log ||
        typeof log.available !== "boolean" ||
        !Array.isArray(log.lines)
      )
        continue;
      jobs[key] = {
        available: log.available,
        lines: log.lines
          .slice(-40)
          .filter(
            (line: { at?: unknown; message?: unknown }) =>
              typeof line?.message === "string",
          )
          .map((line: { at?: unknown; message: string }) => ({
            at:
              typeof line.at === "string" &&
              Number.isFinite(Date.parse(line.at))
                ? line.at
                : null,
            message: line.message.slice(0, 1000),
          })),
      };
    }
    return { generated: data.generated, jobs };
  } catch {
    return empty;
  }
}
