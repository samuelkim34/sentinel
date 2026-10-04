import { getEnv } from "../../server/env";
export const dynamic = "force-dynamic";
export default function DownloadPage() {
  const repository = getEnv().SOURCE_REPOSITORY_URL;
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
    <h1 className="text-3xl font-semibold">Sentinel source</h1>
    <p className="mt-3">Source downloads come from the configured GitHub repository. After extracting, use Node 24 and run npm ci, npm run setup, then npm run dev.</p>
    {repository ? <a className="mt-6 underline" href={repository}>Open source on GitHub</a> : <p className="mt-3">The server operator has not configured SOURCE_REPOSITORY_URL yet.</p>}
    {repository && <a className="mt-3 underline" href="/api/source.zip">Download source ZIP</a>}
  </main>;
}
