import { DashboardRouteChrome } from '../../components/layout/DashboardRouteChrome';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return <DashboardRouteChrome scope="super-admin">{children}</DashboardRouteChrome>;
}
