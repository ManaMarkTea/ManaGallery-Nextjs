import { test, expect } from "@playwright/test";
import {
  backupJobs,
  jobHealth,
  parseUnits,
  systemdTimestamp,
} from "../lib/operation-rules";
import {
  DISK_RESERVE,
  MiB,
  storageLimit,
  uploadStorageError,
} from "../lib/storage-policy";

test("backup health distinguishes failure, stale success, disabled schedules and missing evidence", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const service = {
    LoadState: "loaded",
    ActiveState: "inactive",
    Result: "success",
    ExecMainExitTimestamp: "Fri 2026-10-23 11:00:00 UTC",
  };
  const timer = {
    LoadState: "loaded",
    ActiveState: "active",
    NextElapseUSecRealtime: "Fri 2026-10-23 13:00:00 UTC",
  };
  const job = backupJobs[0];
  expect(jobHealth(job, service, timer, now).state).toBe("Passed");
  expect(
    jobHealth(job, { ...service, Result: "exit-code" }, timer, now).state,
  ).toBe("Failed");
  expect(
    jobHealth(
      job,
      { ...service, ExecMainExitTimestamp: "Fri 2026-10-23 07:00:00 UTC" },
      timer,
      now,
    ).state,
  ).toBe("Overdue");
  expect(
    jobHealth(
      job,
      { ...service, ExecMainExitTimestamp: "Fri 2026-10-23 15:00:00 UTC" },
      timer,
      now,
    ).state,
  ).toBe("Overdue");
  expect(
    jobHealth(job, service, { ...timer, ActiveState: "inactive" }, now).state,
  ).toBe("Schedule inactive");
  expect(
    jobHealth(job, { ...service, ExecMainExitTimestamp: "" }, timer, now).state,
  ).toBe("Awaiting first run");
  expect(
    jobHealth(job, { ...service, ActiveState: "activating" }, timer, now).state,
  ).toBe("Running");
  expect(jobHealth(job).state).toBe("Not configured");
  expect(systemdTimestamp("not a timestamp")).toBeNull();
  const units = parseUnits(
    "Id=rendergallery-backup.service\nResult=success\n\nId=rendergallery-backup.timer\nActiveState=active\n",
  );
  expect(units.get("rendergallery-backup.service")?.Result).toBe("success");
  expect(units.get("rendergallery-backup.timer")?.ActiveState).toBe("active");
});

test("storage policy preserves disk reserve and enforces gallery/member bounds", () => {
  const base = {
    incoming: MiB,
    total: MiB,
    member: MiB,
    available: DISK_RESERVE + 2 * MiB,
    totalLimitMiB: 3,
    memberLimitMiB: 2,
  };
  expect(uploadStorageError(base)).toBeNull();
  expect(uploadStorageError({ ...base, available: DISK_RESERVE })).toContain(
    "server storage",
  );
  expect(uploadStorageError({ ...base, totalLimitMiB: 1 })).toContain(
    "gallery's upload",
  );
  expect(uploadStorageError({ ...base, memberLimitMiB: 1 })).toContain(
    "Your artwork",
  );
  expect(storageLimit(undefined, 100)).toBe(100);
  expect(storageLimit("-1", 100)).toBe(100);
  expect(storageLimit("0", 100)).toBe(100);
  expect(storageLimit("Infinity", 100)).toBe(100);
  expect(storageLimit("12", 100)).toBe(12);
});
