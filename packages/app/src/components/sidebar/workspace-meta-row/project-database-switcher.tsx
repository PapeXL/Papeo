import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Database, TriangleAlert } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HOST_BADGE_ICON_SIZE } from "@/hosts/host-badge";
import { useFetchQuery } from "@/data/query";
import {
  analyzeDatabaseFit,
  describeDatabaseChange,
  describeDatabaseOption,
  describeDatabaseSwitch,
  describeReleaseWarning,
} from "@/databases/project-databases";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";

const ThemedDatabase = withUnistyles(Database);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const warningMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const dangerMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

/** The project a database line belongs to; the switch acts on the project's own directory. */
export interface ProjectDatabaseTarget {
  serverId: string;
  projectId: string;
  projectName: string;
  databaseName: string;
}

/**
 * The project's database, drawn under the project name and pressable to switch it, like the
 * branch line below it. The picker lists the databases the server has, each with its release
 * and whether it fits the checked-out code; choosing one shows what migrations a switch would
 * need before anything changes. A mark on the line keeps saying so after the switch.
 *
 * Queries share their keys with the Databases page, so the two views read one cache.
 */
export function ProjectDatabaseSwitcher({ target }: { target: ProjectDatabaseTarget }) {
  const { serverId, projectId, projectName, databaseName } = target;
  const anchorRef = useRef<View>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const client = useHostRuntimeClient(serverId);
  const canSet = useHostFeature(serverId, "projectDatabaseSet");
  const canList = useHostFeature(serverId, "projectDatabaseList");
  const canStatus = useHostFeature(serverId, "projectDatabaseStatus");
  const toast = useToast();
  const queryClient = useQueryClient();

  const status = useFetchQuery({
    queryKey: ["projectDatabaseStatus", serverId, projectId, databaseName],
    enabled: canStatus && client !== null,
    dataShape: "value",
    staleTimeMs: 60_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      return client.getProjectDatabaseStatus({ projectId });
    },
  });
  const databases = useFetchQuery({
    queryKey: ["projectDatabases", serverId, projectId, null],
    enabled: isOpen && canList && client !== null,
    dataShape: "value",
    staleTimeMs: 30_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      return client.listProjectDatabases({ projectId, namePrefix: null });
    },
  });

  const releaseByName = useMemo(
    () => new Map((databases.data?.releases ?? []).map((entry) => [entry.name, entry.release])),
    [databases.data],
  );
  const options = useMemo<ComboboxOption[]>(
    () =>
      (databases.data?.databases ?? []).map((name) => {
        const release = releaseByName.get(name) ?? null;
        const fit = analyzeDatabaseFit({
          upgradeReleases: databases.data?.upgradeReleases ?? [],
          databaseRelease: release,
        });
        return { id: name, label: name, description: describeDatabaseOption(release, fit) };
      }),
    [databases.data, releaseByName],
  );

  const handleSelect = useCallback(
    (chosen: string) => {
      setIsOpen(false);
      // No "already current" shortcut: the shown name can be stale when the config changed
      // behind Paseo, and the daemon writes nothing when the file already has this value.
      if (!client) return;
      const upgradeReleases = databases.data?.upgradeReleases ?? [];
      const databaseRelease = releaseByName.get(chosen) ?? null;
      const prompt = describeDatabaseSwitch({
        projectName,
        databaseName: chosen,
        databaseRelease,
        upgradeReleases,
        fit: analyzeDatabaseFit({ upgradeReleases, databaseRelease }),
      });
      void (async () => {
        const confirmed = await confirmDialog({
          title: prompt.title,
          message: prompt.message,
          confirmLabel: prompt.confirmLabel,
        });
        if (!confirmed) return;
        setSwitchingTo(chosen);
        try {
          const outcome = await client.setProjectDatabase({ projectId, databaseName: chosen });
          toast.show(describeDatabaseChange(outcome).text);
          await queryClient.invalidateQueries({ queryKey: ["projectDatabaseStatus", serverId] });
        } catch (error) {
          toast.error(toErrorMessage(error));
        } finally {
          setSwitchingTo(null);
        }
      })();
    },
    [client, databases.data, projectId, projectName, queryClient, releaseByName, serverId, toast],
  );

  const handlePress = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    setIsOpen(true);
  }, []);
  const stopPropagation = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  const warning = status.data ? describeReleaseWarning(status.data) : null;
  const warningMapping_ = status.data?.state === "database_ahead" ? dangerMapping : warningMapping;
  const label = switchingTo ? `Switching to ${switchingTo}…` : databaseName;
  const active = isHovered || isOpen;

  if (!canSet || !canList) {
    return (
      <View style={styles.item} testID="sidebar-project-database">
        <ThemedDatabase size={HOST_BADGE_ICON_SIZE} uniProps={mutedMapping} />
        <Text style={styles.text} numberOfLines={1}>
          {databaseName}
        </Text>
      </View>
    );
  }

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Database ${databaseName}. Press to switch.`}
          hitSlop={4}
          disabled={switchingTo !== null}
          onPressIn={stopPropagation}
          onPress={handlePress}
          onHoverIn={handleHoverIn}
          onHoverOut={handleHoverOut}
          style={styles.item}
          testID="sidebar-project-database"
        >
          <ThemedDatabase
            size={HOST_BADGE_ICON_SIZE}
            uniProps={active ? foregroundMapping : mutedMapping}
          />
          <Text style={active ? styles.textHovered : styles.text} numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
        {warning && !switchingTo ? (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <View
                accessibilityLabel={warning}
                style={styles.mark}
                testID="sidebar-project-database-warning"
              >
                <ThemedTriangleAlert size={HOST_BADGE_ICON_SIZE} uniProps={warningMapping_} />
              </View>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" offset={6}>
              <Text style={styles.tooltipText}>{warning}</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </View>
      <Combobox
        options={options}
        value={databaseName}
        onSelect={handleSelect}
        searchable
        placeholder="Database"
        searchPlaceholder="Search databases"
        emptyText={pickerEmptyText(databases)}
        title="Switch database"
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopPreventInitialFlash
        desktopMinWidth={360}
      />
    </View>
  );
}

/** What the picker says while it has no rows: loading, the error, or an empty server. */
function pickerEmptyText(query: { isPending: boolean; error: unknown }): string {
  if (query.isPending) return "Loading databases from the server…";
  if (query.error) return toErrorMessage(query.error);
  return "No databases found";
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    flexShrink: 1,
    minWidth: 0,
    alignSelf: "flex-start",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: 0,
    flexShrink: 1,
  },
  mark: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 1,
  },
  textHovered: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 1,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
