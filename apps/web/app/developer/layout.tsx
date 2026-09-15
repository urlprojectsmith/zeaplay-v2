import { DashboardRouteChrome } from '../../components/layout/DashboardRouteChrome';

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return <DashboardRouteChrome scope="developer">{children}</DashboardRouteChrome>;
}
