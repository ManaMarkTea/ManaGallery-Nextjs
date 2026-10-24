import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getBackupHealth } from "@/lib/operations";
import { uploadStorageUsage } from "@/lib/storage";
import { getSiteSettings } from "@/lib/settings";
import { DISK_RESERVE, MiB, formatBytes } from "@/lib/storage-policy";
import { AdminHeading } from "@/components/admin-ui";
import { LocalTime } from "@/components/local-time";
import { getBackupLogs } from "@/lib/backup-logs";

export default async function Health() {
  await requireAdmin();
  const backups = await getBackupHealth();
  const logs = await getBackupLogs();
  const staleLogs =
    logs.generated && Date.now() - Date.parse(logs.generated) > 5 * 60_000;
  const settings = getSiteSettings();
  const storage = uploadStorageUsage();
  const problems = backups.jobs.filter((job) => job.tone === "danger").length;
  const lowDisk = storage.available < DISK_RESERVE;
  return (
    <>
      <AdminHeading
        title="Site health"
        description="Backup results and storage headroom. Refresh this page for a fresh check."
      >
        <a className="admin-primary-link" href="/admin/health">
          Refresh status ↻
        </a>
      </AdminHeading>
      <div
        className={`admin-health-notice ${problems || lowDisk ? "warning" : ""}`}
        role="status"
      >
        <strong>
          {problems || lowDisk
            ? "Attention needed"
            : backups.available
              ? "Latest server checks"
              : "Backup monitoring unavailable here"}
        </strong>
        <p>
          {backups.available
            ? `${problems} backup ${problems === 1 ? "check needs" : "checks need"} attention. A passing check describes its most recent run; it does not guarantee recovery of every later change.`
            : "This environment does not expose systemd backup status. This is expected on a Windows development machine; no cloud protection is assumed."}
        </p>
        <small>
          Checked <LocalTime value={backups.checkedAt} />
        </small>
      </div>
      <div className="admin-dashboard-grid">
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>Server disk</h2>
              <p>The shared disk holds artwork, code and local backups.</p>
            </div>
            <span className={`admin-badge ${lowDisk ? "danger" : "success"}`}>
              {lowDisk ? "Low space" : "Space available"}
            </span>
          </div>
          <div className="admin-health-body">
            <strong className="admin-health-number">
              {formatBytes(storage.available)}
            </strong>
            <p>free of {formatBytes(storage.capacity)}</p>
            <p>
              Uploads stop before the last {formatBytes(DISK_RESERVE)} is
              consumed. Backup and build jobs need additional room.
            </p>
          </div>
        </section>
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>Upload storage</h2>
              <p>Uploaded artwork and its previews, including pending work.</p>
            </div>
            <Link href="/admin/settings">Limits ↗</Link>
          </div>
          <div className="admin-health-body">
            <strong className="admin-health-number">
              {formatBytes(storage.total)}
            </strong>
            <p>
              of {formatBytes(settings.uploadStorageLimitMiB * MiB)} gallery
              allowance
            </p>
            <p>
              Each member: {formatBytes(settings.memberStorageLimitMiB * MiB)}.
              Imported archive files are outside these quotas but still use
              server disk.
            </p>
          </div>
        </section>
      </div>
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h2>Backup & recovery checks</h2>
            <p>
              Times show your browser's local timezone alongside UTC. Schedules
              include a small randomized delay.
            </p>
          </div>
        </div>
        {logs.generated && (
          <p className="admin-card-note">
            Log snapshot updated <LocalTime value={logs.generated} />. Log
            capture refreshes about once a minute.
          </p>
        )}
        {staleLogs && (
          <p className="admin-card-note">
            Log capture is more than five minutes old. Recent output may be
            missing; check the server log-monitor timer.
          </p>
        )}
        <div className="admin-health-jobs">
          {backups.jobs.map((job) => (
            <article className="admin-health-job" key={job.key}>
              <div>
                <h3>{job.name}</h3>
                <small>{job.frequency}</small>
              </div>
              <span className={`admin-badge ${job.tone}`}>{job.state}</span>
              <p>{job.detail}</p>
              <dl>
                <div>
                  <dt>Last completed run</dt>
                  <dd>
                    <LocalTime value={job.lastRun} />
                  </dd>
                </div>
                <div>
                  <dt>Next scheduled run</dt>
                  <dd>
                    <LocalTime value={job.nextRun} />
                  </dd>
                </div>
              </dl>
              <details className="admin-backup-log-details">
                <summary>View log</summary>
                {logs.jobs[job.key]?.available ? (
                  <div className="admin-backup-log">
                    {logs.jobs[job.key].lines.length ? (
                      logs.jobs[job.key].lines.map((line, index) => (
                        <div className="admin-backup-log-line" key={index}>
                          <LocalTime value={line.at} />
                          <pre>{line.message}</pre>
                        </div>
                      ))
                    ) : (
                      <p>No journal entries recorded for this job.</p>
                    )}
                  </div>
                ) : (
                  <p>
                    Log capture is not connected yet, or this job's log is
                    unavailable. The server log monitor must be installed once.
                  </p>
                )}
              </details>
            </article>
          ))}
        </div>
        <p className="admin-card-note">
          This page is read-only. Failure emails or push notifications are not
          configured. Cloud bandwidth caps can prevent both verification and new
          backups; check Backblaze if a cloud job fails.
        </p>
      </section>
    </>
  );
}
