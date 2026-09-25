import { router, usePathname } from "expo-router";
import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { resolvePluginIcon } from "./icons";
import { buildPluginSurfaceRoute, hostIdFromPathname } from "./routes";
import {
  getPreferredPluginContributionHost,
  rememberPluginContributionHost,
} from "./contribution-host";
import { type PluginSidebarGroup, type PluginSidebarTarget } from "./sidebar-groups";
import { PluginSurfaceMount } from "./surface-renderer";

function selectTarget(
  group: PluginSidebarGroup,
  currentHostId: string | null,
): PluginSidebarTarget {
  const current = group.targets.find((target) => target.plugin.serverId === currentHostId);
  if (current) return current;
  const rememberedHostId = getPreferredPluginContributionHost(group.key);
  const remembered = group.targets.find((target) => target.plugin.serverId === rememberedHostId);
  return remembered ?? group.targets[0];
}

function PluginSidebarInlineSurface({
  group,
  target,
}: {
  group: PluginSidebarGroup;
  target: PluginSidebarTarget;
}) {
  const compact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(target.plugin.serverId);
  const hosts = useHosts();
  const hostLabel =
    hosts.find((host) => host.serverId === target.plugin.serverId)?.label ?? target.plugin.serverId;
  const surface = target.plugin.surfaces.find((item) => item.id === target.item.surface);
  const testID = `plugin-sidebar-${group.pluginId}-${group.contributionId}`;

  if (!surface) return null;
  if (!client) {
    return (
      <Text style={styles.offline} testID={testID}>
        Plugin host is offline.
      </Text>
    );
  }

  return (
    <View style={styles.inline} testID={testID}>
      <PluginSurfaceMount
        plugin={target.plugin}
        Surface={surface.Component}
        client={client}
        hostId={target.plugin.serverId}
        hostLabel={hostLabel}
        compact={compact}
        sidebar
      />
    </View>
  );
}

export function PluginSidebarItemRow({
  group,
  onBeforeNavigate,
}: {
  group: PluginSidebarGroup;
  onBeforeNavigate?: () => void;
}) {
  const pathname = usePathname();
  const target = selectTarget(group, hostIdFromPathname(pathname));
  const route = buildPluginSurfaceRoute(target.plugin.serverId, group.pluginId, {
    kind: "sidebar",
    id: group.contributionId,
  });
  const isActive = group.targets.some(
    (candidate) =>
      pathname ===
      buildPluginSurfaceRoute(candidate.plugin.serverId, group.pluginId, {
        kind: "sidebar",
        id: group.contributionId,
      }),
  );
  const navigate = useCallback(() => {
    rememberPluginContributionHost(group.key, target.plugin.serverId);
    onBeforeNavigate?.();
    router.push(route);
  }, [group.key, onBeforeNavigate, route, target.plugin.serverId]);

  if (target.item.placement === "inline") {
    return <PluginSidebarInlineSurface group={group} target={target} />;
  }

  return (
    <SidebarHeaderRow
      icon={resolvePluginIcon(group.icon)}
      label={group.title}
      onPress={navigate}
      isActive={isActive}
      testID={`plugin-sidebar-${group.pluginId}-${group.contributionId}`}
      variant="compact"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  inline: {
    width: "100%",
    flexGrow: 0,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  offline: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
}));
