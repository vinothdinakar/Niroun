import { AgentDetailView } from '@bond/console-core/components/agent-detail-view';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentDetailView id={id} />;
}
