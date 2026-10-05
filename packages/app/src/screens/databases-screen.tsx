import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { Database } from "lucide-react-native";
import equal from "fast-deep-equal";
import { StyleSheet } from "react-native-unistyles";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { DatabaseChangeControl } from "@/components/databases/database-change-control";
import { DatabaseReleaseStatus } from "@/components/databases/database-release-status";
import { MenuHeader } from "@/components/headers/menu-header";
import { FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  buildProjectDatabaseList,
  parseDatabaseFilter,
  type ProjectDatabaseList,
  type ProjectDatabaseRow,
} from "@/databases/project-databases";
import { useProjects } from "@/hooks/use-projects";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";

export function DatabasesScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <DatabasesScreenContent />;
}

function DatabasesScreenContent(): ReactElement {
  // Holds the directory demand for every host, so the workspaces the list reads stay loaded.
  const { isLoading, hostErrors } = useProjects();
  const hosts = useHosts();
  const selector = useMemo(
    () => (state: ReturnType<typeof useSessionStore.getState>) =>
      buildProjectDatabaseList(
        hosts.map((host) => ({
          serverId: host.serverId,
          serverName: host.label,
          projects: Array.from(state.sessions[host.serverId]?.projects.values() ?? []),
          workspaces: Array.from(state.sessions[host.serverId]?.workspaces.values() ?? []),
        })),
      ),
    [hosts],
  );
  const list = useStoreWithEqualityFn(useSessionStore, selector, equal);
  const showServerName = hosts.length > 1;
  const isEmpty = list.withDatabase.length === 0 && list.withoutDatabase.length === 0;
  // Applied on submit or blur, not per keystroke: each change refetches every open list.
  const [filterDraft, setFilterDraft] = useState("");
  const [namePrefix, setNamePrefix] = useState<string | null>(null);
  const applyFilter = useCallback(
    () => setNamePrefix(parseDatabaseFilter(filterDraft)),
    [filterDraft],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title="Databases" />
      {isLoading && isEmpty ? (
        <View style={styles.centered}>
          <LoadingSpinner size="large" color={styles.spinner.color} />
        </View>
      ) : (
        <DatabasesList
          list={list}
          showServerName={showServerName}
          hostErrors={hostErrors}
          namePrefix={namePrefix}
          onFilterChange={setFilterDraft}
          onFilterApply={applyFilter}
        />
      )}
    </View>
  );
}

function DatabaseFilter({
  onChange,
  onApply,
}: {
  onChange: (text: string) => void;
  onApply: () => void;
}): ReactElement {
  return (
    <View style={styles.filter}>
      <Text style={settingsStyles.sectionHeaderTitle}>Database filter</Text>
      <FormTextInput
        size="sm"
        initialValue=""
        placeholder="test_<initials>_ of each project"
        onChangeText={onChange}
        onSubmitEditing={onApply}
        onBlur={onApply}
        autoCapitalize="none"
        autoCorrect={false}
        testID="databases-filter"
      />
      <Text style={settingsStyles.rowHint}>
        {
          "The list under Change shows databases that start with this. Leave it empty for each project's own test_<initials>_, or type * for all."
        }
      </Text>
    </View>
  );
}

function DatabasesList({
  list,
  showServerName,
  hostErrors,
  namePrefix,
  onFilterChange,
  onFilterApply,
}: {
  list: ProjectDatabaseList;
  showServerName: boolean;
  hostErrors: ReturnType<typeof useProjects>["hostErrors"];
  namePrefix: string | null;
  onFilterChange: (text: string) => void;
  onFilterApply: () => void;
}): ReactElement {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      testID="databases-list"
    >
      {list.withDatabase.length > 0 ? (
        <DatabaseFilter onChange={onFilterChange} onApply={onFilterApply} />
      ) : null}
      {hostErrors.map((error) => (
        <Text key={error.serverId} style={styles.hostError}>
          {`${error.serverName}: Could not load projects`}
        </Text>
      ))}
      {list.withDatabase.length > 0 ? (
        <View style={settingsStyles.section}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderTitle}>Projects with a database</Text>
          </View>
          <View style={settingsStyles.card} testID="databases-with-database">
            {list.withDatabase.map((row, index) => (
              <DatabaseRow
                key={row.key}
                row={row}
                isFirst={index === 0}
                showServerName={showServerName}
                namePrefix={namePrefix}
              />
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.emptyState} testID="databases-empty">
          <Database size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
          <Text style={styles.emptyTitle}>No project databases found</Text>
          <Text style={styles.emptyDescription}>
            A project shows here when its root has a config/config.inc.xml with a
            SYSTEM_MYSQL_DATABASE value.
          </Text>
        </View>
      )}
      {list.withoutDatabase.length > 0 ? (
        <View style={settingsStyles.section}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderTitle}>No database</Text>
          </View>
          <View style={settingsStyles.card} testID="databases-without-database">
            {list.withoutDatabase.map((row, index) => (
              <DatabaseRow
                key={row.key}
                row={row}
                isFirst={index === 0}
                showServerName={showServerName}
                namePrefix={namePrefix}
              />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function DatabaseRow({
  row,
  isFirst,
  showServerName,
  namePrefix,
}: {
  row: ProjectDatabaseRow;
  isFirst: boolean;
  showServerName: boolean;
  namePrefix: string | null;
}): ReactElement {
  const location = showServerName
    ? `${row.serverName} · ${row.projectRootPath}`
    : row.projectRootPath;

  return (
    <View
      style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder]}
      testID={`databases-row-${row.key}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {row.projectName}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {location}
        </Text>
        {row.sharedWithCount > 0 ? (
          <Text style={styles.sharedWarning}>
            {row.sharedWithCount === 1
              ? "Another project uses this database"
              : `${row.sharedWithCount} other projects use this database`}
          </Text>
        ) : null}
        {row.databaseName ? (
          <DatabaseReleaseStatus
            serverId={row.serverId}
            projectId={row.projectId}
            databaseName={row.databaseName}
          />
        ) : null}
        {row.databaseName ? (
          <DatabaseChangeControl
            serverId={row.serverId}
            projectId={row.projectId}
            projectName={row.projectName}
            currentName={row.databaseName}
            namePrefix={namePrefix}
          />
        ) : null}
      </View>
      {row.databaseName ? (
        <Text style={styles.databaseName} selectable numberOfLines={1}>
          {row.databaseName}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing[6],
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  filter: {
    gap: theme.spacing[2],
    marginBottom: theme.spacing[6],
    maxWidth: 420,
  },
  hostError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[3],
  },
  databaseName: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    maxWidth: "50%",
  },
  sharedWarning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  emptyState: {
    alignItems: "center",
    alignSelf: "center",
    gap: theme.spacing[3],
    maxWidth: 420,
    paddingVertical: theme.spacing[6],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  // Static color holders read by the spinner and icon; keeps the muted token without
  // useUnistyles (banned in new code).
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
    width: theme.iconSize.lg,
  },
}));
