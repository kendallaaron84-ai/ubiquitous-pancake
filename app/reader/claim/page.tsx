import { ReaderPurchaseClaim } from "@/components/reader/ReaderPurchaseClaim";

type ReaderClaimPageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function ReaderClaimPage({
  searchParams,
}: ReaderClaimPageProps) {
  const { session_id: checkoutSessionId = "" } = await searchParams;
  if (!checkoutSessionId) {
    return (
      <div role="alert" className="rounded-md border border-red-400/50 bg-red-950/40 p-4 text-center">
        A Stripe checkout session is required to claim a purchase.
      </div>
    );
  }
  return <ReaderPurchaseClaim checkoutSessionId={checkoutSessionId} />;
}
