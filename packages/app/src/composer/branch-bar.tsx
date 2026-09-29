import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AttachedBranchControl } from "@/components/attached-branch-control";
import { useWorkspaceFields } from "@/stores/session-store-hooks";

// The workspace's attached branch, shown under the chat composer. It offers only workspace
// actions — attach, detach, check out the attached branch. Switching to any other branch
// changes the project directory for every workspace, so that lives on the project row.
export const WorkspaceBranchBar = memo(function WorkspaceBranchBar({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement | null {
  const fields = useWorkspaceFields(serverId, workspaceId, (workspace) => ({
    id: workspace.id,
    workspaceDirectory: workspace.workspaceDirectory,
    currentBranch: workspace.gitRuntime?.currentBranch ?? null,
  }));

  if (!fields?.workspaceDirectory || !fields.currentBranch) {
    return null;
  }

  return (
    <View style={styles.row} testID="composer-branch-bar">
      <AttachedBranchControl
        compact
        labeled
        currentBranchName={fields.currentBranch}
        serverId={serverId}
        workspaceId={fields.id}
        workspaceDirectory={fields.workspaceDirectory}
      />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
    // Pulls the row toward the composer box; the content column's gap is sized for blocks.
    marginTop: -theme.spacing[2],
  },
}));
