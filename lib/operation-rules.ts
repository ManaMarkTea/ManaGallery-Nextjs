export const backupJobs = [
  { key: "backup", name: "Local backup", frequency: "Hourly", maxAgeHours: 3 },
  {
    key: "cloud-copy",
    name: "Cloud backup",
    frequency: "Daily",
    maxAgeHours: 36,
  },
  {
    key: "maintenance",
    name: "Local integrity check",
    frequency: "Weekly",
    maxAgeHours: 9 * 24,
  },
  {
    key: "cloud-maintenance",
    name: "Cloud integrity check",
    frequency: "Weekly",
    maxAgeHours: 9 * 24,
  },
  {
    key: "restore-check",
    name: "Local restore test",
    frequency: "Monthly",
    maxAgeHours: 35 * 24,
  },
  {
    key: "cloud-restore-check",
    name: "Cloud restore test",
    frequency: "Monthly",
    maxAgeHours: 35 * 24,
  },
] as const;

export function systemdTimestamp(value: string | undefined): string | null {
  const match = value?.match(
    /^(?:[A-Za-z]{3} )?(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/,
  );
  if (!match) return null;
  const stamp = `${match[1]}T${match[2]}Z`;
  return Number.isFinite(Date.parse(stamp)) ? stamp : null;
}

export function parseUnits(output: string) {
  return new Map(
    output
      .trim()
      .split(/\r?\n\r?\n/)
      .map((block) => {
        const properties = Object.fromEntries(
          block.split(/\r?\n/).map((line) => {
            const index = line.indexOf("=");
            return [line.slice(0, index), line.slice(index + 1)];
          }),
        );
        return [properties.Id, properties];
      }),
  );
}

export function jobHealth(
  job: (typeof backupJobs)[number],
  service?: Record<string, string>,
  timer?: Record<string, string>,
  now = Date.now(),
) {
  const lastRun = systemdTimestamp(service?.ExecMainExitTimestamp);
  const nextRun = systemdTimestamp(timer?.NextElapseUSecRealtime);
  const result = service?.Result || "";
  const base = { ...job, lastRun, nextRun };
  if (!service || service.LoadState !== "loaded")
    return {
      ...base,
      tone: "unknown",
      state: "Not configured",
      detail: "No backup service is installed for this check.",
    };
  if (service.ActiveState === "activating")
    return {
      ...base,
      tone: "info",
      state: "Running",
      detail: "A backup or verification job is in progress.",
    };
  if (result && result !== "success")
    return {
      ...base,
      tone: "danger",
      state: "Failed",
      detail:
        "The latest run failed. Review its server logs before relying on this backup.",
    };
  if (!timer || timer.LoadState !== "loaded" || timer.ActiveState !== "active")
    return {
      ...base,
      tone: "danger",
      state: "Schedule inactive",
      detail: "Automatic runs are not scheduled or the timer is inactive.",
    };
  if (!lastRun)
    return {
      ...base,
      tone: "info",
      state: "Awaiting first run",
      detail:
        "Scheduled, but no completed run is recorded since the service state was initialized.",
    };
  const age = now - Date.parse(lastRun);
  if (age < -5 * 60_000 || age > job.maxAgeHours * 3_600_000)
    return {
      ...base,
      tone: "danger",
      state: "Overdue",
      detail:
        age < 0
          ? "The recorded time is in the future. Check the server clock."
          : "No recent successful run is recorded within the expected interval.",
    };
  return {
    ...base,
    tone: "success",
    state: "Passed",
    detail: "The latest recorded run completed successfully.",
  };
}
