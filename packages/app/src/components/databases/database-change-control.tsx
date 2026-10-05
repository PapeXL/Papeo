import { useCallback, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useFetchQuery } from "@/data/query";
import {
  analyzeDatabaseFit,
  describeDatabaseChange,
  describeDatabaseOption,
  describeDatabaseSwitch,
  type DatabaseChangeMessage,
} from "@/databases/project-databases";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

type DatabaseListData = Awaited<
  ReturnType<NonNullable<ReturnType<typeof useHostRuntimeClient>>["listProjectDatabases"]>
>;

type ChangeState =
  | { kind: "idle" }
  | { kind: "choosing"; selected: string | null }
  | { kind: "saving"; selected: string }
  | { kind: "done"; message: DatabaseChangeMessage }
  | { kind: "checking"; message: DatabaseChangeMessage }
  | { kind: "failed"; selected: string; error: string };

/**
 * Changes a project's database from its row on the Databases page. "Change" lists the
 * databases the project's MySQL login sees on the server, filtered by `namePrefix` (null: the
 * daemon's default, the test_<initials>_ start of the current name). The daemon writes the
 * local config and PhpStorm uploads it; saving can take a while when PhpStorm has to open the
 * project first, so the row says so while it waits.
 */
export function DatabaseChangeControl({
  serverId,
  projectId,
  projectName,
  currentName,
  namePrefix,
}: {
  serverId: string;
  projectId: string;
  projectName: string;
  currentName: string;
  namePrefix: string | null;
}): ReactElement | null {
  const canSet = useHostFeature(serverId, "projectDatabaseSet");
  const canList = useHostFeature(serverId, "projectDatabaseList");
  const canCheck = useHostFeature(serverId, "projectDatabaseCheck");
  const client = useHostRuntimeClient(serverId);
  const [state, setState] = useState<ChangeState>({ kind: "idle" });
  const isOpen = state.kind === "choosing" || state.kind === "saving" || state.kind === "failed";

  const databases = useFetchQuery({
    queryKey: ["projectDatabases", serverId, projectId, namePrefix],
    enabled: isOpen && canList && client !== null,
    dataShape: "value",
    staleTimeMs: 30_000,
    queryFn: async () => {
      if (!client) throw new Error("Host is not connected");
      return client.listProjectDatabases({ projectId, namePrefix });
    },
  });

  const open = useCallback(() => setState({ kind: "choosing", selected: null }), []);
  const cancel = useCallback(() => setState({ kind: "idle" }), []);
  const select = useCallback((name: string) => setState({ kind: "choosing", selected: name }), []);

  const save = useCallback(async () => {
    const selected = state.kind === "choosing" || state.kind === "failed" ? state.selected : null;
    if (!client || !selected) return;
    const upgradeReleases = databases.data?.upgradeReleases ?? [];
    const databaseRelease =
      databases.data?.releases.find((entry) => entry.name === selected)?.release ?? null;
    const prompt = describeDatabaseSwitch({
      projectName,
      databaseName: selected,
      databaseRelease,
      upgradeReleases,
      fit: analyzeDatabaseFit({ upgradeReleases, databaseRelease }),
    });
    const confirmed = await confirmDialog({
      title: prompt.title,
      message: prompt.message,
      confirmLabel: prompt.confirmLabel,
    });
    if (!confirmed) return;
    setState({ kind: "saving", selected });
    try {
      const outcome = await client.setProjectDatabase({ projectId, databaseName: selected });
      setState({ kind: "done", message: describeDatabaseChange(outcome) });
    } catch (error) {
      setState({ kind: "failed", selected, error: toErrorMessage(error) });
    }
  }, [client, databases.data, projectId, projectName, state]);

  const checkAgain = useCallback(async () => {
    if (!client || state.kind !== "done") return;
    setState({ kind: "checking", message: state.message });
    try {
      const outcome = await client.checkProjectDatabase({ projectId });
      setState({
        kind: "done",
        message: describeDatabaseChange({ ...outcome, openedPhpStorm: false }),
      });
    } catch (error) {
      setState({ kind: "done", message: { tone: "warning", text: toErrorMessage(error) } });
    }
  }, [client, projectId, state]);

  if (!canSet || !canList) return null;

  if (!isOpen) {
    return (
      <DatabaseChangeStatus
        projectId={projectId}
        message={state.kind === "done" || state.kind === "checking" ? state.message : null}
        isChecking={state.kind === "checking"}
        canCheck={canCheck}
        onCheckAgain={checkAgain}
        onChange={open}
      />
    );
  }

  const isSaving = state.kind === "saving";
  const selected = state.selected;
  return (
    <View style={styles.stack} testID={`databases-change-panel-${projectId}`}>
      <DatabaseOptions
        projectId={projectId}
        currentName={currentName}
        selected={selected}
        disabled={isSaving}
        query={databases}
        onSelect={select}
      />
      {state.kind === "failed" ? <Text style={styles.error}>{state.error}</Text> : null}
      {isSaving ? (
        <Text style={styles.hint}>
          Saving. PhpStorm uploads the file; if the project is not open, PhpStorm opens it first.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button variant="ghost" size="sm" onPress={cancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={save}
          disabled={!selected || isSaving || !client}
          testID={`databases-change-save-${projectId}`}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </View>
    </View>
  );
}

/** The row between changes: the last result, "Check again" after a warning, and "Change". */
function DatabaseChangeStatus({
  projectId,
  message,
  isChecking,
  canCheck,
  onCheckAgain,
  onChange,
}: {
  projectId: string;
  message: DatabaseChangeMessage | null;
  isChecking: boolean;
  canCheck: boolean;
  onCheckAgain: () => void;
  onChange: () => void;
}): ReactElement {
  return (
    <View style={styles.stack}>
      {message ? (
        <Text
          style={message.tone === "success" ? styles.success : styles.warning}
          testID={`databases-change-result-${projectId}`}
        >
          {message.text}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {message?.tone === "warning" && canCheck ? (
          <Button
            variant="outline"
            size="sm"
            onPress={onCheckAgain}
            disabled={isChecking}
            testID={`databases-check-again-${projectId}`}
          >
            {isChecking ? "Checking…" : "Check again"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onPress={onChange}
          disabled={isChecking}
          testID={`databases-change-${projectId}`}
        >
          Change
        </Button>
      </View>
    </View>
  );
}

function DatabaseOptions({
  projectId,
  currentName,
  selected,
  disabled,
  query,
  onSelect,
}: {
  projectId: string;
  currentName: string;
  selected: string | null;
  disabled: boolean;
  query: {
    data?: DatabaseListData;
    error: unknown;
    isPending: boolean;
  };
  onSelect: (name: string) => void;
}): ReactElement {
  if (query.isPending) {
    return (
      <View style={styles.loading}>
        <LoadingSpinner size="small" color={styles.spinner.color} />
        <Text style={styles.hint}>Loading databases from the server…</Text>
      </View>
    );
  }
  if (query.error || !query.data) {
    return <Text style={styles.error}>{toErrorMessage(query.error)}</Text>;
  }
  const { databases, namePrefix, releases, upgradeReleases } = query.data;
  const releaseByName = new Map(releases.map((entry) => [entry.name, entry.release]));
  if (databases.length === 0) {
    return (
      <Text style={styles.hint}>
        {namePrefix ? `No databases start with ${namePrefix}.` : "The server lists no databases."}
      </Text>
    );
  }
  return (
    <View style={styles.options} testID={`databases-options-${projectId}`}>
      {namePrefix ? <Text style={styles.hint}>{`Starting with ${namePrefix}`}</Text> : null}
      {databases.map((name) => (
        <DatabaseOption
          key={name}
          name={name}
          detail={describeDatabaseOption(
            releaseByName.get(name) ?? null,
            analyzeDatabaseFit({
              upgradeReleases,
              databaseRelease: releaseByName.get(name) ?? null,
            }),
          )}
          isCurrent={name === currentName}
          isSelected={name === selected}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

function DatabaseOption({
  name,
  detail,
  isCurrent,
  isSelected,
  disabled,
  onSelect,
}: {
  name: string;
  detail: string;
  isCurrent: boolean;
  isSelected: boolean;
  disabled: boolean;
  onSelect: (name: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(name), [name, onSelect]);
  const pressableStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.option,
      hovered && !isCurrent && styles.optionHovered,
      isSelected && styles.optionSelected,
    ],
    [isCurrent, isSelected],
  );
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={pressableStyle}
      testID={`databases-option-${name}`}
    >
      <Text style={isCurrent ? styles.optionCurrent : styles.optionText} numberOfLines={1}>
        {isCurrent ? `${name} (current)` : name}
      </Text>
      <Text style={styles.hint} numberOfLines={1}>
        {detail}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  options: {
    gap: theme.spacing[1],
  },
  option: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
  },
  optionHovered: {
    backgroundColor: theme.colors.surface2,
  },
  optionSelected: {
    backgroundColor: theme.colors.surface3,
  },
  optionText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  optionCurrent: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  success: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.sm,
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  // Static color holder read by the spinner; keeps the muted token without useUnistyles.
  spinner: {
    color: theme.colors.foregroundMuted,
  },
}));
