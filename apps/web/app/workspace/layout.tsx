import { RoleLayout } from '../../components/dashboards/role-layout';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <RoleLayout roleName="Workspace">{children}</RoleLayout>;
}
