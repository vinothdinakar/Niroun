import { DealDetailView } from '@bond/console-core/components/deal-detail-view';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealDetailView id={id} />;
}
