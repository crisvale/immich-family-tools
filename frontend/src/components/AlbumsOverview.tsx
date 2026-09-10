import React from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Loader2,
  RefreshCw,
  Trash2,
  Disc,
  AlertTriangle,
  User,
  Clock,
  Timer,
  Plus,
  X,
} from "lucide-react";
import { api, ManagedAlbum, SyncLogEntry, type Person } from "../api/client";
import { formatDate, LANG_LOCALES, useT } from "../i18n";

interface AlbumGroup {
  album_name: string;
  albums: ManagedAlbum[];
  total_assets: number;
  last_synced_at: string | undefined;
  owner_name: string;
  person_refs: ManagedAlbum["person_refs"];
  minimum_person_count: number;
  condition_person_count: number;
}

function groupAlbums(albums: ManagedAlbum[]): AlbumGroup[] {
  const map = new Map<string, ManagedAlbum[]>();
  for (const a of albums) {
    const key = a.match_id.startsWith("conditional_")
      ? `conditional:${a.id}`
      : a.album_name.trim().toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }

  return Array.from(map.values()).map((group) => {
    const seen = new Set<string>();
    const personRefs: ManagedAlbum["person_refs"] = [];
    for (const album of group) {
      for (const ref of album.person_refs) {
        const key = `${ref.account_id}::${ref.person_id}`;
        if (!seen.has(key)) {
          seen.add(key);
          personRefs.push(ref);
        }
      }
    }
    const dates = group.map((a) => a.last_synced_at).filter(Boolean) as string[];
    const lastSync = dates.length ? dates.sort().reverse()[0] : undefined;
    const first = group[0];
    const ownerRef = first.person_refs.find((r) => r.account_id === first.owner_account_id);
    // Use total_assets from the most recently synced entry (most accurate)
    const mostRecent = [...group].sort((a, b) =>
      (b.last_synced_at ?? "").localeCompare(a.last_synced_at ?? "")
    )[0];

    return {
      album_name: first.album_name,
      albums: group,
      total_assets: mostRecent.total_assets,
      last_synced_at: lastSync,
      owner_name: ownerRef?.account_name ?? first.owner_account_id,
      person_refs: personRefs,
      minimum_person_count: first.minimum_person_count ?? 1,
      condition_person_count: first.condition_person_count ?? personRefs.length,
    };
  });
}

function ConditionalAlbumBuilder({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [ownerAccountId, setOwnerAccountId] = React.useState("");
  const [albumMode, setAlbumMode] = React.useState<"new" | "existing">("new");
  const [albumName, setAlbumName] = React.useState("");
  const [existingAlbumId, setExistingAlbumId] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [selectedLinkIds, setSelectedLinkIds] = React.useState<Set<string>>(new Set());
  const [minimumCount, setMinimumCount] = React.useState(2);
  const [logs, setLogs] = React.useState<SyncLogEntry[] | null>(null);

  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: api.accounts.list,
    staleTime: 60_000,
  });
  const { data: people = [], isFetching: loadingPeople } = useQuery({
    queryKey: ["people", ownerAccountId],
    queryFn: () => api.people.byAccount(ownerAccountId),
    enabled: !!ownerAccountId,
    staleTime: 60_000,
  });
  const { data: personLinks = [] } = useQuery({
    queryKey: ["person-links"],
    queryFn: api.personLinks.list,
    staleTime: 30_000,
  });
  const { data: existingAlbums = [], isFetching: loadingAlbums } = useQuery({
    queryKey: ["account-albums", ownerAccountId],
    queryFn: () => api.accounts.albums(ownerAccountId),
    enabled: !!ownerAccountId && albumMode === "existing",
  });

  const identityCount = selectedIds.size + selectedLinkIds.size;
  const coveredOwnerPersonIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const link of personLinks) {
      if (!selectedLinkIds.has(link.id)) continue;
      for (const ref of link.person_refs) {
        if (ref.account_id === ownerAccountId) ids.add(ref.person_id);
      }
    }
    return ids;
  }, [personLinks, selectedLinkIds, ownerAccountId]);

  const mutation = useMutation({
    mutationFn: () =>
      api.sync.conditionalAlbum({
        ...(albumMode === "new"
          ? { album_name: albumName.trim() }
          : { existing_album_id: existingAlbumId }),
        owner_account_id: ownerAccountId,
        persons: Array.from(selectedIds).map((person_id) => ({
          account_id: ownerAccountId,
          person_id,
        })),
        linked_person_ids: Array.from(selectedLinkIds),
        minimum_person_count: minimumCount,
      }),
    onSuccess: (result) => {
      setLogs(result);
      setAlbumName("");
      setSelectedIds(new Set());
      setSelectedLinkIds(new Set());
      setExistingAlbumId("");
      setMinimumCount(2);
      qc.invalidateQueries({ queryKey: ["managed-albums"] });
      qc.invalidateQueries({ queryKey: ["sync-log"] });
    },
  });

  const chooseOwner = (accountId: string) => {
    setOwnerAccountId(accountId);
    setSelectedIds(new Set());
    setSelectedLinkIds(new Set());
    setExistingAlbumId("");
    setMinimumCount(2);
    setLogs(null);
    mutation.reset();
  };
  const togglePerson = (person: Person) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(person.id)) next.delete(person.id);
      else next.add(person.id);
      setMinimumCount((count) => Math.min(Math.max(1, count), Math.max(1, next.size)));
      return next;
    });
  };
  const toggleLink = (id: string) => {
    setSelectedLinkIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const link = personLinks.find((candidate) => candidate.id === id);
      if (link && !current.has(id)) {
        setSelectedIds((selected) => {
          const clean = new Set(selected);
          for (const ref of link.person_refs) {
            if (ref.account_id === ownerAccountId) clean.delete(ref.person_id);
          }
          return clean;
        });
      }
      return next;
    });
  };
  const canCreate =
    (albumMode === "new" ? albumName.trim().length > 0 : existingAlbumId.length > 0) &&
    ownerAccountId.length > 0 &&
    identityCount >= 2 &&
    minimumCount >= 1 &&
    minimumCount <= identityCount;

  React.useEffect(() => {
    setMinimumCount((count) => Math.min(Math.max(1, count), Math.max(1, identityCount)));
  }, [identityCount]);

  return (
    <div className="card mb-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("conditional_album_title")}</h2>
          <p className="text-xs text-gray-500 mt-1">{t("conditional_album_hint")}</p>
        </div>
        <button
          className="btn-ghost p-1.5"
          onClick={onClose}
          aria-label={t("conditional_album_close")}
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-gray-500">{t("conditional_album_owner")}</span>
          <select
            className="input text-sm"
            value={ownerAccountId}
            onChange={(e) => chooseOwner(e.target.value)}
            disabled={loadingAccounts || mutation.isPending}
          >
            <option value="">{t("account_select_ph")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-2">
          <div className="flex gap-1 rounded-lg bg-immich-bg p-1">
            {(["new", "existing"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAlbumMode(mode)}
                className={`flex-1 rounded px-2 py-1 text-xs ${albumMode === mode ? "bg-immich-primary text-white" : "text-gray-400"}`}
              >
                {t(mode === "new" ? "album_new" : "album_link_existing")}
              </button>
            ))}
          </div>
          {albumMode === "new" ? (
            <input
              className="input text-sm"
              aria-label={t("album_name_label")}
              value={albumName}
              onChange={(e) => setAlbumName(e.target.value)}
              placeholder={t("conditional_album_name_ph")}
              disabled={mutation.isPending}
            />
          ) : (
            <select
              className="input text-sm"
              aria-label={t("album_link_existing")}
              value={existingAlbumId}
              onChange={(e) => setExistingAlbumId(e.target.value)}
              disabled={!ownerAccountId || loadingAlbums || mutation.isPending}
            >
              <option value="">{loadingAlbums ? t("loading") : t("album_select_ph")}</option>
              {existingAlbums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {personLinks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 font-medium">{t("linked_identities")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {personLinks.map((link) => {
              const selected = selectedLinkIds.has(link.id);
              return (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => toggleLink(link.id)}
                  className={`rounded-lg border p-2 text-left ${selected ? "border-immich-primary bg-blue-900/20" : "border-immich-border"}`}
                >
                  <span className="block text-sm font-medium">{link.display_name}</span>
                  <span className="block text-xs text-gray-500 truncate">
                    {link.person_refs.map((ref) => ref.account_name).join(" · ")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {ownerAccountId && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 font-medium">
            {t("conditional_album_people", identityCount)}
          </p>
          {loadingPeople ? (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
              <Loader2 size={14} className="animate-spin" />
              {t("loading")}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
              {people.map((person) => {
                const selected = selectedIds.has(person.id);
                const covered = coveredOwnerPersonIds.has(person.id);
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => togglePerson(person)}
                    disabled={mutation.isPending || covered}
                    title={covered ? t("person_covered_by_link") : undefined}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${covered ? "opacity-40" : selected ? "border-immich-primary bg-blue-900/20" : "border-immich-border hover:border-gray-500"}`}
                  >
                    <img
                      src={api.people.thumbnailUrl(person.account_id, person.id)}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover bg-immich-border shrink-0"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                      }}
                    />
                    <span className="text-sm truncate">{person.name || t("unknown")}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {identityCount >= 2 && (
        <label className="space-y-1 block">
          <span className="text-xs text-gray-500">{t("conditional_album_minimum")}</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={identityCount}
              value={minimumCount}
              onChange={(e) => setMinimumCount(Number(e.target.value))}
              className="flex-1 accent-immich-primary"
              disabled={mutation.isPending}
            />
            <span className="text-sm font-medium min-w-24 text-right">
              {t("conditional_album_rule", minimumCount, identityCount)}
            </span>
          </div>
        </label>
      )}

      {mutation.error && <p className="text-xs text-red-400">{mutation.error.message}</p>}
      <SyncLogDisplay logs={logs} syncing={mutation.isPending} />
      <button
        className="btn-primary text-sm flex items-center gap-1.5"
        onClick={() => mutation.mutate()}
        disabled={!canCreate || mutation.isPending}
      >
        {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        {t("conditional_album_create")}
      </button>
    </div>
  );
}

function SyncLogDisplay({ logs, syncing }: { logs: SyncLogEntry[] | null; syncing: boolean }) {
  const { t, logMessage } = useT();
  if (syncing)
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 py-1">
        <Loader2 size={12} className="animate-spin" />
        <span>{t("syncing")}</span>
      </div>
    );
  if (!logs || logs.length === 0) return null;
  return (
    <div className="space-y-1">
      {logs.map((entry) => (
        <p
          key={entry.id}
          className={`text-xs border rounded px-2 py-1 ${
            entry.status === "success"
              ? "text-emerald-400 bg-emerald-900/20 border-emerald-800"
              : "text-red-400 bg-red-900/20 border-red-800"
          }`}
        >
          {logMessage(entry)}
        </p>
      ))}
    </div>
  );
}

function AlbumGroupCard({
  group,
  externalLogs,
  externalSyncing,
}: {
  group: AlbumGroup;
  externalLogs?: SyncLogEntry[] | null; // results pushed from "Alle synchronisieren"
  externalSyncing?: boolean;
}) {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const [localLogs, setLocalLogs] = React.useState<SyncLogEntry[] | null>(null);
  const [localSyncing, setLocalSyncing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  // External (bulk) results take priority over local results
  const displayLogs = externalLogs !== undefined ? externalLogs : localLogs;
  const syncing = externalSyncing || localSyncing;

  const handleRefresh = async () => {
    setLocalSyncing(true);
    setLocalLogs(null);
    const allLogs: SyncLogEntry[] = [];
    for (const album of group.albums) {
      try {
        allLogs.push(...(await api.sync.refreshAlbum(album.id)));
      } catch (_) {}
    }
    setLocalLogs(allLogs);
    setLocalSyncing(false);
    qc.invalidateQueries({ queryKey: ["managed-albums"] });
    qc.invalidateQueries({ queryKey: ["sync-log"] });
  };

  const handleDelete = async () => {
    if (!confirm(t("album_remove_confirm", group.album_name, group.albums.length))) return;
    setDeleting(true);
    for (const album of group.albums) {
      try {
        await api.sync.deleteAlbum(album.id);
      } catch (_) {}
    }
    setDeleting(false);
    qc.invalidateQueries({ queryKey: ["managed-albums"] });
    qc.invalidateQueries({ queryKey: ["matches"] });
  };

  const isDeleted = displayLogs?.some((e) => e.error_message === "ALBUM_DELETED");

  return (
    <div className={`card space-y-4 ${isDeleted ? "border-red-800" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Disc size={18} className={isDeleted ? "text-red-400" : "text-blue-400"} />
          <div>
            <h3 className="font-semibold">{group.album_name}</h3>
            <p className="text-xs text-gray-500">
              {t("owner")}: {group.owner_name}
            </p>
          </div>
        </div>
        <span className="text-sm font-medium text-gray-300 shrink-0">
          {group.total_assets.toLocaleString(LANG_LOCALES[lang])} {t("photos")}
        </span>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-gray-500 font-medium">{t("linked_people")}</p>
        {group.minimum_person_count > 1 && (
          <p className="text-xs text-blue-300">
            {t("conditional_album_rule", group.minimum_person_count, group.condition_person_count)}
          </p>
        )}
        {group.person_refs.map((ref, i) => (
          <div key={i} className="flex items-center gap-2">
            <User size={12} className="text-gray-600 shrink-0" />
            <span className="text-sm">{ref.person_name}</span>
            <span className="badge text-xs" style={{ backgroundColor: ref.account_color }}>
              {ref.account_name}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <Clock size={12} />
        <span>{t("last_sync", formatDate(group.last_synced_at, LANG_LOCALES[lang]))}</span>
      </div>

      <SyncLogDisplay logs={displayLogs} syncing={syncing} />

      {isDeleted && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded px-3 py-2">
          <AlertTriangle size={13} />
          {t("album_deleted_warn")}
        </div>
      )}

      <div className="flex gap-2">
        <button
          className="btn-primary text-xs flex items-center gap-1.5"
          onClick={handleRefresh}
          disabled={syncing}
        >
          {localSyncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {t("sync_now")}
        </button>
        <button
          className="btn-ghost text-xs flex items-center gap-1.5 text-red-400 hover:text-red-300"
          onClick={handleDelete}
          disabled={deleting}
          title={t("remove_link")}
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          {t("remove_link")}
        </button>
      </div>
    </div>
  );
}

function AutoSyncControl() {
  const { t } = useT();

  const { data: cfg } = useQuery({
    queryKey: ["autosync-config"],
    queryFn: api.autoSync.get,
    staleTime: 30_000,
  });

  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ enabled, time }: { enabled: boolean; time: string }) =>
      api.autoSync.set(enabled, time),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autosync-config"] }),
  });

  const enabled = cfg?.enabled ?? false;
  const time = cfg?.time ?? "01:00";

  // Compute next sync label (client-side, server local time ≈ user local time)
  const nextSyncLabel = React.useMemo(() => {
    if (!enabled || !cfg) return null;
    const [h, m] = time.split(":").map(Number);
    const now = new Date();
    const candidate = new Date(now);
    candidate.setHours(h, m, 0, 0);
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
    const isToday = candidate.getDate() === now.getDate();
    const day = isToday ? t("auto_sync_today") : t("auto_sync_tomorrow");
    return t("auto_sync_next", time, day);
  }, [enabled, time, cfg, t]);

  if (!cfg) return null;

  return (
    <div className="flex items-center gap-3 bg-immich-surface border border-immich-border rounded-lg px-3 py-2">
      <Timer size={14} className={enabled ? "text-immich-primary" : "text-gray-500"} />
      <span className="text-sm text-gray-300 font-medium">{t("auto_sync_label")}</span>

      {/* Toggle */}
      <button
        onClick={() => mutation.mutate({ enabled: !enabled, time })}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none ${
          enabled ? "bg-immich-primary" : "bg-immich-border"
        }`}
        disabled={mutation.isPending}
      >
        <span
          className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>

      {/* Time picker — only active when enabled */}
      <input
        type="time"
        value={time}
        disabled={!enabled}
        onChange={(e) => mutation.mutate({ enabled, time: e.target.value })}
        className="bg-immich-bg border border-immich-border rounded px-2 py-0.5 text-sm text-gray-200 disabled:opacity-40 focus:outline-none focus:border-immich-primary"
      />

      {/* Next sync info */}
      {nextSyncLabel && (
        <span className="text-xs text-gray-500 hidden sm:block">{nextSyncLabel}</span>
      )}
    </div>
  );
}

export default function AlbumsOverview() {
  const { t } = useT();
  const { data: albums = [], isLoading } = useQuery({
    queryKey: ["managed-albums"],
    queryFn: api.sync.albums,
    staleTime: 30_000,
  });
  const qc = useQueryClient();
  const groups = groupAlbums(albums);

  // bulkSyncState: per-group results from "Alle synchronisieren"
  // null = not started, undefined = currently running (show spinner), [] = done (show logs)
  const [bulkSyncState, setBulkSyncState] = React.useState<Map<string, SyncLogEntry[] | null>>(
    new Map()
  );
  const [refreshingAll, setRefreshingAll] = React.useState(false);
  const [showBuilder, setShowBuilder] = React.useState(false);

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    // Mark all groups as "syncing"
    setBulkSyncState(new Map(groups.map((g) => [g.album_name, null])));

    for (const group of groups) {
      const groupLogs: SyncLogEntry[] = [];
      for (const album of group.albums) {
        try {
          groupLogs.push(...(await api.sync.refreshAlbum(album.id)));
        } catch (_) {}
      }
      // Update this group's results immediately, keep others in their current state
      setBulkSyncState((prev) => new Map(prev).set(group.album_name, groupLogs));
    }

    setRefreshingAll(false);
    qc.invalidateQueries({ queryKey: ["managed-albums"] });
    qc.invalidateQueries({ queryKey: ["sync-log"] });
  };

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">{t("albums_title")}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t("albums_subtitle", groups.length)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-primary text-sm flex items-center gap-1.5"
            onClick={() => setShowBuilder((show) => !show)}
          >
            {showBuilder ? <X size={14} /> : <Plus size={14} />}
            {t("conditional_album_new")}
          </button>
          {groups.length > 0 && (
            <button
              className="btn-primary text-sm flex items-center gap-1.5"
              onClick={handleRefreshAll}
              disabled={refreshingAll}
            >
              {refreshingAll ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {t("sync_all")}
            </button>
          )}
        </div>
      </div>

      {showBuilder && <ConditionalAlbumBuilder onClose={() => setShowBuilder(false)} />}

      {/* Auto-sync control */}
      <div className="mb-6">
        <AutoSyncControl />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-500" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Disc size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t("albums_empty")}</p>
          <p className="text-xs mt-1">{t("albums_empty_hint")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const bulkEntry = bulkSyncState.get(group.album_name);
            // null in map = currently syncing; array = done with results
            const externalSyncing = bulkSyncState.has(group.album_name) && bulkEntry === null;
            const externalLogs = bulkEntry ?? undefined;
            return (
              <AlbumGroupCard
                key={group.album_name}
                group={group}
                externalLogs={externalLogs}
                externalSyncing={externalSyncing}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
