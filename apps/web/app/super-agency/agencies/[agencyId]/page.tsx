import { SuperAgencyAgencyDetailPage } from '../../../../components/super-agency/SuperAgencyPages';

export default async function SuperAgencyAgencyDetailRoute({
  params,
}: {
  params: Promise<{ agencyId: string }>;
}) {
  const { agencyId } = await params;

  return <SuperAgencyAgencyDetailPage agencyId={agencyId} />;
}
