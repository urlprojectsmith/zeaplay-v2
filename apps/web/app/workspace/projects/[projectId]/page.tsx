import { WorkspaceProjectDetailPage } from '../../../../components/workspace/projects/WorkspaceProjectsPage';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <WorkspaceProjectDetailPage projectId={projectId} />;
}
