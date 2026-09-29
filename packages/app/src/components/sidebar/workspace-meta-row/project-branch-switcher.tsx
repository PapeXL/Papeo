import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { GitBranch } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { Combobox } from "@/components/ui/combobox";
import { HOST_BADGE_ICON_SIZE } from "@/hosts/host-badge";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useBranchSwitcher } from "@/hooks/use-branch-switcher";
import type { ProjectCheckoutBranch } from "./project-branch";

const ThemedGitBranch = withUnistyles(GitBranch);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * The project directory's branch, drawn as the last line of the project header and pressable to
 * switch it. The switch lives here, not on a workspace, because the checkout belongs to the
 * directory: every workspace of the project sees the new branch at once.
 *
 * Local hover state is safe for the same reason as the change request item in `index.tsx`: it
 * never leaves this Pressable and nothing pressable is nested inside it. The press stops
 * propagation so it does not also collapse the project.
 */
export function ProjectBranchSwitcher({ branch }: { branch: ProjectCheckoutBranch }) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [isHovered, setIsHovered] = useState(false);
  const client = useHostRuntimeClient(branch.serverId);
  const isConnected = useHostRuntimeIsConnected(branch.serverId);
  const toast = useToast();
  const queryClient = useQueryClient();

  const { branchOptions, isOpen, setIsOpen, handleBranchSelect } = useBranchSwitcher({
    client,
    normalizedServerId: branch.serverId,
    normalizedWorkspaceId: branch.workspaceId,
    workspaceDirectory: branch.workspaceDirectory,
    currentBranchName: branch.branchName,
    isGitCheckout: true,
    isConnected,
    toast,
    queryClient,
  });

  const stopPropagation = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      setIsOpen(true);
    },
    [setIsOpen],
  );
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("branchSwitcher.projectBranch", { branchName: branch.branchName })}
        hitSlop={4}
        onPressIn={stopPropagation}
        onPress={handlePress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={styles.item}
        testID="sidebar-project-branch"
      >
        <ThemedGitBranch
          size={HOST_BADGE_ICON_SIZE}
          uniProps={isHovered || isOpen ? foregroundMapping : mutedMapping}
        />
        <Text style={isHovered || isOpen ? styles.textHovered : styles.text} numberOfLines={1}>
          {branch.branchName}
        </Text>
      </Pressable>
      <Combobox
        options={branchOptions}
        value={branch.branchName}
        onSelect={handleBranchSelect}
        searchable
        placeholder={t("branchSwitcher.placeholder")}
        searchPlaceholder={t("branchSwitcher.searchPlaceholder")}
        emptyText={t("branchSwitcher.empty")}
        title={t("branchSwitcher.title")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopPreventInitialFlash
        desktopMinWidth={280}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    flexShrink: 1,
    minWidth: 0,
    alignSelf: "flex-start",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: 0,
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
}));
