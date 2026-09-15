import { RoleLayout } from '../../components/dashboards/role-layout';

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return <RoleLayout roleName="Developer Console">{children}</RoleLayout>;
}
