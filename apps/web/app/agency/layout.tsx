import { DashboardRouteChrome } from '../../components/layout/DashboardRouteChrome';

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  return <DashboardRouteChrome scope="agency">{children}</DashboardRouteChrome>;
}
