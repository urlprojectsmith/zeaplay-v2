import { DashboardRouteChrome } from '../../components/layout/DashboardRouteChrome';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <DashboardRouteChrome scope="workspace">{children}</DashboardRouteChrome>;
}
