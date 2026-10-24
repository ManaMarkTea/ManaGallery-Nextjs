export const MiB = 1024 * 1024;
export const DISK_RESERVE = 2048 * MiB;

export function storageLimit(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= 1_048_576
    ? number
    : fallback;
}

export function uploadStorageError(input: {
  incoming: number;
  total: number;
  member: number;
  available: number;
  totalLimitMiB: number;
  memberLimitMiB: number;
}): string | null {
  if (input.available - input.incoming < DISK_RESERVE)
    return "Uploads are temporarily paused because server storage is running low. Please contact an administrator.";
  if (input.total + input.incoming > input.totalLimitMiB * MiB)
    return "The gallery's upload storage limit has been reached. Please contact an administrator.";
  if (input.member + input.incoming > input.memberLimitMiB * MiB)
    return "Your artwork storage limit has been reached. Remove an older upload or contact an administrator.";
  return null;
}

export function formatBytes(bytes: number) {
  if (bytes < MiB) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * MiB) return `${(bytes / MiB).toFixed(1)} MiB`;
  return `${(bytes / (1024 * MiB)).toFixed(1)} GiB`;
}
