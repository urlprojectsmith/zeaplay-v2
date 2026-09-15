import { RoleLayout } from '../../components/dashboards/role-layout';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <RoleLayout roleName="Super Admin">{children}</RoleLayout>;
}
