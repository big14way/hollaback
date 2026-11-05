import { Transcript } from "@/components/Transcript";

export default async function CartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Transcript id={id} />;
}
