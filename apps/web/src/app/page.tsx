import { APP_NAME } from "@sla-monitoring/shared";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col items-center justify-center gap-4 px-8 py-32 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {APP_NAME}
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          SLA Monitoring Dashboard — workspace foundation is up.
        </p>
      </main>
    </div>
  );
}
