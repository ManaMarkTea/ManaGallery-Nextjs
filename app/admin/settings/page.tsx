import { requireAdmin } from "@/lib/admin";
import { getSiteSettings } from "@/lib/settings";
import { AdminHeading } from "@/components/admin-ui";
import { SettingsForm, AdsSettingsForm } from "@/components/admin-forms";
import { getAdsConfig, getAdsSettings } from "@/lib/ads";
export default async function Settings() {
  await requireAdmin();
  const ads = getAdsConfig();
  return (
    <>
      <AdminHeading
        title="Gallery settings"
        description="Shape the gallery identity and control how your community grows."
      />
      <section className="admin-card admin-settings">
        <div className="admin-card-heading">
          <div>
            <h2>Identity & publishing</h2>
            <p>Changes take effect as soon as you save.</p>
          </div>
        </div>
        <SettingsForm settings={getSiteSettings()} />
      </section>
      <section className="admin-card admin-settings">
        <div className="admin-card-heading">
          <div>
            <h2>Google AdSense</h2>
            <p>
              {ads
                ? ads.origin
                  ? `Configured for ${ads.origin}.`
                  : "Preview mode: live ads are blocked on localhost and development builds."
                : "Advertising is disabled."}
            </p>
            <p>
              Advertising appears for signed-out gallery visitors only. Changes
              apply immediately. See Readme.md for domain approval and consent
              setup.
            </p>
          </div>
        </div>
        <AdsSettingsForm settings={getAdsSettings()} />
      </section>
    </>
  );
}
