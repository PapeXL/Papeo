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
    return detachButton;
  }

  return (
    <>
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger
          testID="changes-checkout-attached-branch"
          accessibilityRole="button"
          accessibilityLabel={t("branchSwitcher.checkoutAttached", { branchName: attachedBranch })}
          onPress={handleCheckout}
          style={toolbarLabelTriggerStyle}
        >
          {(state) => {
            const highlighted = isToolbarLabelTriggerHighlighted(state);
            return (
              <>
                <ToolbarLabelTriggerIcon>
                  <ThemedGitBranch size={14} uniProps={warningIconColorMapping} />
                </ToolbarLabelTriggerIcon>
                <Text numberOfLines={1} style={toolbarLabelTriggerTextStyle(highlighted)}>
                  {t("branchSwitcher.checkoutAttached", { branchName: attachedBranch })}
                </Text>
              </>
            );
          }}
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>
            {t("branchSwitcher.checkoutAttachedTooltip", { branchName: attachedBranch })}
          </Text>
        </TooltipContent>
      </Tooltip>
      {detachButton}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
  },
}));
