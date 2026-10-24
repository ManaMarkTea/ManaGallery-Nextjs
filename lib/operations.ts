import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { backupJobs, jobHealth, parseUnits } from "./operation-rules";

export async function getBackupHealth() {
  const checkedAt = new Date().toISOString();
  try {
    if (process.platform !== "linux") throw new Error("Not a systemd host");
    // Fixed, read-only properties only. No shell, sudo, credentials, journal text,
    // user-supplied unit names, or ability to start/modify server services.
    const { stdout } = await promisify(execFile)(
      "/usr/bin/systemctl",
      [
        "show",
        "--no-pager",
        "-p",
        "Id,LoadState,ActiveState,Result,ExecMainExitTimestamp,NextElapseUSecRealtime",
        ...backupJobs.flatMap((job) => [
          `rendergallery-${job.key}.service`,
          `rendergallery-${job.key}.timer`,
        ]),
      ],
      {
        timeout: 3000,
        maxBuffer: 64 * 1024,
        env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
      },
    );
    const units = parseUnits(stdout);
    return {
      checkedAt,
      available: true,
      jobs: backupJobs.map((job) =>
        jobHealth(
          job,
          units.get(`rendergallery-${job.key}.service`),
          units.get(`rendergallery-${job.key}.timer`),
        ),
      ),
    };
  } catch {
    return {
      checkedAt,
      available: false,
      jobs: backupJobs.map((job) => jobHealth(job)),
    };
  }
}
