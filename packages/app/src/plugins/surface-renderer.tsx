import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useMemo, type ComponentType } from "react";
import { Platform } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { usePluginHostNavigation } from "./host-navigation";
import { PluginRuntimeBoundary } from "./runtime-boundary";
import { SurfaceErrorBoundary } from "./surface-error-boundary";
import { toPluginTheme } from "./theme";
import type { InstalledPlugin } from "./types";

const pluginThemeMapping = (theme: Theme) => ({
  theme: toPluginTheme(theme),
});

function resolvePluginSurfacePlatform(): PluginSurfaceProps["layout"]["platform"] {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

function SurfaceRenderer({
  Surface,
  client,
  plugin,
  layout,
  host,
  theme,
}: {
  Surface: ComponentType<PluginSurfaceProps>;
  client: DaemonClient;
  plugin: InstalledPlugin;
  layout: PluginSurfaceProps["layout"];
  host: PluginSurfaceProps["host"];
  theme: PluginTheme;
}) {
  const navigation = usePluginHostNavigation(host.id);
  return (
    <PluginRuntimeBoundary plugin={plugin} client={client}>
      <Surface theme={theme} host={host} layout={layout} navigation={navigation} />
    </PluginRuntimeBoundary>
  );
}

const ThemedSurfaceRenderer = withUnistyles(SurfaceRenderer);

export function PluginSurfaceMount({
  plugin,
  Surface,
  client,
  hostId,
  hostLabel,
  compact,
  sidebar = false,
}: {
  plugin: InstalledPlugin;
  Surface: ComponentType<PluginSurfaceProps>;
  client: DaemonClient;
  hostId: string;
  hostLabel: string;
  compact: boolean;
  sidebar?: boolean;
}) {
  const platform = resolvePluginSurfacePlatform();
  const layout = useMemo(
    () => (sidebar ? { compact, platform, sidebar: true } : { compact, platform }),
    [compact, platform, sidebar],
  );
  const host = useMemo(() => ({ id: hostId, label: hostLabel }), [hostId, hostLabel]);
  return (
    <SurfaceErrorBoundary installation={plugin} Surface={Surface}>
      <ThemedSurfaceRenderer
        Surface={Surface}
        client={client}
        plugin={plugin}
        host={host}
        layout={layout}
        uniProps={pluginThemeMapping}
      />
    </SurfaceErrorBoundary>
  );
}
