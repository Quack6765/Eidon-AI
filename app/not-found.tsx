import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-7 px-6 py-10 bg-[var(--background)]">
      <p
        className="text-[clamp(4.5rem,20vw,8rem)] leading-none text-foreground/90 select-none"
        style={{ fontFamily: "var(--font-display), Georgia, serif" }}
      >
        404
      </p>
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <h1 className="text-lg font-semibold text-foreground">Page not found</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
      </div>
      <Button asChild size="lg" className="h-11 px-6">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
