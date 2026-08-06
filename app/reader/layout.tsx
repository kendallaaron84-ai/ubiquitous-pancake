export default function ReaderLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#111a34] px-4 py-10 text-white">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
