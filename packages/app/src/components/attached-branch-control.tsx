import { useCallback, useRef } from "react";
import { Text } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Link2, Unlink } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import {
  isToolbarLabelTriggerHighlighted,
  ToolbarLabelTriggerIcon,
  toolbarLabelTriggerTextStyle,
  toolbarLabelTriggerStyle,
} from "@/components/ui/toolbar-label-trigger";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useToast } from "@/contexts/toast-context";
import { useBranchSwitcher } from "@/hooks/use-branch-switcher";

interface AttachedBranchControlProps {
  compact: boolean;
  currentBranchName: string | null;
  serverId: string;
  workspaceId: string | null;
  workspaceDirectory: string;
  /** Names the branch next to the icon. For places that do not already show the branch. */
  labeled?: boolean;
}

const accentIconColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const warningIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const ThemedLink2 = withUnistyles(Link2);
const ThemedUnlink = withUnistyles(Unlink);
const ThemedGitBranch = withUnistyles(GitBranch);

// The attached branch is intent stored on the workspace; the live branch is whatever
// git has checked out in the directory. Several workspaces can share one directory,
// so they drift apart. This control shows the drift and offers the checkout, which
// runs through the branch switcher so the stash prompt for uncommitted work applies.
export function AttachedBranchControl({
  compact,
  currentBranchName,
  serverId,
  workspaceId,
  workspaceDirectory,
  labeled = false,
}: AttachedBranchControlProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const queryClient = useQueryClient();
  const canAttach = useHostFeature(serverId, "workspaceAttachedBranch");
  const fields = useWorkspaceFields(serverId, workspaceId, (workspace) => ({
    id: workspace.id,
    attachedBranch: workspace.attachedBranch ?? null,
  }));
  const pendingRef = useRef(false);

  const { handleBranchSelect } = useBranchSwitcher({
    client,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId ?? workspaceDirectory,
    workspaceDirectory,
    currentBranchName,
    isGitCheckout: true,
    isConnected,
    toast,
    queryClient,
  });

  const mutation = useMutation({
    mutationFn: async (input: { workspaceId: string; branch: string | null }) => {
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      await client.setWorkspaceAttachedBranch(input.workspaceId, input.branch);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("branchSwitcher.failedToAttach"));
    },
    onSettled: () => {
      pendingRef.current = false;
    },
  });
  const mutate = mutation.mutate;

  const setAttachedBranch = useCallback(
    (branch: string | null) => {
      if (!fields || pendingRef.current) return;
      pendingRef.current = true;
      mutate({ workspaceId: fields.id, branch });
    },
    [fields, mutate],
  );

  const attachedBranch = fields?.attachedBranch ?? null;
  const handleAttach = useCallback(
    () => setAttachedBranch(currentBranchName),
    [currentBranchName, setAttachedBranch],
  );
  const handleDetach = useCallback(() => setAttachedBranch(null), [setAttachedBranch]);
  const handleCheckout = useCallback(() => {
    if (attachedBranch) handleBranchSelect(attachedBranch);
  }, [attachedBranch, handleBranchSelect]);

  if (!canAttach || !fields || !currentBranchName) {
    return null;
  }

  const iconSize = paneContentToolbarIconSize(compact);

  if (!attachedBranch && labeled) {
    return (
      <LabelButton
        testID="changes-attach-branch"
        label={t("branchSwitcher.attachLabel")}
        tooltip={t("branchSwitcher.attach", { branchName: currentBranchName })}
        icon={ThemedLink2}
        iconColor={extraMutedIconColorMapping}
        onPress={handleAttach}
      />
    );
  }

  if (!attachedBranch) {
    return (
      <ToolbarButton
        compact={compact}
        label={t("branchSwitcher.attach", { branchName: currentBranchName })}
        onPress={handleAttach}
        disabled={mutation.isPending}
        testID="changes-attach-branch"
      >
        <ThemedLink2 size={iconSize} strokeWidth={1.5} uniProps={extraMutedIconColorMapping} />
      </ToolbarButton>
    );
  }

  const detachButton = (
    <ToolbarButton
      compact={compact}
      label={t("branchSwitcher.detach", { branchName: attachedBranch })}
      onPress={handleDetach}
      disabled={mutation.isPending}
      testID="changes-detach-branch"
    >
      {attachedBranch === currentBranchName ? (
        <ThemedLink2 size={iconSize} strokeWidth={1.5} uniProps={accentIconColorMapping} />
      ) : (
        <ThemedUnlink size={iconSize} strokeWidth={1.5} uniProps={extraMutedIconColorMapping} />
      )}
    </ToolbarButton>
  );

  if (attachedBranch === currentBranchName) {
    return labeled ? (
      <LabelButton
        testID="changes-detach-branch"
        label={attachedBranch}
        tooltip={t("branchSwitcher.detach", { branchName: attachedBranch })}
        icon={ThemedLink2}
        iconColor={accentIconColorMapping}
        onPress={handleDetach}
      />
    ) : (
      detachButton
    );
  }

  return (
    <>
      <LabelButton
        testID="changes-checkout-attached-branch"
        label={t("branchSwitcher.checkoutAttached", { branchName: attachedBranch })}
        tooltip={t("branchSwitcher.checkoutAttachedTooltip", { branchName: attachedBranch })}
        icon={ThemedGitBranch}
        iconColor={warningIconColorMapping}
        onPress={handleCheckout}
      />
      {detachButton}
    </>
  );
}

function LabelButton({
  label,
  tooltip,
  icon: Icon,
  iconColor,
  onPress,
  testID,
}: {
  label: string;
  tooltip: string;
  icon: typeof ThemedLink2 | typeof ThemedGitBranch;
  iconColor: (theme: Theme) => { color: string };
  onPress: () => void;
  testID: string;
}) {
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={tooltip}
        onPress={onPress}
        style={toolbarLabelTriggerStyle}
      >
        {(state) => (
          <>
            <ToolbarLabelTriggerIcon>
              <Icon size={14} uniProps={iconColor} />
            </ToolbarLabelTriggerIcon>
            <Text
              numberOfLines={1}
              style={toolbarLabelTriggerTextStyle(isToolbarLabelTriggerHighlighted(state))}
            >
              {label}
            </Text>
          </>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
  },
}));
