import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PickupConfirmation } from "@/components/pickup/PickupConfirmation";

// Stripe Checkout `success_url` target: /pickup/{tenantSlug}/success?orderId=...
// The order itself may not be marked "tendered" yet at this point — Stripe
// confirms payment asynchronously via app/api/stripe/webhook/route.ts — so
// the actual confirmation UI polls client-side (see PickupConfirmation).

export default async function PickupSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { tenantSlug } = await params;
  const { orderId } = await searchParams;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });
  if (!tenant || !orderId) {
    notFound();
  }

  return <PickupConfirmation tenantSlug={tenantSlug} orderId={orderId} />;
}
