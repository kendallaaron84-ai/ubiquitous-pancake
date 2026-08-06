import { ReaderAuthForm } from "@/components/reader/ReaderAuthForm";

type ReaderAuthPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function ReaderAuthPage({
  searchParams,
}: ReaderAuthPageProps) {
  const { next } = await searchParams;
  return <ReaderAuthForm mode="recover" nextPath={next} />;
}
