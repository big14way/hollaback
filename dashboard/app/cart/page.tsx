"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Transcript } from "@/components/Transcript";

/** /cart/?id=<cartId>. A query parameter (not a path segment) so the dashboard can be a static export. */
function CartFromQuery() {
  const id = useSearchParams().get("id");
  if (!id) {
    return (
      <div className="transcript-page">
        <Link href="/" className="back">
          ← All carts
        </Link>
        <p className="muted">No cart selected.</p>
      </div>
    );
  }
  return <Transcript id={id} />;
}

export default function CartPage() {
  return (
    <Suspense fallback={null}>
      <CartFromQuery />
    </Suspense>
  );
}
