import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { DatabasesScreen } from "@/screens/databases-screen";

export default function DatabasesRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <DatabasesScreen />
    </HostRouteBootstrapBoundary>
  );
}
