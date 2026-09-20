import { WorkspaceTicketDetailPage } from '../../../../components/workspace/tickets/WorkspaceTicketsPage';

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return <WorkspaceTicketDetailPage ticketId={ticketId} />;
}
