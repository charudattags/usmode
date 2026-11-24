"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Splash } from "@/components/onboarding/Onboarding";
import { finishSpotifyLogin } from "@/lib/spotify";

export default function SpotifyCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState(null, "", "/spotify-callback");
    finishSpotifyLogin(params)
      .then(() => router.replace("/rooms?r=jam"))
      .catch((e: Error) => setError(e.message));
  }, [router]);
  if (error)
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p>{error}</p>
        <a className="font-semibold text-primary" href="/rooms?r=jam">
          Back to the Jam room
        </a>
      </main>
    );
  return <Splash />;
}
