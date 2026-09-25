import { DashboardRouteChrome } from '../../components/layout/DashboardRouteChrome';

export default function SuperAgencyLayout({ children }: { children: React.ReactNode }) {
  return <DashboardRouteChrome scope="super-agency">{children}</DashboardRouteChrome>;
}
