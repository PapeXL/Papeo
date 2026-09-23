import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BrandLogo } from "./logos";
import {
  barColor,
  clampPct,
  formatPct,
  formatReset,
  listUsage,
  type Meter,
  type UsageRow,
  type UsageSnapshot,
} from "../shared/usage";

const REFRESH_MS = 60_000;
const HOVERABLE = Platform.OS === "web";

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  meterRow: { flex: 1, flexDirection: "row", minWidth: 0 },
  meters: { flexDirection: "row", alignItems: "stretch" },
  cell: { flex: 1, minWidth: 0, gap: 4 },
  labelRow: { flexDirection: "row", alignItems: "baseline", gap: 4, minHeight: 16 },
  value: { flex: 1, minWidth: 0, fontWeight: "600" },
  track: { height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row" },
  fillBar: { height: 8, borderRadius: 4 },
  code: { fontSize: 11, fontWeight: "700" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "center" },
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  errorCard: { padding: 16, gap: 8, alignItems: "center" },
  retry: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  loading: { padding: 24, alignItems: "center" },
  divider: { height: 1 },
  rule: { width: 1, marginVertical: 2 },
  row: { flexDirection: "row", alignItems: "center" },
  logo: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  metersWrap: { flex: 1, position: "relative" },
  screen: { flex: 1 },
  contentWide: { padding: 24 },
  contentStacked: { padding: 16 },
  column: { width: "100%", maxWidth: 880, alignSelf: "center" },
  errorTitle: { fontWeight: "600" },
});

function shortMeterLabel(meter: Meter): string {
  if (meter.id === "five_hour") {
    return "5H";
  }
  if (meter.id === "weekly") {
    return "W";
  }
  if (meter.id.startsWith("weekly_")) {
    const scoped = /\((.+)\)/.exec(meter.label)?.[1]?.trim() ?? "";
    const initial = scoped.charAt(0);
    return initial ? `W${initial.toUpperCase()}` : "W";
  }
  if (meter.id === "cursor_models") {
    return "CM";
  }
  if (meter.id === "other_models") {
    return "OM";
  }
  return meter.label;
}

function meterValue(meter: Meter, reset: string | null, showReset: boolean): string {
  if (showReset && reset) {
    return reset;
  }
  if (meter.kind === "spend") {
    const pct = meter.usedPct != null ? formatPct(meter.usedPct) : null;
    const bits = [pct, meter.caption].filter((part): part is string => Boolean(part));
    return bits.length > 0 ? bits.join("  ") : "—";
  }
  if (meter.usedPct != null) {
    return formatPct(meter.usedPct);
  }
  return "—";
}

function spendLabel(row: UsageRow, spend: Meter | null): string {
  if (spend == null) {
    return row.title;
  }
  const pct = spend.usedPct != null ? formatPct(spend.usedPct) : "";
  return `${row.title}. Team spend ${pct} ${spend.caption ?? ""}`.trim();
}

function brandKind(kind: UsageRow["kind"]): "claude" | "cursor" | null {
  if (kind === "claude" || kind === "cursor") {
    return kind;
  }
  return null;
}

function isSidebarLayout(layout: PluginSurfaceProps["layout"] & { sidebar?: boolean }): boolean {
  return layout.sidebar === true;
}

interface MeterCellProps {
  meter: Meter;
  theme: PluginTheme;
  stacked: boolean;
  reset: string | null;
}

function MeterCell({ meter, theme, stacked, reset }: MeterCellProps) {
  const [hovered, setHovered] = useState(false);
  const onEnter = useCallback(() => setHovered(true), []);
  const onLeave = useCallback(() => setHovered(false), []);
  const showReset = Boolean(reset) && (hovered || !HOVERABLE);
  const fill = barColor(meter.tone, meter.kind, theme.colors.surface0);
  const code = shortMeterLabel(meter);
  const value = meterValue(meter, reset, showReset);
  const name = meter.kind === "spend" ? (meter.caption ?? meter.label) : meter.label;
  const cellStyle = useMemo(
    () => ({ ...styles.cell, paddingHorizontal: stacked ? 4 : 8 }),
    [stacked],
  );
  const codeStyle = useMemo(
    () => ({ ...styles.code, color: theme.colors.foregroundMuted }),
    [theme],
  );
  const valueStyle = useMemo(
    () => ({
      ...styles.value,
      color: theme.colors.foreground,
      fontSize: showReset ? 10 : 12,
    }),
    [theme, showReset],
  );
  const trackStyle = useMemo(
    () => ({ ...styles.track, backgroundColor: theme.colors.surface2 }),
    [theme],
  );
  const fillStyle = useMemo(
    () => ({
      ...styles.fillBar,
      width: `${clampPct(meter.usedPct ?? 0)}%` as const,
      backgroundColor: fill,
    }),
    [meter.usedPct, fill],
  );
  const showCode = meter.kind === "window" && !showReset;

  return (
    <View
      accessibilityLabel={reset ? `${name}, ${reset}` : name}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={cellStyle}
    >
      <View style={styles.labelRow}>
        {showCode ? <Text style={codeStyle}>{code}</Text> : null}
        <Text numberOfLines={1} style={valueStyle}>
          {value}
        </Text>
      </View>
      <View style={trackStyle}>
        <View style={fillStyle} />
      </View>
    </View>
  );
}

interface ProviderLogoProps {
  row: UsageRow;
  theme: PluginTheme;
  stacked: boolean;
  spend: Meter | null;
  onEnter: () => void;
  onLeave: () => void;
}

function ProviderLogo({ row, theme, stacked, spend, onEnter, onLeave }: ProviderLogoProps) {
  const brand = brandKind(row.kind);
  const logoStyle = useMemo(
    () => ({
      ...styles.logo,
      width: stacked ? 28 : 40,
      height: stacked ? 28 : 40,
      borderRadius: stacked ? 8 : 10,
      backgroundColor: theme.colors.surface2,
    }),
    [stacked, theme],
  );
  return (
    <View
      accessibilityLabel={spendLabel(row, spend)}
      onPointerEnter={spend ? onEnter : undefined}
      onPointerLeave={spend ? onLeave : undefined}
      style={logoStyle}
    >
      {brand ? (
        <BrandLogo color={theme.colors.foreground} kind={brand} size={stacked ? 16 : 20} />
      ) : (
        <Icon color={theme.colors.foregroundMuted} name="Database" size={stacked ? 16 : 18} />
      )}
    </View>
  );
}

interface MeterStripProps {
  row: UsageRow;
  theme: PluginTheme;
  stacked: boolean;
}

function MeterStrip({ row, theme, stacked }: MeterStripProps) {
  const ruleStyle = useMemo(
    () => ({ ...styles.rule, backgroundColor: theme.colors.border }),
    [theme],
  );
  return (
    <View style={styles.meters}>
      {row.meters.map((meter, index) => (
        <MeterSlot
          key={meter.id}
          meter={meter}
          ruleStyle={index > 0 ? ruleStyle : undefined}
          stacked={stacked}
          theme={theme}
        />
      ))}
    </View>
  );
}

interface MeterSlotProps {
  meter: Meter;
  theme: PluginTheme;
  stacked: boolean;
  ruleStyle: { width: number; marginVertical: number; backgroundColor: string } | undefined;
}

function MeterSlot({ meter, theme, stacked, ruleStyle }: MeterSlotProps) {
  return (
    <View style={styles.meterRow}>
      {ruleStyle ? <View style={ruleStyle} /> : null}
      <MeterCell
        meter={meter}
        reset={formatReset(meter.resetsAt)}
        stacked={stacked}
        theme={theme}
      />
    </View>
  );
}

interface ProviderRowProps {
  row: UsageRow;
  theme: PluginTheme;
  stacked: boolean;
  spend: Meter | null;
}

function ProviderRow({ row, theme, stacked, spend }: ProviderRowProps) {
  const [logoHovered, setLogoHovered] = useState(false);
  const onEnter = useCallback(() => setLogoHovered(true), []);
  const onLeave = useCallback(() => setLogoHovered(false), []);
  const showSpend = Boolean(spend) && logoHovered;
  const rowStyle = useMemo(
    () => ({
      ...styles.row,
      gap: stacked ? 8 : 16,
      paddingHorizontal: stacked ? 12 : 16,
      paddingVertical: stacked ? 10 : 16,
    }),
    [stacked],
  );
  const metersWrap = useMemo(
    () => ({ ...styles.metersWrap, minWidth: stacked ? 0 : 220 }),
    [stacked],
  );
  const overlayStyle = useMemo(
    () => ({ ...styles.overlay, backgroundColor: theme.colors.surface1 }),
    [theme],
  );

  return (
    <View style={rowStyle}>
      <ProviderLogo
        onEnter={onEnter}
        onLeave={onLeave}
        row={row}
        spend={spend}
        stacked={stacked}
        theme={theme}
      />
      <View style={metersWrap}>
        <View style={showSpend ? styles.hidden : styles.visible}>
          <MeterStrip row={row} stacked={stacked} theme={theme} />
        </View>
        {showSpend && spend ? (
          <View pointerEvents="none" style={overlayStyle}>
            <MeterCell
              meter={spend}
              reset={formatReset(spend.resetsAt)}
              stacked={stacked}
              theme={theme}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface UsageErrorCardProps {
  theme: PluginTheme;
  message: string;
  onRetry: () => void;
  cardStyle: object;
}

function UsageErrorCard({ theme, message, onRetry, cardStyle }: UsageErrorCardProps) {
  const titleStyle = useMemo(
    () => ({ ...styles.errorTitle, color: theme.colors.foreground }),
    [theme],
  );
  const mutedStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  const retryStyle = useMemo(
    () => ({ ...styles.retry, borderColor: theme.colors.border }),
    [theme],
  );
  const retryLabel = useMemo(() => ({ color: theme.colors.foreground }), [theme]);
  return (
    <View style={cardStyle}>
      <Text style={titleStyle}>Unable to load usage</Text>
      <Text style={mutedStyle}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={retryStyle}>
        <Text style={retryLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

interface UsageListProps {
  rows: UsageRow[];
  theme: PluginTheme;
  stacked: boolean;
  spend: Meter | null;
  pending: boolean;
  cardStyle: object;
  dividerStyle: object;
}

function UsageList({
  rows,
  theme,
  stacked,
  spend,
  pending,
  cardStyle,
  dividerStyle,
}: UsageListProps) {
  const mutedStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  return (
    <View style={cardStyle}>
      {pending ? (
        <View style={styles.loading}>
          <Text style={mutedStyle}>Loading usage...</Text>
        </View>
      ) : null}
      {rows.map((row, index) => (
        <UsageListRow
          key={row.id}
          dividerStyle={index > 0 ? dividerStyle : undefined}
          row={row}
          spend={row.kind === "cursor" ? spend : null}
          stacked={stacked}
          theme={theme}
        />
      ))}
    </View>
  );
}

interface UsageListRowProps {
  row: UsageRow;
  theme: PluginTheme;
  stacked: boolean;
  spend: Meter | null;
  dividerStyle: object | undefined;
}

function UsageListRow({ row, theme, stacked, spend, dividerStyle }: UsageListRowProps) {
  return (
    <View>
      {dividerStyle ? <View style={dividerStyle} /> : null}
      <ProviderRow row={row} spend={spend} stacked={stacked} theme={theme} />
    </View>
  );
}

export function UsageSurface({ theme, layout }: PluginSurfaceProps) {
  const fetchUsage = useRpc(listUsage);
  const sidebar = isSidebarLayout(layout);
  const stacked = layout.compact || sidebar;
  const loadSnapshot = useCallback(() => fetchUsage({}), [fetchUsage]);
  const query = useQuery<UsageSnapshot>({
    queryKey: ["spy-usage", "snapshot"],
    queryFn: loadSnapshot,
    refetchInterval: REFRESH_MS,
    staleTime: 30_000,
  });
  const rows = query.data?.rows;
  const spendRow = useMemo(() => rows?.find((row) => row.kind === "spend") ?? null, [rows]);
  const visibleRows = useMemo(() => (rows ?? []).filter((row) => row.kind !== "spend"), [rows]);
  const spendMeter = spendRow?.meters[0] ?? null;
  let errorMessage = "";
  if (query.error instanceof Error) {
    errorMessage = query.error.message;
  } else if (query.error) {
    errorMessage = String(query.error);
  }
  const onRetry = useCallback(() => {
    void query.refetch();
  }, [query]);
  const cardStyle = useMemo(
    () => ({
      ...styles.card,
      ...(query.isError ? styles.errorCard : {}),
      backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border,
    }),
    [theme, query.isError],
  );
  const dividerStyle = useMemo(
    () => ({ ...styles.divider, backgroundColor: theme.colors.border }),
    [theme],
  );
  const screenStyle = useMemo(
    () => ({ ...styles.screen, backgroundColor: theme.colors.surface0 }),
    [theme],
  );
  const contentStyle = stacked ? styles.contentStacked : styles.contentWide;

  if (query.isError) {
    const errorCard = (
      <UsageErrorCard
        cardStyle={cardStyle}
        message={errorMessage}
        onRetry={onRetry}
        theme={theme}
      />
    );
    if (sidebar) {
      return errorCard;
    }
    return (
      <View style={screenStyle}>
        <ScrollView contentContainerStyle={contentStyle}>
          <View style={styles.column}>{errorCard}</View>
        </ScrollView>
      </View>
    );
  }

  const list = (
    <UsageList
      cardStyle={cardStyle}
      dividerStyle={dividerStyle}
      pending={query.isPending}
      rows={visibleRows}
      spend={spendMeter}
      stacked={stacked}
      theme={theme}
    />
  );
  if (sidebar) {
    return list;
  }
  return (
    <View style={screenStyle}>
      <ScrollView contentContainerStyle={contentStyle}>
        <View style={styles.column}>{list}</View>
      </ScrollView>
    </View>
  );
}
