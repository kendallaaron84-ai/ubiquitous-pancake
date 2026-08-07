import { FreePublicationAccess } from "@/components/reader/FreePublicationAccess";

const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;

export default async function FreePublicationPage({
  searchParams,
}: {
  searchParams: Promise<{ assetId?: string }>;
}) {
  const { assetId: rawAssetId = "" } = await searchParams;
  const assetId = rawAssetId.trim();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";

  if (!ASSET_ID_PATTERN.test(assetId)) {
    return <p role="alert" className="text-center">A valid free publication is required.</p>;
  }
  if (!siteKey) {
    return <p role="alert" className="text-center">Human verification is not configured for this reader application.</p>;
  }
  return <FreePublicationAccess assetId={assetId} siteKey={siteKey} />;
}
