import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useFetchQuery } from "@/data/query";
import { describeReleaseLine, describeReleaseWarning } from "@/databases/project-databases";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * Branch, code release and database release of a SPY project, with a warning when migrations
 * are due or the database is ahead of the code. Keyed on the database name, so a change of
 * database loads the status again.
 */
export function DatabaseReleaseStatus({
  serverId,
  projectId,
  databaseName,
}: {
  serverId: string;
  projectId: string;
  databaseName: string;
}): ReactElement | null {
  const supported = useHostFeature(serverId, "projectDatabaseStatus");
  const client = useHostRuntimeClient(serverId);
  const status = useFetchQuery({
    queryKey: ["projectDatabaseStatus", serverId, projectId, databaseName],
    enabled: supported && client !== null,
    dataShape: "value",
    staleTimeMs: 60_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      return client.getProjectDatabaseStatus({ projectId });
    },
  });

  if (!supported) return null;
  if (status.isPending) {
    return <Text style={styles.line}>Reading branch and releases…</Text>;
  }
  if (status.error || !status.data) {
    return <Text style={styles.warning}>{toErrorMessage(status.error)}</Text>;
  }
  const warning = describeReleaseWarning(status.data);
  return (
    <View style={styles.stack} testID={`databases-release-${projectId}`}>
      <Text style={styles.line} numberOfLines={1}>
        {describeReleaseLine(status.data)}
      </Text>
      {warning ? <Text style={styles.warning}>{warning}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  line: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
}));
