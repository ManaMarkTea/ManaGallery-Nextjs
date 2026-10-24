# Remaining launch work

The test deployment is suitable for private testing. Completed work includes
legacy sign-in migration, passkeys, upload approval/trusted-member controls,
owner edits, software filters, archived comments and moderation, model/material
downloads, unique views, source-only Git deployment, encrypted local/B2 backups,
admin health monitoring, upload quotas, the offline model-preview converter and
authenticated GLB geometry downloads.

Before opening registration more widely:

- Add email verification and password recovery after choosing outbound mail
  credentials, sender/domain verification and a recovery policy. Do not expose
  admin reset links or reveal whether a legacy account exists.
- Configure an independent failure alert destination. The admin health page
  makes failures visible when visited but cannot notify an absent administrator.
- Confirm the next cloud copy succeeds after the download-cap adjustment; retain
  the separate recovery password and B2 account MFA. Review monthly costs/usage
  before scaling verification or archive size.
- Rehearse the full environment installer on a disposable fresh Ubuntu VM.
  Component tests and restore drills have passed; that is not a complete fresh
  machine rehearsal. Test browser sign-in/upload/approval after a real restore.
- Review the public legacy archive URLs: hiding an imported entry removes it
  from the gallery but historical static files may remain directly reachable.
  Private uploaded images and exchange downloads enforce access checks.
- Exercise actual device passkey prompts on the final domain and mobile/browser
  combinations. Automated virtual authenticators are not all real hardware.
- Complete AdSense domain approval and any required consent setup in Google's
  account before enabling production advertising.
- Decide how legacy forums and new ratings should work; archived ratings remain
  historical values, not an active voting system.
- Complete the Mana viewer host described
  in [model-previews.md](model-previews.md).

Keep storage limits conservative while the app and local backup repository share
one VPS disk. Review root-owned service/runtime updates separately from ordinary
application deployments. Automated dependency checks and permission tests are
useful coverage, not a comprehensive independent security audit.
