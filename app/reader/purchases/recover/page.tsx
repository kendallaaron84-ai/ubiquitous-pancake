import { ReaderPurchaseRecovery } from "@/components/reader/ReaderPurchaseRecovery";

type ReaderPurchaseRecoveryPageProps = {
  searchParams: Promise<{ assetId?: string }>;
};

export default async function ReaderPurchaseRecoveryPage({
  searchParams,
}: ReaderPurchaseRecoveryPageProps) {
  const { assetId = "" } = await searchParams;
  return <ReaderPurchaseRecovery assetId={assetId} />;
}
