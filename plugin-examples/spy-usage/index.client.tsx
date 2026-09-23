import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext, PluginSidebarContribution } from "@getpaseo/plugin/client";
import { UsageSurface } from "./client/surface";

const SURFACE_ID = "usage";

const sidebarItem = {
  id: "usage",
  title: "Plan usage",
  icon: "Gauge",
  surface: SURFACE_ID,
  placement: "inline",
} satisfies PluginSidebarContribution & { placement: "inline" };

export default function contribute(client: PluginClientContext): PluginCleanup {
  const removeSurface = client.addSurface(SURFACE_ID, UsageSurface);
  const removeSidebar = client.addSidebarItem(sidebarItem);
  const removeCommand = client.addCommandCenterItem({
    id: "open-usage",
    title: "Open plan usage",
    keywords: ["usage", "quota", "plan", "claude", "cursor"],
    icon: "Gauge",
    context: "global",
    onSelect: (context) => {
      context.openSurface(SURFACE_ID);
    },
  });
  return () => {
    removeCommand();
    removeSidebar();
    removeSurface();
  };
}
