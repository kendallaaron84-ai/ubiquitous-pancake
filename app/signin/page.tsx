import AuthForm from "@/components/section/auth/AuthForm"

export default function SignInPage() {
  return (
    <main className="flex min-h-screen justify-center overflow-y-auto bg-background px-4 py-6 text-foreground">
      <div className="my-auto w-full max-w-md">
        <AuthForm currentState="signin" />
      </div>
    </main>
  )
}
