import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AttachedBranchControl } from "@/components/attached-branch-control";
import { BranchSwitcher } from "@/components/branch-switcher";
import { useWorkspaceFields } from "@/stores/session-store-hooks";

// The workspace's branch, shown under the chat composer. Reads the live branch from the
// workspace descriptor, so it follows checkouts made anywhere, not only from this bar.
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
      <BranchSwitcher
        currentBranchName={fields.currentBranch}
        serverId={serverId}
        workspaceId={fields.id}
        workspaceDirectory={fields.workspaceDirectory}
        isGitCheckout
        desktopPlacement="top-start"
        testID="composer-branch-switcher"
      />
      <AttachedBranchControl
        compact
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
