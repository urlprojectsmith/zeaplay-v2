import { RoleLayout } from '../../components/dashboards/role-layout';

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  return <RoleLayout roleName="Agency">{children}</RoleLayout>;
}
