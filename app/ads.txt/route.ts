import { getAdsConfig } from "@/lib/ads";
export function GET() {
  const config = getAdsConfig();
  return new Response(
    config
      ? `google.com, ${config.publisher.replace("ca-", "")}, DIRECT, f08c47fec0942fa0\n`
      : "# Advertising is disabled.\n",
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
