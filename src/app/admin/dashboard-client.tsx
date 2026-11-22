"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Cloud, Film, FolderOpen, LayoutDashboard, LogOut, Plus, Search, Settings, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Category, useCategories, useCategoryOptions, useLibraryStats, useVideos, VideoRecord } from "@/hooks/use-library";
import { createClient } from "@/lib/supabase/client";
import { generateVideoThumbnail } from "@/lib/video-thumbnail";
import { getCategorySlug } from "@/lib/category-slug";
import VideoPagination from "@/components/video-pagination";

const ADMIN_VIDEO_PAGE_SIZE = 15;
const showDashboardStatsDiagnostics = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
const MAX_DIRECT_VIDEO_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

function getVideoUploadContentType(file: File): "video/mp4" | "video/webm" | null {
  const extension = file.name.toLowerCase().match(/\.(mp4|webm)$/)?.[1];
  if (!extension) return null;
  const expected = extension === "mp4" ? "video/mp4" : "video/webm";
  return !file.type || file.type === expected ? expected : null;
}
type VideoCheckStatus = "working" | "recovered" | "temporary" | "broken" | "unpublished" | "skipped";
type VideoCheckResult = { videoId: string; title: string; status: VideoCheckStatus; reason: string; action: string };
type VideoCheckSummary = { checked: number; working: number; recovered: number; temporary: number; unpublished: number; skipped: number };
type BulkUploadItem = { id: string; file: File; title: string; progress: number; status: "queued" | "uploading" | "saving" | "saved" | "failed"; error?: string; uploadedUrl?: string; storageAccountSlot?: string; bucketName?: string };
type StagedVideoUpload = { publicUrl: string; storageAccountSlot: string; bucketName: string };
type CloudflareVideoAccount = { id: string; name: string; accountId: string; endpoint: string; bucketName: string; publicUrl: string; isDefault: boolean; isActive: boolean };
type CloudflareVideoStorageObject = { key: string; size: number; lastModified: string | null; publicUrl: string };
type CloudflareVideoStorageView = { account: Pick<CloudflareVideoAccount, "id" | "name" | "bucketName" | "publicUrl">; objects: CloudflareVideoStorageObject[]; nextContinuationToken: string | null; usage: { objectCount: number; totalBytes: number } };
type DuplicateVideoCandidate = Pick<VideoRecord, "id" | "title" | "video_url" | "category_id" | "views" | "created_at" | "thumbnail_url">;
type DuplicateVideoGroup = { key: string; matchBasis: string; keep: DuplicateVideoCandidate; duplicates: DuplicateVideoCandidate[]; autoDeleteIds: string[] };

function normalizeDuplicateVideoUrl(source: string) {
  try {
    const url = new URL(source.trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch { return source.trim(); }
}

function normalizeDuplicateVideoTitle(title: string) {
  return title.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function formatStorageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units[unit]}`;
}

function titleFromVideoFilename(filename: string) {
  const basename = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  return basename
    .replace(/\.(?:mp4|webm)$/i, "")
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ")
    .replace(/(?:^|[\s._-])(?:copy|duplicate)(?:[\s._-]*\d*)?$/i, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s_-]+|[\s_-]+$/g, "")
    .slice(0, 180);
}

async function uploadVideoFileDirectly(file: File, storageAccountSlot: string, onProgress: (percentage: number) => void) {
  const contentType = getVideoUploadContentType(file);
  if (!contentType) throw new Error("Choose an MP4 or WebM file with a matching file extension.");
  if (file.size <= 0 || file.size > MAX_DIRECT_VIDEO_UPLOAD_BYTES) throw new Error("Video files must be between 1 byte and 10 GB.");
  const targetResponse = await fetch("/api/admin/videos/upload-target", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType, size: file.size, storageAccountSlot }),
  });
  const target = await targetResponse.json() as { uploadUrl?: string; publicUrl?: string; contentType?: string; storageAccountSlot?: string; bucketName?: string; error?: string };
  if (!targetResponse.ok || !target.uploadUrl || !target.publicUrl || !target.storageAccountSlot || !target.bucketName || target.contentType !== contentType) throw new Error(target.error || "Could not prepare the secure video upload.");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.uploadUrl!);
    xhr.withCredentials = false;
    xhr.timeout = 60 * 60 * 1000;
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Cloudflare R2 upload failed (HTTP ${xhr.status}). Check the video bucket CORS settings.`));
    xhr.onerror = () => reject(new Error("Cloudflare R2 upload was blocked or interrupted. Check the video bucket CORS settings and try again."));
    xhr.ontimeout = () => reject(new Error("Video upload timed out. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Video upload was cancelled."));
    xhr.send(file);
  });
  onProgress(100);
  return { publicUrl: target.publicUrl, storageAccountSlot: target.storageAccountSlot, bucketName: target.bucketName };
}

export default function AdminDashboard() {
  const router = useRouter();
  const [section, setSection] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [publishedFilter, setPublishedFilter] = useState("all");
  const [videoPage, setVideoPage] = useState(1);
  const [adminFiltersReady, setAdminFiltersReady] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [quickCategory, setQuickCategory] = useState(false);
  const [categoryFormError, setCategoryFormError] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [videoSubmitInProgress, setVideoSubmitInProgress] = useState(false);
  const [videoInputMode, setVideoInputMode] = useState<"url" | "upload" | "bulk">("url");
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [bulkUploadItems, setBulkUploadItems] = useState<BulkUploadItem[]>([]);
  const bulkUploadItemsRef = useRef<BulkUploadItem[]>([]);
  const [stagedUploadedVideo, setStagedUploadedVideo] = useState<StagedVideoUpload | null>(null);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(null);
  const [videoUploadError, setVideoUploadError] = useState("");
  const [cloudflareVideoAccounts, setCloudflareVideoAccounts] = useState<CloudflareVideoAccount[]>([]);
  const [cloudflareAccountsLoading, setCloudflareAccountsLoading] = useState(false);
  const [cloudflareAccountsError, setCloudflareAccountsError] = useState("");
  const [selectedCloudflareAccountId, setSelectedCloudflareAccountId] = useState("");
  const [cloudflareStorageView, setCloudflareStorageView] = useState<CloudflareVideoStorageView | null>(null);
  const cloudflareStorageViewRef = useRef<CloudflareVideoStorageView | null>(null);
  const [cloudflareStorageLoading, setCloudflareStorageLoading] = useState(false);
  const [cloudflareStorageError, setCloudflareStorageError] = useState("");
  const [cloudflareStorageBusyKey, setCloudflareStorageBusyKey] = useState("");
  const [selectedStorageObjectKeys, setSelectedStorageObjectKeys] = useState<Set<string>>(() => new Set());
  const [preparedStorageDownloads, setPreparedStorageDownloads] = useState<Array<{ key: string; url: string }>>([]);
  const [storageBulkActionBusy, setStorageBulkActionBusy] = useState(false);
  const [duplicateScanBusy, setDuplicateScanBusy] = useState(false);
  const [duplicateDeleteBusy, setDuplicateDeleteBusy] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateVideoGroup[]>([]);
  const [selectedDuplicateVideoIds, setSelectedDuplicateVideoIds] = useState<Set<string>>(() => new Set());
  const [duplicateScanError, setDuplicateScanError] = useState("");
  const cloudflareStorageRequestRef = useRef(0);
  const videoSubmitLock = useRef(false);
  const [generatingThumbnailIds, setGeneratingThumbnailIds] = useState<Set<string>>(() => new Set());
  const [thumbnailBatchRunning, setThumbnailBatchRunning] = useState(false);
  const [thumbnailBatchProgress, setThumbnailBatchProgress] = useState("");
  const [regenerateAllConfirmOpen, setRegenerateAllConfirmOpen] = useState(false);
  const thumbnailBatchLock = useRef(false);
  const thumbnailGenerationLocks = useRef(new Set<string>());
  const [checkAllConfirmOpen, setCheckAllConfirmOpen] = useState(false);
  const [videoCheckRunning, setVideoCheckRunning] = useState(false);
  const [videoCheckProgress, setVideoCheckProgress] = useState("");
  const [videoCheckFailure, setVideoCheckFailure] = useState("");
  const [videoCheckResults, setVideoCheckResults] = useState<VideoCheckResult[]>([]);
  const [videoCheckSummary, setVideoCheckSummary] = useState<VideoCheckSummary | null>(null);
  const [checkingVideoIds, setCheckingVideoIds] = useState<Set<string>>(() => new Set());
  const videoCheckLock = useRef(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const bulkDeleteLock = useRef(false);
  const [bulkDeleteCode, setBulkDeleteCode] = useState("");
  const [bulkDeletePreview, setBulkDeletePreview] = useState<{ categoryId: string; categoryName: string; videoIds: string[]; count: number } | null>(null);
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
  const [passwordChangeCode, setPasswordChangeCode] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [confirmAdminPassword, setConfirmAdminPassword] = useState("");
  const [passwordChangeBusy, setPasswordChangeBusy] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [editingVideo, setEditingVideo] = useState<VideoRecord | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const statsHook = useLibraryStats();
  const stats = statsHook.stats;
  const categoriesHook = useCategories();
  const categoryOptionsHook = useCategoryOptions();
  const searchCategoryIds = categoriesHook.categories.filter((category) => category.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((category) => category.id);
  const isVideoSection = section === "Videos";
  const videosHook = useVideos({ admin: true, search, searchCategoryIds, categoryId: categoryFilter || undefined, published: publishedFilter === "all" ? undefined : publishedFilter === "published", pageNumber: isVideoSection && adminFiltersReady ? videoPage : undefined, pageSize: isVideoSection ? ADMIN_VIDEO_PAGE_SIZE : undefined });

  const refreshCloudflareVideoAccounts = useCallback(async () => {
    setCloudflareAccountsLoading(true);
    setCloudflareAccountsError("");
    try {
      const response = await fetch("/api/admin/cloudflare-video-accounts", { cache: "no-store" });
      const payload = await response.json() as { accounts?: CloudflareVideoAccount[]; error?: string };
      if (!response.ok || !payload.accounts) throw new Error(payload.error || "Could not load storage accounts");
      const active = payload.accounts.filter((account) => account.isActive);
      setCloudflareVideoAccounts(payload.accounts);
      setSelectedCloudflareAccountId((current) => active.some((account) => account.id === current) ? current : active.find((account) => account.isDefault)?.id ?? active[0]?.id ?? "");
    } catch (error) {
      setCloudflareAccountsError(error instanceof Error ? error.message : "Could not load storage accounts");
    } finally {
      setCloudflareAccountsLoading(false);
    }
  }, []);

  const loadCloudflareStorage = useCallback(async (append = false) => {
    const slot = selectedCloudflareAccountId;
    if (!slot) { cloudflareStorageViewRef.current = null; setCloudflareStorageView(null); return; }
    const requestId = ++cloudflareStorageRequestRef.current;
    setCloudflareStorageLoading(true);
    setCloudflareStorageError("");
    try {
      const cursor = append ? cloudflareStorageView?.nextContinuationToken : null;
      const params = new URLSearchParams({ slot });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/admin/cloudflare-video-storage?${params.toString()}`, { cache: "no-store" });
      const result = await response.json() as CloudflareVideoStorageView & { error?: string };
      if (!response.ok || !result.account || !result.usage) throw new Error(result.error || "Could not load Cloudflare storage");
      if (requestId !== cloudflareStorageRequestRef.current) return;
      const currentView = cloudflareStorageViewRef.current;
      const nextView = append && currentView?.account.id === slot ? { ...result, objects: [...currentView.objects, ...result.objects] } : result;
      cloudflareStorageViewRef.current = nextView;
      setCloudflareStorageView(nextView);
    } catch (error) {
      if (requestId === cloudflareStorageRequestRef.current) setCloudflareStorageError(error instanceof Error ? error.message : "Could not load Cloudflare storage");
    } finally {
      if (requestId === cloudflareStorageRequestRef.current) setCloudflareStorageLoading(false);
    }
  }, [selectedCloudflareAccountId]);

  useEffect(() => {
    if (section === "Add Video" || section === "Cloudflare Storage") void refreshCloudflareVideoAccounts();
  }, [refreshCloudflareVideoAccounts, section]);

  useEffect(() => {
    if (section === "Cloudflare Storage" && selectedCloudflareAccountId) void loadCloudflareStorage();
  }, [loadCloudflareStorage, section, selectedCloudflareAccountId]);

  function updateBulkUploadItems(update: (items: BulkUploadItem[]) => BulkUploadItem[]) {
    const next = update(bulkUploadItemsRef.current);
    bulkUploadItemsRef.current = next;
    setBulkUploadItems(next);
  }

  useEffect(() => {
    if (categoriesHook.loading || adminFiltersReady) return;
    const applyUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const urlSection = params.get("section");
      if (urlSection === "videos") setSection("Videos");
      else if (urlSection === "categories") setSection("Categories");
      else if (urlSection === "settings") setSection("Settings");
      const searchValue = params.get("search") ?? "";
      setSearch(searchValue);
      const urlCategory = params.get("category");
      const matched = urlCategory ? categoriesHook.categories.find((item) => getCategorySlug(item, categoriesHook.categories) === urlCategory || item.id === urlCategory) : null;
      setCategoryFilter(matched?.id ?? "");
      const urlStatus = params.get("status");
      setPublishedFilter(urlStatus === "published" || urlStatus === "draft" ? urlStatus : "all");
      const requestedPage = Number.parseInt(params.get("page") ?? "1", 10);
      setVideoPage(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    };
    applyUrl(); setAdminFiltersReady(true);
  }, [categoriesHook.loading, categoriesHook.categories, adminFiltersReady]);

  useEffect(() => {
    if (!adminFiltersReady) return;
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("section") === "videos") setSection("Videos");
      else if (params.get("section") === "categories") setSection("Categories");
      else if (params.get("section") === "settings") setSection("Settings");
      else setSection("Dashboard");
      setSearch(params.get("search") ?? "");
      const urlCategory = params.get("category");
      const matched = urlCategory ? categoriesHook.categories.find((item) => getCategorySlug(item, categoriesHook.categories) === urlCategory || item.id === urlCategory) : null;
      setCategoryFilter(matched?.id ?? "");
      const status = params.get("status"); setPublishedFilter(status === "published" || status === "draft" ? status : "all");
      const page = Number.parseInt(params.get("page") ?? "1", 10); setVideoPage(Number.isFinite(page) && page > 0 ? page : 1);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [adminFiltersReady, categoriesHook.categories]);

  function writeVideosUrl(nextPage: number, nextSearch = search, nextCategory = categoryFilter, nextStatus = publishedFilter, replace = true) {
    const url = new URL(window.location.href);
    url.searchParams.set("section", "videos");
    if (nextPage > 1) url.searchParams.set("page", String(nextPage)); else url.searchParams.delete("page");
    if (nextSearch.trim()) url.searchParams.set("search", nextSearch.trim()); else url.searchParams.delete("search");
    if (nextCategory) {
      const category = categoriesHook.categories.find((item) => item.id === nextCategory);
      url.searchParams.set("category", category ? getCategorySlug(category, categoriesHook.categories) : nextCategory);
    } else url.searchParams.delete("category");
    if (nextStatus !== "all") url.searchParams.set("status", nextStatus); else url.searchParams.delete("status");
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  }

  function goToVideos(page = 1, replace = false) {
    setSection("Videos"); setVideoPage(page);
    writeVideosUrl(page, search, categoryFilter, publishedFilter, replace);
  }

  function changeVideoSearch(value: string) {
    setSearch(value); setVideoPage(1);
    writeVideosUrl(1, value, categoryFilter, publishedFilter, true);
  }

  function changeVideoCategory(value: string) {
    setCategoryFilter(value); setVideoPage(1);
    writeVideosUrl(1, search, value, publishedFilter, true);
  }

  function changeVideoStatus(value: string) {
    setPublishedFilter(value); setVideoPage(1);
    writeVideosUrl(1, search, categoryFilter, value, true);
  }

  function navigateSection(name: string) {
    if (name === "Add Video") { openVideo(); return; }
    setSection(name);
    const url = new URL(window.location.href);
    if (name === "Dashboard") url.searchParams.delete("section"); else url.searchParams.set("section", name.toLowerCase());
    url.searchParams.delete("page");
    window.history.pushState(null, "", url);
  }

  const adminTotalPages = Math.ceil((videosHook.totalCount ?? 0) / ADMIN_VIDEO_PAGE_SIZE);
  useEffect(() => {
    if (!adminFiltersReady || section !== "Videos" || videosHook.totalCount === null) return;
    const lastPage = Math.max(1, adminTotalPages);
    if (videoPage > lastPage) goToVideos(lastPage, true);
  }, [adminFiltersReady, section, videosHook.totalCount, adminTotalPages, videoPage]);

  useEffect(() => {
    if (!categoryDialog) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setCategoryDialog(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [categoryDialog]);

  useEffect(() => {
    if (!regenerateAllConfirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setRegenerateAllConfirmOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [regenerateAllConfirmOpen]);

  useEffect(() => {
    if (!checkAllConfirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setCheckAllConfirmOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [checkAllConfirmOpen]);

  useEffect(() => {
    if (!bulkDeleteDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !bulkDeleteBusy) {
        setBulkDeleteDialogOpen(false);
        setBulkDeleteCode("");
        setBulkDeletePreview(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bulkDeleteBusy, bulkDeleteDialogOpen]);

  async function logout() { await createClient().auth.signOut(); router.replace("/admin/login"); router.refresh(); }
  async function changeAdminPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordChangeError("");
    if (!/^\d{6}$/.test(passwordChangeCode)) { setPasswordChangeError("Enter the current 6-digit authenticator code."); return; }
    if (newAdminPassword.length < 8) { setPasswordChangeError("Choose a password with at least 8 characters."); return; }
    if (newAdminPassword !== confirmAdminPassword) { setPasswordChangeError("The new passwords do not match."); return; }
    setPasswordChangeBusy(true);
    try {
      const client = createClient();
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user) throw new Error("Your admin session expired. Sign in again before changing your password.");
      const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
      if (factorsError) throw new Error("Could not verify your authenticator. Try again.");
      const factorId = factors.totp.find((factor) => factor.status === "verified")?.id;
      if (!factorId) throw new Error("No verified authenticator is enrolled on this admin account.");
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId });
      if (challengeError || !challenge) throw new Error("Could not start authenticator verification. Try again.");
      const { error: verifyError } = await client.auth.mfa.verify({ factorId, challengeId: challenge.id, code: passwordChangeCode });
      if (verifyError) throw new Error("The authenticator code is invalid or expired. Enter the latest code and try again.");
      const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError || assurance.currentLevel !== "aal2") throw new Error("Authenticator verification did not complete. Please try again.");
      const { error: updateError } = await client.auth.updateUser({ password: newAdminPassword });
      if (updateError) throw new Error(updateError.message || "Could not update the admin password.");
      setPasswordChangeCode("");
      setNewAdminPassword("");
      setConfirmAdminPassword("");
      setPasswordChangeOpen(false);
      toast.success("Admin password updated.");
    } catch (error) {
      setPasswordChangeError(error instanceof Error ? error.message : "Could not update the admin password.");
    } finally {
      setPasswordChangeBusy(false);
    }
  }
  function openVideo(video?: VideoRecord) {
    setEditingVideo(video ?? null);
    setSelectedCategoryId(video?.category_id ?? "");
    const associatedAccount = video?.cloudflare_video_account_slot;
    if (associatedAccount) setSelectedCloudflareAccountId(associatedAccount);
    setVideoInputMode("url");
    setVideoUrlInput(video?.video_url ?? "");
    setSelectedVideoFile(null);
    bulkUploadItemsRef.current = [];
    setBulkUploadItems([]);
    setStagedUploadedVideo(null);
    setVideoUploadProgress(null);
    setVideoUploadError("");
    setSection("Add Video");
    categoriesHook.setErrorMessage("");
    void categoryOptionsHook.refresh();
  }
  function openCategory(category?: Category, quick = false) { setEditingCategory(category ?? null); setQuickCategory(quick); setCategoryFormError(""); setCategoryDialog(true); }

  async function deleteCloudflareVideoObject(object: CloudflareVideoStorageObject) {
    const slot = cloudflareStorageView?.account.id;
    if (!slot || cloudflareStorageBusyKey) return;
    if (!window.confirm(`Permanently delete this R2 video object?\n\n${object.key}\n\nAny video record pointing to this file will no longer play. This cannot be undone.`)) return;
    setCloudflareStorageBusyKey(object.key);
    try {
      const response = await fetch("/api/admin/cloudflare-video-storage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, key: object.key }),
      });
      const result = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !result.deleted) throw new Error(result.error || "Could not delete R2 object");
      const current = cloudflareStorageViewRef.current;
      if (current?.account.id === slot) {
        const next = { ...current, objects: current.objects.filter((item) => item.key !== object.key), usage: { objectCount: Math.max(0, current.usage.objectCount - 1), totalBytes: Math.max(0, current.usage.totalBytes - object.size) } };
        cloudflareStorageViewRef.current = next;
        setCloudflareStorageView(next);
      }
      toast.success("Video object deleted from Cloudflare R2.");
      await loadCloudflareStorage();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete R2 object.");
    } finally {
      setCloudflareStorageBusyKey("");
    }
  }

  function toggleStorageObjectSelection(key: string) {
    setPreparedStorageDownloads([]);
    setSelectedStorageObjectKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAllVisibleStorageObjects() {
    setPreparedStorageDownloads([]);
    const visibleKeys = cloudflareStorageView?.objects.map((object) => object.key) ?? [];
    setSelectedStorageObjectKeys((current) => visibleKeys.length > 0 && visibleKeys.every((key) => current.has(key))
      ? new Set([...current].filter((key) => !visibleKeys.includes(key)))
      : new Set([...current, ...visibleKeys]));
  }

  async function prepareSelectedStorageDownloads() {
    const slot = cloudflareStorageView?.account.id;
    const keys = [...selectedStorageObjectKeys];
    if (!slot || !keys.length || storageBulkActionBusy) return;
    setStorageBulkActionBusy(true);
    try {
      const response = await fetch("/api/admin/cloudflare-video-storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, keys }),
      });
      const result = await response.json() as { downloads?: Array<{ key: string; url: string }>; error?: string };
      if (!response.ok || !result.downloads) throw new Error(result.error || "Could not prepare selected downloads");
      setPreparedStorageDownloads(result.downloads);
      toast.success(`${result.downloads.length} direct R2 download${result.downloads.length === 1 ? "" : "s"} ready. Click Start downloads to begin.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start selected downloads.");
    } finally {
      setStorageBulkActionBusy(false);
    }
  }

  function startPreparedStorageDownloads() {
    if (!preparedStorageDownloads.length) return;
    for (const download of preparedStorageDownloads) {
      const link = document.createElement("a");
      link.href = download.url;
      link.download = download.key.split("/").pop() ?? "video";
      link.rel = "noreferrer";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    toast.success(`Started ${preparedStorageDownloads.length} direct R2 download${preparedStorageDownloads.length === 1 ? "" : "s"}. If your browser asks, allow multiple downloads for this site.`);
  }

  async function deleteSelectedStorageObjects() {
    const slot = cloudflareStorageView?.account.id;
    const keys = [...selectedStorageObjectKeys];
    if (!slot || !keys.length || storageBulkActionBusy) return;
    if (!window.confirm(`Permanently delete ${keys.length} selected video object${keys.length === 1 ? "" : "s"} from the ${cloudflareStorageView.account.bucketName} bucket? Any video records pointing to them will stop playing.`)) return;
    setStorageBulkActionBusy(true);
    try {
      const response = await fetch("/api/admin/cloudflare-video-storage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, keys }),
      });
      const result = await response.json() as { deletedCount?: number; error?: string };
      if (!response.ok || typeof result.deletedCount !== "number") throw new Error(result.error || "Could not delete selected objects");
      setSelectedStorageObjectKeys(new Set());
      setPreparedStorageDownloads([]);
      toast.success(`Deleted ${result.deletedCount} storage object${result.deletedCount === 1 ? "" : "s"}.`);
      await loadCloudflareStorage();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete selected storage objects.");
    } finally {
      setStorageBulkActionBusy(false);
    }
  }

  async function submitVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (videoInputMode === "bulk") { await submitBulkVideoFiles(form); return; }
    let url = videoUrlInput.trim();
    const validHttps = (value: string) => { try { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password; } catch { return false; } };
    if (videoInputMode === "upload") {
      if (!selectedCloudflareAccountId) { setVideoUploadError("Choose a Cloudflare video account first."); return; }
      if (stagedUploadedVideo) url = stagedUploadedVideo.publicUrl;
      else if (!selectedVideoFile) { setVideoUploadError("Choose an MP4 or WebM file to upload."); return; }
      else if (!getVideoUploadContentType(selectedVideoFile)) { setVideoUploadError("Choose a video file with an .mp4 or .webm extension and matching media type."); return; }
      else if (selectedVideoFile.size > MAX_DIRECT_VIDEO_UPLOAD_BYTES) { setVideoUploadError("Video files must be 10 GB or smaller."); return; }
    } else if (!validHttps(url)) { toast.error("Enter a valid HTTPS video URL."); return; }
    const thumbnail = String(form.get("thumbnail_url") ?? "").trim();
    if (thumbnail && !validHttps(thumbnail)) { toast.error("Thumbnail URL must use HTTPS."); return; }
    const tags = String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const title = String(form.get("title") ?? "").trim();
    if (!title || title.length > 180 || tags.length > 30) { toast.error("Check the title and use no more than 30 tags."); return; }
    const categoryId = String(form.get("category_id") ?? "");
    if (!categoryId) { toast.error("Choose a category before saving the video."); return; }
    const videoMetadata = { title, description: String(form.get("description") ?? "").trim(), thumbnail_url: thumbnail || null, category_id: categoryId, tags, duration: String(form.get("duration") ?? "").trim(), featured: form.get("featured") === "on", published: form.get("published") === "on" };
    if (videoSubmitLock.current) return;
    videoSubmitLock.current = true; setVideoSubmitInProgress(true);
    const formElement = event.currentTarget;
    let savedVideo: VideoRecord | null = null;
    try {
      let uploadedStorage: StagedVideoUpload | null = stagedUploadedVideo;
      if (videoInputMode === "upload" && !stagedUploadedVideo && selectedVideoFile) {
        setVideoUploadError("");
        setVideoUploadProgress(0);
        const uploadContentType = getVideoUploadContentType(selectedVideoFile);
        if (!uploadContentType) throw new Error("Choose an MP4 or WebM file with a matching file extension.");
        const targetResponse = await fetch("/api/admin/videos/upload-target", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: selectedVideoFile.name, contentType: uploadContentType, size: selectedVideoFile.size, storageAccountSlot: selectedCloudflareAccountId }),
        });
        const target = await targetResponse.json() as { uploadUrl?: string; publicUrl?: string; contentType?: string; storageAccountSlot?: string; bucketName?: string; error?: string };
        if (!targetResponse.ok || !target.uploadUrl || !target.publicUrl || !target.storageAccountSlot || !target.bucketName || target.contentType !== uploadContentType) throw new Error(target.error || "Could not prepare the secure video upload.");
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", target.uploadUrl!);
          xhr.withCredentials = false;
          xhr.timeout = 60 * 60 * 1000;
          xhr.setRequestHeader("Content-Type", uploadContentType);
          xhr.upload.onprogress = (progress) => {
            if (progress.lengthComputable) setVideoUploadProgress(Math.round((progress.loaded / progress.total) * 100));
          };
          xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Cloudflare R2 upload failed (HTTP ${xhr.status}). Check the video bucket CORS settings.`));
          xhr.onerror = () => reject(new Error("Cloudflare R2 upload was blocked or interrupted. Check the video bucket CORS settings and try again."));
          xhr.ontimeout = () => reject(new Error("Video upload timed out. Check your connection and try again."));
          xhr.onabort = () => reject(new Error("Video upload was cancelled."));
          xhr.send(selectedVideoFile);
        });
        uploadedStorage = { publicUrl: target.publicUrl, storageAccountSlot: target.storageAccountSlot, bucketName: target.bucketName };
        setStagedUploadedVideo(uploadedStorage);
        url = target.publicUrl;
        setVideoUploadProgress(100);
      }
      const data = { ...videoMetadata, video_url: url, cloudflare_video_account_slot: videoInputMode === "upload" ? uploadedStorage?.storageAccountSlot ?? null : null, cloudflare_video_bucket_name: videoInputMode === "upload" ? uploadedStorage?.bucketName ?? null : null };
      if (editingVideo) {
        const updated = await videosHook.update(editingVideo.id, data);
        if (updated) savedVideo = { ...editingVideo, ...data, updated_at: new Date().toISOString() };
      } else {
        let saveResult = await videosHook.createDetailed(data);
        for (let retry = 0; !saveResult.video && retry < 2; retry += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (retry + 1)));
          saveResult = await videosHook.createDetailed(data);
        }
        if (!saveResult.video) throw new Error(saveResult.error || "Database rejected the video record. The upload is complete; retry will not upload the file again.");
        savedVideo = saveResult.video;
      }
    } catch (error) {
      setVideoUploadError(error instanceof Error ? error.message : "Video upload failed. Please try again.");
      toast.error(error instanceof Error ? error.message : "Video upload failed. Please try again.");
      return;
    } finally { videoSubmitLock.current = false; setVideoSubmitInProgress(false); }

    if (!savedVideo) return;
    formElement.reset();
    setSelectedCategoryId("");
    setEditingVideo(null);
    setVideoInputMode("url");
    setVideoUrlInput("");
    setSelectedVideoFile(null);
    setStagedUploadedVideo(null);
    setVideoUploadProgress(null);
    setVideoUploadError("");
    goToVideos(1, true);
    if (!editingVideo) toast.success("Video added successfully");
    void videosHook.refresh();
    void categoriesHook.refresh();
    void statsHook.refresh();
    if (!thumbnail) void generateThumbnailFor(savedVideo);
  }
  async function submitBulkVideoFiles(form: FormData) {
    const pending = bulkUploadItemsRef.current.filter((item) => item.status !== "saved");
    if (pending.length === 0) { toast.info("Choose videos to upload first."); return; }
    const selectedAccount = cloudflareVideoAccounts.find((account) => account.id === selectedCloudflareAccountId && account.isActive);
    if (!selectedAccount) { setVideoUploadError("Choose an active Cloudflare video account first."); return; }
    const categoryId = String(form.get("category_id") ?? "");
    if (!categoryId) { setVideoUploadError("Choose a category for these videos."); return; }
    const invalid = pending.find((item) => !getVideoUploadContentType(item.file) || item.file.size <= 0 || item.file.size > MAX_DIRECT_VIDEO_UPLOAD_BYTES || !item.title);
    if (invalid) {
      updateBulkUploadItems((current) => current.map((item) => item.id === invalid.id ? { ...item, status: "failed", error: !item.title ? "Filename does not contain a usable title." : !getVideoUploadContentType(item.file) ? "Only MP4 or WebM files are supported." : "File must be smaller than or equal to 10 GB." } : item));
      return;
    }

    if (videoSubmitLock.current) return;
    videoSubmitLock.current = true;
    setVideoSubmitInProgress(true);
    setVideoUploadError("");
    let succeeded = 0;
    let failed = 0;
    const sharedTags = String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    if (sharedTags.length > 30) {
      videoSubmitLock.current = false;
      setVideoSubmitInProgress(false);
      setVideoUploadError("Use no more than 30 shared tags for this batch.");
      return;
    }
    const sharedFields = {
      description: String(form.get("description") ?? "").trim(),
      category_id: categoryId,
      tags: sharedTags,
      duration: "",
      featured: form.get("featured") === "on",
      published: form.get("published") === "on",
    };

    try {
      for (const batchItem of pending) {
        updateBulkUploadItems((current) => current.map((item) => item.id === batchItem.id ? { ...item, status: "uploading", error: undefined, progress: item.uploadedUrl ? 100 : 0 } : item));
        try {
          let publicUrl = batchItem.uploadedUrl;
          let storageAccountSlot = batchItem.storageAccountSlot;
          let bucketName = batchItem.bucketName;
          if (!publicUrl) {
            const uploaded = await uploadVideoFileDirectly(batchItem.file, selectedAccount.id, (progress) => {
              updateBulkUploadItems((current) => current.map((item) => item.id === batchItem.id ? { ...item, progress } : item));
            });
            publicUrl = uploaded.publicUrl;
            storageAccountSlot = uploaded.storageAccountSlot;
            bucketName = uploaded.bucketName;
            updateBulkUploadItems((current) => current.map((item) => item.id === batchItem.id ? { ...item, uploadedUrl: publicUrl, storageAccountSlot, bucketName, progress: 100 } : item));
          }
          updateBulkUploadItems((current) => current.map((item) => item.id === batchItem.id ? { ...item, status: "saving" } : item));
          const recordInput = { ...sharedFields, title: batchItem.title, video_url: publicUrl!, thumbnail_url: null, cloudflare_video_account_slot: storageAccountSlot ?? selectedAccount.id, cloudflare_video_bucket_name: bucketName ?? selectedAccount.bucketName };
          let saveResult = await videosHook.createDetailed(recordInput);
          for (let retry = 0; !saveResult.video && retry < 2; retry += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500 * (retry + 1)));
            saveResult = await videosHook.createDetailed(recordInput);
          }
          if (!saveResult.video) throw new Error(saveResult.error || "Database rejected the video record. The upload is complete; retry will not upload the file again.");
          const saved = saveResult.video;
          updateBulkUploadItems((current) => current.map((item) => item.id === batchItem.id ? { ...item, status: "saved", progress: 100, error: undefined } : item));
          succeeded++;
          void generateThumbnailFor(saved, { quiet: true, refreshAfter: false });
        } catch (error) {
          failed++;
          updateBulkUploadItems((current) => current.map((item) => item.id === batchItem.id ? { ...item, status: "failed", error: error instanceof Error ? error.message : "Upload failed. Try again." } : item));
        }
      }
      await Promise.all([videosHook.refresh(), statsHook.refresh(), categoriesHook.refresh()]);
      if (failed) toast.warning(`Bulk upload finished: ${succeeded} saved, ${failed} failed. Retry failed items below.`);
      else toast.success(`${succeeded} videos uploaded and saved.`);
    } finally {
      videoSubmitLock.current = false;
      setVideoSubmitInProgress(false);
    }
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setCategoryFormError("");
    const imageUrl = quickCategory ? "" : String(form.get("image_url") ?? "").trim();
    if (imageUrl) { try { if (new URL(imageUrl).protocol !== "https:") throw new Error(); } catch { toast.error("Category image URL must use HTTPS."); return; } }
    const name = String(form.get("name") ?? "").trim();
    if (!name || name.length > 80) { toast.error("Category name must be between 1 and 80 characters."); return; }
    const data = { name, description: String(form.get("description") ?? "").trim(), image_url: imageUrl || null };
    let category: Category | null = null;
    if (editingCategory) {
      const ok = await categoriesHook.update(editingCategory.id, data);
      if (!ok) { setCategoryFormError(categoriesHook.errorMessage || "Could not update category."); return; }
      category = { ...editingCategory, ...data, updated_at: new Date().toISOString() };
    } else {
      const result = await categoriesHook.create(data);
      if (!result.category) { setCategoryFormError(result.error || "Could not create category."); return; }
      category = result.category;
    }
    setCategoryDialog(false); setEditingCategory(null); await statsHook.refresh();
    if (quickCategory && category) {
      categoryOptionsHook.add(category);
      setSelectedCategoryId(category.id);
      await categoryOptionsHook.refresh();
    } else await categoryOptionsHook.refresh();
  }
  async function removeVideo(id: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/admin/videos/${encodeURIComponent(id)}/thumbnail`, { method: "DELETE" });
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || "Could not clean up the generated thumbnail"); }
      const removed = await videosHook.remove(id);
      if (removed) { await statsHook.refresh(); await categoriesHook.refresh(); }
      return removed;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete video and thumbnail."); return false; }
  }
  async function generateThumbnailFor(video: Pick<VideoRecord, "id" | "title" | "video_url" | "duration" | "thumbnail_url">, options: { quiet?: boolean; refreshAfter?: boolean; batchJob?: boolean } = {}) {
    if ((thumbnailBatchLock.current || videoCheckLock.current) && !options.batchJob) return false;
    if (thumbnailGenerationLocks.current.has(video.id)) return false;
    thumbnailGenerationLocks.current.add(video.id);
    setGeneratingThumbnailIds((current) => new Set(current).add(video.id));
    try {
      const image = await generateVideoThumbnail(video.video_url, video.duration);
      const response = await fetch(`/api/admin/videos/${encodeURIComponent(video.id)}/thumbnail`, { method: "POST", headers: { "Content-Type": image.type }, body: image });
      const result = await response.json() as { thumbnail_url?: string; error?: string };
      if (!response.ok || !result.thumbnail_url) throw new Error(result.error || "Thumbnail upload failed");
      if (options.refreshAfter !== false) await videosHook.refresh();
      if (!options.quiet) toast.success(`Thumbnail generated: ${video.title}`);
      return true;
    } catch (error) {
      if (process.env.NODE_ENV === "development") console.error("[video-thumbnail] regeneration failed", { videoId: video.id, sourceHost: (() => { try { return new URL(video.video_url).host; } catch { return "invalid URL"; } })(), errorType: error instanceof Error ? error.name : "UnknownError" });
      if (!options.quiet) toast.error(`Thumbnail could not be generated for ${video.title}. Try again or use a different source.`);
      return false;
    } finally {
      thumbnailGenerationLocks.current.delete(video.id);
      setGeneratingThumbnailIds((current) => { const next = new Set(current); next.delete(video.id); return next; });
    }
  }
  async function generateMissingThumbnails() {
    if (thumbnailBatchLock.current || videoCheckLock.current) return;
    thumbnailBatchLock.current = true;
    setThumbnailBatchRunning(true);
    try {
      setThumbnailBatchProgress("Finding videos missing thumbnails…");
      const missing = await videosHook.getMissingThumbnails();
      if (!missing) return;
      if (!missing.length) { toast.success("All videos already have thumbnails."); return; }
      let generated = 0;
      for (let index = 0; index < missing.length; index++) {
        const video = missing[index];
        setThumbnailBatchProgress(`Generating ${index + 1} of ${missing.length}: ${video.title}`);
        if (await generateThumbnailFor(video, { batchJob: true })) generated++;
      }
      toast.success(`Generated ${generated} of ${missing.length} missing thumbnails.`);
    } finally {
      thumbnailBatchLock.current = false;
      setThumbnailBatchRunning(false);
      setThumbnailBatchProgress("");
    }
  }
  async function regenerateAllThumbnails() {
    if (thumbnailBatchLock.current || videoCheckLock.current) return;
    thumbnailBatchLock.current = true;
    setThumbnailBatchRunning(true);
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    try {
      setThumbnailBatchProgress("Loading all videos…");
      const allVideos = await videosHook.getAllVideosForThumbnailRegeneration();
      if (!allVideos) { setThumbnailBatchProgress(""); return; }
      const videosToRegenerate = allVideos.filter((video) => Boolean(video.thumbnail_url));
      if (videosToRegenerate.length === 0) {
        toast.success("There are no videos with thumbnails to regenerate.");
        setThumbnailBatchProgress("");
        return;
      }
      setThumbnailBatchProgress(`Regenerating thumbnails… 0 / ${videosToRegenerate.length} completed`);
      for (const video of videosToRegenerate) {
        if (await generateThumbnailFor(video, { quiet: true, refreshAfter: false, batchJob: true })) succeeded++;
        else failed++;
        completed++;
        setThumbnailBatchProgress(`Regenerating thumbnails… ${completed} / ${videosToRegenerate.length} completed`);
      }
      await videosHook.refresh();
      const completion = `Thumbnail regeneration complete — ${succeeded} succeeded, ${failed} failed${failed ? ". Failed videos can be regenerated individually later." : "."}`;
      setThumbnailBatchProgress(completion);
      if (failed) toast.error(completion);
      else toast.success(completion);
    } catch {
      setThumbnailBatchProgress("");
      toast.error("Thumbnail regeneration could not be completed. Try again.");
    } finally {
      thumbnailBatchLock.current = false;
      setThumbnailBatchRunning(false);
    }
  }
  async function checkSingleVideo(video: VideoRecord) {
    if (videoCheckLock.current || thumbnailBatchLock.current || checkingVideoIds.has(video.id)) return;
    videoCheckLock.current = true;
    setCheckingVideoIds((current) => new Set(current).add(video.id));
    try {
      const response = await fetch("/api/admin/videos/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id }),
      });
      const result = await response.json() as { videoId?: string; title?: string; status?: VideoCheckStatus; reason?: string; error?: string };
      if (!response.ok || !result.status) throw new Error(result.error || "Video check failed");
      if (result.status === "working") { toast.success(`${video.title}: video source is working.`); return; }
      if (result.status === "recovered") { toast.warning(`${video.title}: the source recovered on retry and remains published.`); return; }
      if (result.status === "temporary") { toast.warning(`${video.title}: temporary source failure (${result.reason}). It remains published.`); return; }
      if (result.status === "skipped") { toast.info(`${video.title}: no longer published; no changes made.`); return; }
      if (result.status !== "broken") throw new Error("Unexpected video check result");

      const confirmed = window.confirm(`${video.title} is confirmed broken (${result.reason}). Unpublish it? The video record, thumbnail, and metadata will be preserved.`);
      if (!confirmed) { toast.info(`${video.title} remains published.`); return; }
      const unpublishResponse = await fetch("/api/admin/videos/check", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: [video.id] }),
      });
      const unpublishResult = await unpublishResponse.json() as { results?: Array<{ videoId: string; status: VideoCheckStatus; reason: string }>; error?: string };
      if (!unpublishResponse.ok) throw new Error(unpublishResult.error || "Could not confirm the unpublish action");
      const finalResult = unpublishResult.results?.find((item) => item.videoId === video.id);
      if (finalResult?.status === "unpublished") {
        toast.success(`${video.title} was unpublished. Its video record, thumbnail, and metadata were preserved.`);
        await videosHook.refresh();
        await statsHook.refresh();
      } else if (finalResult?.status === "working" || finalResult?.status === "recovered") {
        toast.success(`${video.title} is now working and remains published.`);
      } else {
        toast.warning(`${video.title} was not unpublished because the retry was inconclusive. ${finalResult?.reason ?? "It remains published."}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Video check failed. No publication changes were made.");
    } finally {
      videoCheckLock.current = false;
      setCheckingVideoIds((current) => { const next = new Set(current); next.delete(video.id); return next; });
    }
  }

  async function checkAllVideos() {
    if (videoCheckLock.current || thumbnailBatchLock.current) return;
    videoCheckLock.current = true;
    setVideoCheckRunning(true);
    setVideoCheckProgress("Loading published videos…");
    setVideoCheckFailure("");
    setVideoCheckResults([]);
    setVideoCheckSummary(null);
    let unpublishRequestStarted = false;
    try {
      const listResponse = await fetch("/api/admin/videos/check", { cache: "no-store" });
      const listPayload = await listResponse.json() as { videos?: Array<{ id: string; title: string }>; error?: string };
      if (!listResponse.ok || !listPayload.videos) throw new Error(listPayload.error || "Could not load published videos");
      const videos = listPayload.videos;
      if (videos.length === 0) {
        const emptySummary = { checked: 0, working: 0, recovered: 0, temporary: 0, unpublished: 0, skipped: 0 };
        setVideoCheckSummary(emptySummary);
        setVideoCheckProgress("");
        toast.success("Video check complete. No published videos to check.");
        return;
      }

      const initialResults: Array<VideoCheckResult | undefined> = new Array(videos.length);
      let nextIndex = 0;
      let completed = 0;
      let scanFailed = false;
      setVideoCheckProgress(`Checking videos… 0 / ${videos.length}`);
      const worker = async () => {
        while (!scanFailed) {
          const index = nextIndex++;
          if (index >= videos.length) return;
          try {
            const response = await fetch("/api/admin/videos/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ videoId: videos[index].id }),
            });
            const result = await response.json() as { videoId?: string; title?: string; status?: VideoCheckStatus; reason?: string; error?: string };
            if (!response.ok || !result.status) throw new Error(result.error || "A video check could not be completed safely");
            if ((result.status as string) === "internal") throw new Error("The secure checker encountered an internal error");
            initialResults[index] = {
              videoId: videos[index].id,
              title: videos[index].title,
              status: result.status,
              reason: result.reason ?? "No additional details",
              action: result.status === "broken" ? "Awaiting final confirmation" : result.status === "skipped" ? "No changes made" : "Remains published",
            };
            completed++;
            setVideoCheckResults(initialResults.filter((item): item is VideoCheckResult => Boolean(item)));
            setVideoCheckProgress(`Checking videos… ${completed} / ${videos.length}`);
          } catch {
            scanFailed = true;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, videos.length) }, () => worker()));
      if (scanFailed) {
        const partialResults = initialResults.filter((item): item is VideoCheckResult => Boolean(item)).map((item) => item.status === "broken" ? { ...item, action: "Not changed; scan stopped" } : item);
        setVideoCheckResults(partialResults);
        setVideoCheckFailure("The scan stopped because the checker encountered an unexpected error. No videos were unpublished.");
        setVideoCheckProgress("");
        toast.error("Video scan stopped. No videos were unpublished.");
        return;
      }

      let finalResults = initialResults.filter((item): item is VideoCheckResult => Boolean(item));
      const brokenIds = finalResults.filter((item) => item.status === "broken").map((item) => item.videoId);
      if (brokenIds.length > 0) {
        setVideoCheckProgress(`Confirming ${brokenIds.length} broken source${brokenIds.length === 1 ? "" : "s"}…`);
        unpublishRequestStarted = true;
        const response = await fetch("/api/admin/videos/check", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoIds: brokenIds }),
        });
        const payload = await response.json() as { results?: Array<{ videoId: string; title: string; status: VideoCheckStatus; reason: string }>; error?: string };
        if (!response.ok || !payload.results) throw new Error(payload.error || "Could not confirm broken video results");
        const finalById = new Map(payload.results.map((item) => [item.videoId, item]));
        finalResults = finalResults.map((item) => {
          const final = finalById.get(item.videoId);
          if (!final) return item;
          return {
            ...item,
            title: final.title || item.title,
            status: final.status,
            reason: final.reason,
            action: final.status === "unpublished" ? "Unpublished" : final.status === "skipped" ? "No changes made" : "Remains published",
          };
        });
        if (payload.results.some((item) => item.status === "unpublished")) {
          await videosHook.refresh();
          await statsHook.refresh();
        }
      }

      setVideoCheckResults(finalResults);
      const summary: VideoCheckSummary = {
        checked: finalResults.length,
        working: finalResults.filter((item) => item.status === "working").length,
        recovered: finalResults.filter((item) => item.status === "recovered").length,
        temporary: finalResults.filter((item) => item.status === "temporary").length,
        unpublished: finalResults.filter((item) => item.status === "unpublished").length,
        skipped: finalResults.filter((item) => item.status === "skipped").length,
      };
      setVideoCheckSummary(summary);
      setVideoCheckProgress("");
      const message = `Video check complete — ${summary.checked} checked, ${summary.working} working, ${summary.recovered + summary.temporary} temporarily failed/recovered, ${summary.unpublished} confirmed broken and unpublished`;
      if (summary.unpublished > 0 || summary.temporary > 0) toast.warning(message);
      else toast.success(message);
    } catch (error) {
      const message = unpublishRequestStarted
        ? "The final unpublish step could not be confirmed. Refresh the video list before retrying."
        : "The scan stopped because of an unexpected error. No videos were unpublished.";
      setVideoCheckFailure(message);
      setVideoCheckProgress("");
      toast.error(error instanceof Error ? `${message} ${error.message}` : message);
    } finally {
      videoCheckLock.current = false;
      setVideoCheckRunning(false);
    }
  }
  async function openDeleteAllInCategory() {
    if (!categoryFilter || mediaMaintenanceRunning || bulkDeleteBusy || bulkDeleteLock.current) return;
    bulkDeleteLock.current = true;
    setBulkDeleteBusy(true);
    try {
      const response = await fetch(`/api/admin/videos/bulk-delete?categoryId=${encodeURIComponent(categoryFilter)}`, { cache: "no-store" });
      const preview = await response.json() as { categoryId?: string; categoryName?: string; videoIds?: string[]; count?: number; error?: string };
      if (!response.ok || !preview.categoryId || !preview.videoIds || typeof preview.count !== "number") throw new Error(preview.error || "Could not load videos for this category");
      if (preview.count === 0) { toast.info(`There are no videos in ${preview.categoryName || "this category"}.`); return; }
      setBulkDeletePreview({ categoryId: preview.categoryId, categoryName: preview.categoryName || "selected category", videoIds: preview.videoIds, count: preview.count });
      setBulkDeleteCode("");
      setBulkDeleteDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare category deletion.");
    } finally {
      bulkDeleteLock.current = false;
      setBulkDeleteBusy(false);
    }
  }

  async function confirmDeleteAllInCategory() {
    if (!bulkDeletePreview || bulkDeleteBusy || bulkDeleteLock.current || !/^\d{6}$/.test(bulkDeleteCode)) return;
    bulkDeleteLock.current = true;
    setBulkDeleteBusy(true);
    try {
      const response = await fetch("/api/admin/videos/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: bulkDeletePreview.categoryId, videoIds: bulkDeletePreview.videoIds, code: bulkDeleteCode }),
      });
      const result = await response.json() as { deletedCount?: number; error?: string };
      if (!response.ok || typeof result.deletedCount !== "number") throw new Error(result.error || "Could not delete category videos");
      setBulkDeleteDialogOpen(false);
      setBulkDeleteCode("");
      setBulkDeletePreview(null);
      goToVideos(1, true);
      await Promise.all([videosHook.refresh(), statsHook.refresh()]);
      await categoriesHook.refresh();
      toast.success(`Deleted ${result.deletedCount} videos from ${bulkDeletePreview.categoryName}.`);
    } catch (error) {
      setBulkDeleteCode("");
      toast.error(error instanceof Error ? error.message : "Could not confirm the deletion result. Refresh the category before retrying.");
    } finally {
      bulkDeleteLock.current = false;
      setBulkDeleteBusy(false);
    }
  }
  async function toggleVideo(video: VideoRecord, field: "published" | "featured") { await videosHook.update(video.id, { [field]: !video[field] }); await statsHook.refresh(); }
  async function deleteCategory(category: Category) {
    if (!window.confirm(`Delete “${category.name}”? Categories with videos cannot be deleted.`)) return;
    await categoriesHook.remove(category.id); await categoryOptionsHook.refresh(); await statsHook.refresh();
  }

  const nav = [{ name: "Dashboard", icon: LayoutDashboard }, { name: "Videos", icon: Film }, { name: "Add Video", icon: Plus }, { name: "Categories", icon: FolderOpen }, { name: "Cloudflare Storage", icon: Cloud }, { name: "Settings", icon: Settings }];
  const mediaMaintenanceRunning = thumbnailBatchRunning || videoCheckRunning || videoCheckLock.current || bulkDeleteBusy;

  async function scanDuplicateVideos() {
    if (duplicateScanBusy || duplicateDeleteBusy || mediaMaintenanceRunning) return;
    setDuplicateScanBusy(true);
    setDuplicateScanError("");
    setDuplicateGroups([]);
    setSelectedDuplicateVideoIds(new Set());
    try {
      const videos = await videosHook.getVideosForDuplicateScan(categoryFilter || undefined);
      if (!videos) throw new Error("Could not load videos for the duplicate scan.");
      const parents = new Map(videos.map((video) => [video.id, video.id]));
      const rootOf = (id: string): string => {
        const parent = parents.get(id) ?? id;
        if (parent === id) return id;
        const root = rootOf(parent);
        parents.set(id, root);
        return root;
      };
      const union = (a: string, b: string) => { const rootA = rootOf(a), rootB = rootOf(b); if (rootA !== rootB) parents.set(rootB, rootA); };
      const byUrl = new Map<string, string[]>();
      const byTitle = new Map<string, string[]>();
      for (const video of videos) {
        const url = normalizeDuplicateVideoUrl(video.video_url);
        const title = normalizeDuplicateVideoTitle(video.title);
        if (url) byUrl.set(url, [...(byUrl.get(url) ?? []), video.id]);
        if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), video.id]);
      }
      for (const matches of [...byUrl.values(), ...byTitle.values()]) {
        for (let index = 1; index < matches.length; index += 1) union(matches[0], matches[index]);
      }
      const components = new Map<string, DuplicateVideoCandidate[]>();
      for (const video of videos) {
        const root = rootOf(video.id);
        components.set(root, [...(components.get(root) ?? []), video]);
      }
      const duplicates: DuplicateVideoGroup[] = [];
      for (const [root, matches] of components) {
        if (matches.length < 2) continue;
        const ordered = [...matches].sort((a, b) => b.views - a.views || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
        const keep = ordered[0];
        const sameUrl = new Set(matches.map((video) => normalizeDuplicateVideoUrl(video.video_url))).size < matches.length;
        const sameTitle = new Set(matches.map((video) => normalizeDuplicateVideoTitle(video.title))).size < matches.length;
        const keepUrl = normalizeDuplicateVideoUrl(keep.video_url);
        const autoDeleteIds = ordered.slice(1).filter((video) => normalizeDuplicateVideoUrl(video.video_url) === keepUrl).map((video) => video.id);
        duplicates.push({ key: root, matchBasis: sameUrl && sameTitle ? "Exact source URL and title matches" : sameUrl ? "Exact source URL matches" : "Exact title matches; review before deleting", keep, duplicates: ordered.slice(1), autoDeleteIds });
      }
      setDuplicateGroups(duplicates);
      setSelectedDuplicateVideoIds(new Set(duplicates.flatMap((group) => group.autoDeleteIds)));
      if (duplicates.length) toast.info(`Found ${duplicates.reduce((count, group) => count + group.duplicates.length, 0)} duplicate candidates by exact source URL or exact title. Highest-view records are marked to keep.`);
      else toast.success("No exact-source URL or exact-title duplicate groups found.");
    } catch (error) {
      setDuplicateScanError(error instanceof Error ? error.message : "Could not scan for duplicates.");
    } finally {
      setDuplicateScanBusy(false);
    }
  }

  async function deleteSelectedDuplicateVideos() {
    const ids = [...selectedDuplicateVideoIds];
    if (!ids.length || duplicateDeleteBusy || !window.confirm(`Delete ${ids.length} selected duplicate video record${ids.length === 1 ? "" : "s"}? The highest-view record in each match group is kept. This removes video records and app-generated thumbnails, but does not delete original R2/external video files.`)) return;
    setDuplicateDeleteBusy(true);
    let deleted = 0;
    const failedIds = new Set<string>();
    try {
      for (const id of ids) {
        const ok = await removeVideo(id);
        if (ok) deleted++; else failedIds.add(id);
      }
      setDuplicateGroups((current) => current.map((group) => ({ ...group, duplicates: group.duplicates.filter((video) => failedIds.has(video.id)) })).filter((group) => group.duplicates.length > 0));
      setSelectedDuplicateVideoIds(failedIds);
      await Promise.all([videosHook.refresh(), statsHook.refresh(), categoriesHook.refresh()]);
      if (failedIds.size) toast.warning(`Deleted ${deleted} duplicate records; ${failedIds.size} failed. Review and retry the remaining items.`);
      else toast.success(`Deleted ${deleted} duplicate video records. Original video files were preserved.`);
    } finally {
      setDuplicateDeleteBusy(false);
    }
  }

  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><a href="/" className="dash-back"><ArrowLeft size={15}/> Public library</a><div className="dash-kicker"><ShieldCheck size={15}/> ADMIN</div><nav>{nav.map(({ name, icon: Icon }) => <button key={name} className={section === name ? "dash-nav active" : "dash-nav"} onClick={() => navigateSection(name)}><Icon size={16}/>{name}</button>)}</nav><button className="dash-logout" onClick={logout}><LogOut size={15}/> Sign out</button></aside>
    <section className="dashboard-content"><header className="dashboard-top"><span>LIBRARY MANAGEMENT</span><button onClick={logout}><LogOut size={14}/> Sign out</button></header>
       {section === "Dashboard" && <><div className="admin-heading"><div><span className="eyebrow">OVERVIEW</span><h1>Dashboard</h1><p>Your library at a glance.</p></div><button className="button-primary" onClick={() => openVideo()}><Plus size={15}/> Add video</button></div><div className="stats-row"><Stat label="Total videos" value={stats?.total_videos}/><Stat label="Published" value={stats?.published_videos}/><Stat label="Categories" value={stats?.total_categories}/><Stat label="Total views" value={stats?.total_views}/></div>{showDashboardStatsDiagnostics && statsHook.diagnostic && <section className="dashboard-diagnostic" role="alert" aria-live="assertive"><h2>Dashboard statistics failed</h2><p>phase: {statsHook.diagnostic.phase}</p><p>message: {statsHook.diagnostic.message}</p><p>code: {statsHook.diagnostic.code ?? "(none)"}</p><p>details: {statsHook.diagnostic.details ?? "(none)"}</p><p>hint: {statsHook.diagnostic.hint ?? "(none)"}</p></section>}<div className="table-heading"><h2>Recently added</h2><button onClick={() => goToVideos()}>Manage videos <ArrowLeft size={13}/></button></div><VideoTable videos={videosHook.videos.slice(0, 6)} categories={categoriesHook.categories} onEdit={openVideo} onDelete={removeVideo} onToggle={toggleVideo} onGenerateThumbnail={generateThumbnailFor} generatingThumbnailIds={generatingThumbnailIds}/></>}
       {section === "Videos" && <>
         <div className="admin-heading">
            <div><span className="eyebrow">LIBRARY</span><h1>Videos</h1><p>Search, update, and publish your collection.</p></div>
            <div className="video-header-actions">
              <button className="secondary-action" onClick={generateMissingThumbnails} disabled={mediaMaintenanceRunning}>{thumbnailBatchRunning ? "Generating thumbnails..." : "Generate Missing Thumbnails"}</button>
              <button className="secondary-action" onClick={() => setRegenerateAllConfirmOpen(true)} disabled={mediaMaintenanceRunning}>Regenerate All Thumbnails</button>
              <button className="secondary-action" onClick={() => setCheckAllConfirmOpen(true)} disabled={mediaMaintenanceRunning}>{videoCheckRunning ? "Checking videos..." : "Check All Videos"}</button>
              <button className="secondary-action" onClick={() => void scanDuplicateVideos()} disabled={duplicateScanBusy || duplicateDeleteBusy || mediaMaintenanceRunning}>{duplicateScanBusy ? "Scanning duplicates…" : "Find Duplicate Videos"}</button>
              <button className="secondary-action delete-category-videos-action" onClick={() => void openDeleteAllInCategory()} disabled={!categoryFilter || mediaMaintenanceRunning} title={categoryFilter ? "Delete every video in the selected category" : "Select a category first"}>Delete All in Category</button>
              <button className="button-primary" onClick={() => openVideo()}><Plus size={15}/> Add video</button>
            </div>
          </div>
          {thumbnailBatchProgress && <p className="thumbnail-status" role="status">{thumbnailBatchProgress}</p>}
          {videoCheckProgress && <p className="video-check-progress" role="status">{videoCheckProgress}</p>}
         <div className="table-tools">
           <label><Search size={15}/><input value={search} onChange={(event) => changeVideoSearch(event.target.value)} placeholder="Search videos"/></label>
           <select value={categoryFilter} onChange={(event) => changeVideoCategory(event.target.value)}><option value="">All categories</option>{categoriesHook.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
           <select value={publishedFilter} onChange={(event) => changeVideoStatus(event.target.value)}><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Unpublished</option></select>
         </div>
          <VideoTable videos={videosHook.videos} categories={categoriesHook.categories} onEdit={openVideo} onDelete={removeVideo} onToggle={toggleVideo} onGenerateThumbnail={generateThumbnailFor} generatingThumbnailIds={generatingThumbnailIds} onCheckVideo={checkSingleVideo} checkingVideoIds={checkingVideoIds} checkDisabled={mediaMaintenanceRunning}/>
          <VideoPagination page={videoPage} totalPages={adminTotalPages} loading={videosHook.loading} onPageChange={(page) => goToVideos(page, false)} hideNextOnLast/>
          {(duplicateScanBusy || duplicateScanError || duplicateGroups.length > 0) && <section className="duplicate-video-results" aria-live="polite">
            <div className="duplicate-video-results-heading"><div><h2>{duplicateScanBusy ? "Scanning duplicate sources…" : "Duplicate videos"}</h2><p>Exact normalized source URLs and exact normalized titles are matched. Highest-view record is kept; title-only matches are not preselected, so review them carefully.</p></div><span>{duplicateGroups.reduce((count, group) => count + group.duplicates.length, 0)} candidates</span></div>
            {duplicateScanError && <p className="field-error" role="alert">{duplicateScanError}</p>}
            {duplicateGroups.map((group) => <div className="duplicate-video-group" key={group.key}>
              <p className="duplicate-video-source">{group.matchBasis}</p>
              <p className="duplicate-video-source">Source: {normalizeDuplicateVideoUrl(group.keep.video_url).split("?")[0]}</p>
              <div className="duplicate-video-row kept"><span className="duplicate-video-keep-badge">KEEP</span><div><strong>{group.keep.title}</strong><small>{group.keep.views.toLocaleString()} views · {group.keep.category_id === categoryFilter ? "Selected category" : "Existing record"}</small></div></div>
              {group.duplicates.map((video) => <label className="duplicate-video-row" key={video.id}><input type="checkbox" checked={selectedDuplicateVideoIds.has(video.id)} disabled={duplicateDeleteBusy} onChange={() => setSelectedDuplicateVideoIds((current) => { const next = new Set(current); if (next.has(video.id)) next.delete(video.id); else next.add(video.id); return next; })}/><div><strong>{video.title}</strong><small>{video.views.toLocaleString()} views · {video.created_at ? new Date(video.created_at).toLocaleDateString() : ""}</small></div><span>Duplicate</span></label>)}
            </div>)}
            {!duplicateScanBusy && !duplicateScanError && duplicateGroups.length === 0 && <p className="admin-empty">No duplicate source URLs found in {categoryFilter ? "the selected category" : "the library"}.</p>}
            {duplicateGroups.length > 0 && <div className="duplicate-video-actions"><span>{selectedDuplicateVideoIds.size} duplicate records selected</span><button className="cloudflare-storage-delete" type="button" disabled={!selectedDuplicateVideoIds.size || duplicateDeleteBusy} onClick={() => void deleteSelectedDuplicateVideos()}>{duplicateDeleteBusy ? "Deleting duplicates…" : "Delete selected duplicates"}</button></div>}
          </section>}
          {(videoCheckRunning || videoCheckSummary || videoCheckFailure) && <section className="video-check-results" aria-live="polite">
           <div className="video-check-results-heading"><h2>{videoCheckRunning ? "Video check in progress" : videoCheckFailure ? "Video check stopped" : "Video check complete"}</h2></div>
           {videoCheckSummary && <p className="video-check-summary">{videoCheckSummary.checked} checked<br/>{videoCheckSummary.working} working<br/>{videoCheckSummary.recovered + videoCheckSummary.temporary} temporarily failed/recovered<br/>{videoCheckSummary.unpublished} confirmed broken and unpublished{videoCheckSummary.skipped > 0 && <><br/>{videoCheckSummary.skipped} skipped</>}</p>}
           {videoCheckFailure && <p className="video-check-failure" role="alert">{videoCheckFailure}</p>}
           {videoCheckResults.length > 0 && <div className="video-check-table-wrap"><table className="video-check-table"><thead><tr><th>Video</th><th>Status</th><th>Reason</th><th>Action</th></tr></thead><tbody>{videoCheckResults.map((result) => <tr key={result.videoId}><td>{result.title}</td><td>{videoCheckStatusLabel(result.status, result.action)}</td><td>{result.reason}</td><td>{result.action}</td></tr>)}</tbody></table></div>}
         </section>}
       </>}
      {section === "Add Video" && <><div className="admin-heading add-video-heading"><div><span className="eyebrow">LIBRARY</span><h1>{editingVideo ? "Edit video" : "Add video"}</h1><p>Videos can be linked directly or uploaded to your video storage.</p></div></div><div className="video-editor-card"><form key={editingVideo?.id ?? "new-video"} onSubmit={submitVideo}>{videoInputMode !== "url" && <div className="cloudflare-video-account-picker"><label htmlFor="video-storage-account">CLOUDFLARE VIDEO ACCOUNT</label><div className="cloudflare-video-account-controls"><select id="video-storage-account" value={selectedCloudflareAccountId} onChange={(event) => setSelectedCloudflareAccountId(event.target.value)} disabled={videoSubmitInProgress || cloudflareAccountsLoading}><option value="">{cloudflareAccountsLoading ? "Loading accounts…" : "Select account slot"}</option>{cloudflareVideoAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} — {account.bucketName}{account.isDefault ? " (default)" : ""}</option>)}</select></div>{cloudflareVideoAccounts.filter((account) => account.isActive).length === 0 && !cloudflareAccountsLoading && <small>Account slots are loaded from server secrets. Configure accounts 1, 2, or 3 in deployment secrets; the configured default slot is preselected.</small>}{cloudflareAccountsError && <p className="field-error" role="alert">{cloudflareAccountsError}</p>}</div>}<div className="video-source-mode" role="group" aria-label="Video source"><button type="button" className={videoInputMode === "upload" ? "active" : ""} aria-pressed={videoInputMode === "upload"} disabled={videoSubmitInProgress} onClick={() => { setVideoInputMode("upload"); setVideoUploadError(""); }}>Upload video</button><button type="button" className={videoInputMode === "url" ? "active" : ""} aria-pressed={videoInputMode === "url"} disabled={videoSubmitInProgress} onClick={() => { setVideoInputMode("url"); setVideoUploadError(""); }}>Add URL</button><button type="button" className={videoInputMode === "bulk" ? "active" : ""} aria-pressed={videoInputMode === "bulk"} disabled={videoSubmitInProgress} onClick={() => { setVideoInputMode("bulk"); setVideoUploadError(""); }}>Bulk upload</button></div>{videoInputMode === "url" ? <label>VIDEO URL<input name="video_url" type="url" required placeholder="https://cdn.example.com/video.mp4" value={videoUrlInput} onChange={(event) => setVideoUrlInput(event.target.value)}/><small>External HTTPS URL. Video playback uses this source directly.</small></label> : videoInputMode === "upload" ? <div className="video-upload-field"><label htmlFor="video-file">VIDEO FILE</label><input id="video-file" type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={videoSubmitInProgress} onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; setSelectedVideoFile(file); setStagedUploadedVideo(null); setVideoUploadProgress(null); setVideoUploadError(""); }}/><small>MP4 or WebM, up to 10 GB. Uploads go directly to the separate video bucket, not through Vercel.</small>{selectedVideoFile && <p className="video-upload-file-summary">{selectedVideoFile.name} · {(selectedVideoFile.size / (1024 * 1024)).toFixed(1)} MB</p>}{videoUploadProgress !== null && <div className="video-upload-progress" role="status"><span>{videoUploadProgress < 100 ? `Uploading video… ${videoUploadProgress}%` : "Upload complete. Saving video details…"}</span><progress max="100" value={videoUploadProgress}/></div>}{videoUploadError && <p className="field-error" role="alert">{videoUploadError}</p>}</div> : <section className="bulk-upload-field"><label htmlFor="bulk-video-files">VIDEO FILES</label><input id="bulk-video-files" type="file" accept="video/mp4,video/webm,.mp4,.webm" multiple disabled={videoSubmitInProgress} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); (() => { const items = files.map((file) => ({ id: crypto.randomUUID(), file, title: titleFromVideoFilename(file.name), progress: 0, status: "queued" as const })); bulkUploadItemsRef.current = items; setBulkUploadItems(items); })(); setVideoUploadError(""); event.currentTarget.value = ""; }}/><small>Select MP4 or WebM files. Each file gets a cleaned filename title, its own progress, and is saved automatically after upload. Files upload directly to video storage.</small>{bulkUploadItems.length > 0 && <div className="bulk-upload-list">{bulkUploadItems.map((item) => <div className={`bulk-upload-item ${item.status}`} key={item.id}><div className="bulk-upload-item-heading"><strong>{item.title || "Untitled video"}</strong><span>{item.status === "queued" ? "Waiting" : item.status === "uploading" ? `Uploading ${item.progress}%` : item.status === "saving" ? "Saving…" : item.status === "saved" ? "Saved" : "Failed"}</span></div><small>{item.file.name}</small>{item.status === "uploading" && <progress max="100" value={item.progress}/>}{item.error && <p className="field-error" role="alert">{item.error}</p>}</div>)}</div>}{videoUploadError && <p className="field-error" role="alert">{videoUploadError}</p>}</section>}<label className={videoInputMode === "bulk" ? "bulk-hidden-field" : ""}>TITLE<input name="title" required={videoInputMode !== "bulk"} disabled={videoInputMode === "bulk"} maxLength={180} defaultValue={editingVideo?.title}/></label><div className="category-field"><label htmlFor="video-category">CATEGORY</label><div className="category-control-row"><select id="video-category" name="category_id" required value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)} disabled={categoryOptionsHook.loading || (Boolean(categoryOptionsHook.error) && categoryOptionsHook.categories.length === 0)}><option value="" disabled>{categoryOptionsHook.loading ? "Loading categories..." : categoryOptionsHook.error ? "Categories unavailable" : categoryOptionsHook.categories.length ? "Select category" : "No categories yet — Create category"}</option>{categoryOptionsHook.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><button className="create-category-inline" type="button" onClick={() => openCategory(undefined, true)}><Plus size={14}/> Create category</button></div>{categoryOptionsHook.error && <p className="field-error" role="alert">Could not load categories: {categoryOptionsHook.error} <button type="button" onClick={() => void categoryOptionsHook.refresh()}>Retry</button></p>}{!categoryOptionsHook.error && !categoryOptionsHook.loading && categoryOptionsHook.categories.length === 0 && <p className="field-empty">No categories yet — Create category</p>}</div><label>DESCRIPTION<textarea name="description" rows={3} defaultValue={editingVideo?.description}/></label><label className={videoInputMode === "bulk" ? "bulk-hidden-field" : ""}>THUMBNAIL URL<input name="thumbnail_url" type="url" placeholder="https://..." defaultValue={editingVideo?.thumbnail_url ?? ""}/><small>Optional — leave empty to automatically generate a thumbnail from the video.</small></label><label>TAGS<input name="tags" placeholder="documentary, travel" defaultValue={editingVideo?.tags.join(", ")}/></label><label className={videoInputMode === "bulk" ? "bulk-hidden-field" : ""}>DURATION<input name="duration" placeholder="12:34" defaultValue={editingVideo?.duration}/></label><div className="check-row"><label><input type="checkbox" name="featured" defaultChecked={editingVideo?.featured}/> Featured</label><label><input type="checkbox" name="published" defaultChecked={editingVideo?.published ?? true}/> Published</label></div><div className="video-form-actions"><button className="button-primary submit-button" type="submit" disabled={videoSubmitInProgress || (videoInputMode === "bulk" && (bulkUploadItems.length === 0 || bulkUploadItems.every((item) => item.status === "saved"))) }>{videoSubmitInProgress ? (videoInputMode === "bulk" ? "Uploading batch…" : videoUploadProgress !== null && videoUploadProgress < 100 ? `Uploading… ${videoUploadProgress}%` : "Saving…") : videoInputMode === "bulk" ? "Upload and save videos" : editingVideo ? "Save changes" : "Add video"}</button><button className="cancel-video-button" type="button" onClick={() => { setEditingVideo(null); setSection("Videos"); }}>Cancel</button></div></form></div></>}
        {section === "Categories" && <><div className="admin-heading"><div><span className="eyebrow">ORGANIZE</span><h1>Categories</h1><p>Create and manage library categories.</p></div><button className="button-primary" onClick={() => openCategory()}><Plus size={15}/> Add category</button></div><div className="category-admin-list">{categoriesHook.categories.map((category) => <div className="category-admin-row" key={category.id}><div><strong>{category.name}</strong><span>{category.description || "No description"}</span></div><span>{category.video_count ?? 0} videos</span><button onClick={() => openCategory(category)}>Edit</button><button aria-label={`Delete ${category.name}`} onClick={() => deleteCategory(category)}><Trash2 size={15}/></button></div>)}{categoriesHook.categories.length === 0 && <p className="admin-empty">No categories yet. Create one to organize videos.</p>}</div></>}
        {section === "Cloudflare Storage" && <>
          <div className="admin-heading"><div><span className="eyebrow">VIDEO STORAGE</span><h1>Cloudflare Storage</h1><p>Inspect configured video buckets and manage uploaded R2 objects.</p></div></div>
           <div className="cloudflare-storage-toolbar"><label><span>ACCOUNT / BUCKET</span><select value={selectedCloudflareAccountId} onChange={(event) => { setSelectedCloudflareAccountId(event.target.value); setSelectedStorageObjectKeys(new Set()); setPreparedStorageDownloads([]); cloudflareStorageViewRef.current = null; setCloudflareStorageView(null); }} disabled={cloudflareAccountsLoading}><option value="">{cloudflareAccountsLoading ? "Loading accounts…" : "Select account"}</option>{cloudflareVideoAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} — {account.bucketName}{account.isDefault ? " (default)" : ""}</option>)}</select></label><button className="secondary-action" type="button" onClick={() => void loadCloudflareStorage()} disabled={!selectedCloudflareAccountId || cloudflareStorageLoading}>{cloudflareStorageLoading ? "Refreshing…" : "Refresh storage"}</button></div>
          {cloudflareAccountsError && <p className="field-error" role="alert">{cloudflareAccountsError}</p>}
          {cloudflareStorageError && <p className="field-error" role="alert">{cloudflareStorageError} Check that this account’s R2 token has ListBucket permission.</p>}
          {cloudflareStorageLoading && !cloudflareStorageView && <p className="admin-empty" role="status">Inspecting Cloudflare bucket…</p>}
          {cloudflareStorageView && <>
            <div className="cloudflare-storage-summary"><div><span>CONFIGURED ACCOUNTS</span><strong>{cloudflareVideoAccounts.length}</strong></div><div><span>SELECTED BUCKET</span><strong>{cloudflareStorageView.account.bucketName}</strong><small>{cloudflareStorageView.account.name}</small></div><div><span>VIDEO OBJECTS</span><strong>{cloudflareStorageView.usage.objectCount.toLocaleString()}</strong></div><div><span>LIVE OBJECT DATA</span><strong>{formatStorageBytes(cloudflareStorageView.usage.totalBytes)}</strong><small>Sum of current video object sizes; excludes deleted versions and incomplete multipart uploads.</small></div></div>
            <div className="cloudflare-storage-selection-bar"><span>{selectedStorageObjectKeys.size} selected</span><div>{preparedStorageDownloads.length > 0 && <button className="secondary-action" type="button" onClick={startPreparedStorageDownloads}>Start downloads ({preparedStorageDownloads.length})</button>}<button className="secondary-action" type="button" disabled={!selectedStorageObjectKeys.size || storageBulkActionBusy} onClick={() => void prepareSelectedStorageDownloads()}>{storageBulkActionBusy ? "Preparing…" : preparedStorageDownloads.length ? "Prepare again" : "Download selected"}</button><button className="cloudflare-storage-delete" type="button" disabled={!selectedStorageObjectKeys.size || storageBulkActionBusy} onClick={() => void deleteSelectedStorageObjects()}>{storageBulkActionBusy ? "Working…" : "Delete selected"}</button></div></div>
            {preparedStorageDownloads.length > 0 && <div className="cloudflare-download-queue"><p>Download links are ready. Start downloads, or click a file individually if your browser blocks multiple downloads.</p>{preparedStorageDownloads.map((item) => <a key={item.key} href={item.url} download={item.key.split("/").pop()}>{item.key.split("/").pop()}</a>)}</div>}
            <div className="cloudflare-storage-table-wrap"><table className="cloudflare-storage-table"><thead><tr><th><input type="checkbox" aria-label="Select all visible video objects" checked={cloudflareStorageView.objects.length > 0 && cloudflareStorageView.objects.every((object) => selectedStorageObjectKeys.has(object.key))} onChange={toggleAllVisibleStorageObjects} disabled={storageBulkActionBusy}/></th><th>Object</th><th>Size</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>{cloudflareStorageView.objects.map((object) => <tr key={object.key}><td><input type="checkbox" aria-label={`Select ${object.key}`} checked={selectedStorageObjectKeys.has(object.key)} onChange={() => toggleStorageObjectSelection(object.key)} disabled={storageBulkActionBusy}/></td><td><a href={object.publicUrl} target="_blank" rel="noreferrer">{object.key}</a></td><td>{formatStorageBytes(object.size)}</td><td>{object.lastModified ? new Date(object.lastModified).toLocaleString() : "—"}</td><td><button className="cloudflare-storage-delete" type="button" disabled={Boolean(cloudflareStorageBusyKey) || storageBulkActionBusy} onClick={() => void deleteCloudflareVideoObject(object)}>{cloudflareStorageBusyKey === object.key ? "Deleting…" : "Delete object"}</button></td></tr>)}</tbody></table>{cloudflareStorageView.objects.length === 0 && <p className="admin-empty">No uploaded video objects in this bucket.</p>}</div>
            {cloudflareStorageView.nextContinuationToken && <button className="secondary-action cloudflare-storage-next" type="button" disabled={cloudflareStorageLoading} onClick={() => void loadCloudflareStorage(true)}>{cloudflareStorageLoading ? "Loading objects…" : "Load more objects"}</button>}
          </>}
          <p className="cloudflare-storage-note">Storage usage is calculated from currently listed objects under videos/. Deleting an object does not delete its database record; any video that references it will stop playing. Account credentials remain in server secrets.</p>
        </>}
        {section === "Settings" && <>
          <div className="admin-heading"><div><span className="eyebrow">ACCOUNT</span><h1>Settings</h1><p>Manage your admin session.</p></div></div>
          <div className="settings-panel"><ShieldCheck size={18}/><div><strong>Authenticator app MFA</strong><span>A verified TOTP factor and AAL2 session are required for admin access.</span></div><button onClick={logout}>Sign out</button></div>
          <section className="admin-password-settings">
            <div className="admin-password-settings-heading"><div><strong>Admin password</strong><span>Confirm a fresh authenticator code to set a new password.</span></div><button type="button" className="secondary-action" onClick={() => { setPasswordChangeOpen((open) => !open); setPasswordChangeError(""); }} disabled={passwordChangeBusy}>{passwordChangeOpen ? "Cancel" : "Reset password"}</button></div>
            {passwordChangeOpen && <form className="admin-password-form" onSubmit={changeAdminPassword}>
              <label>AUTHENTICATOR CODE<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={passwordChangeCode} onChange={(event) => setPasswordChangeCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required disabled={passwordChangeBusy}/><small>Enter the current 6-digit code from your authenticator app.</small></label>
              <label>NEW PASSWORD<input type="password" autoComplete="new-password" minLength={8} value={newAdminPassword} onChange={(event) => setNewAdminPassword(event.target.value)} required disabled={passwordChangeBusy}/></label>
              <label>CONFIRM NEW PASSWORD<input type="password" autoComplete="new-password" minLength={8} value={confirmAdminPassword} onChange={(event) => setConfirmAdminPassword(event.target.value)} required disabled={passwordChangeBusy}/></label>
              {passwordChangeError && <p className="field-error" role="alert">{passwordChangeError}</p>}
              <button className="button-primary" type="submit" disabled={passwordChangeBusy}>{passwordChangeBusy ? "Verifying code…" : "Verify code and change password"}</button>
            </form>}
          </section>
          <p className="admin-note">Video playback streams directly from each saved video source or configured Cloudflare R2 account.</p>
        </>}
    </section>
    {categoryDialog && <div className="modal-backdrop category-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCategoryDialog(false); }}><section className="add-modal category-modal" role="dialog" aria-modal="true" aria-labelledby="category-modal-title"><div className="modal-title"><div><span className="eyebrow">CATEGORY MANAGEMENT</span><h2 id="category-modal-title">{quickCategory ? "Create category" : editingCategory ? "Edit category" : "Create category"}</h2></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setCategoryDialog(false)}><X size={18}/></button></div><form onSubmit={submitCategory}><label>Name<input name="name" required maxLength={80} autoFocus defaultValue={editingCategory?.name}/></label><label>Description (optional)<textarea name="description" rows={3} defaultValue={editingCategory?.description}/></label>{!quickCategory && <label>Image URL<input name="image_url" type="url" defaultValue={editingCategory?.image_url ?? ""}/></label>}{categoryFormError && <p className="field-error" role="alert">{categoryFormError}</p>}<div className="category-modal-actions"><button className="cancel-video-button" type="button" onClick={() => setCategoryDialog(false)}>Cancel</button><button className="button-primary" type="submit">{editingCategory ? "Save changes" : "Create category"}</button></div></form></section></div>}
    {regenerateAllConfirmOpen && <div className="modal-backdrop thumbnail-regenerate-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRegenerateAllConfirmOpen(false); }}>
      <section className="add-modal thumbnail-regenerate-dialog" role="alertdialog" aria-modal="true" aria-labelledby="regenerate-all-title" aria-describedby="regenerate-all-message">
        <div className="modal-title"><div><span className="eyebrow">THUMBNAIL MANAGEMENT</span><h2 id="regenerate-all-title">Regenerate all thumbnails?</h2></div></div>
        <p id="regenerate-all-message">This will regenerate thumbnails for all videos that have thumbnails. Existing thumbnails will be replaced with newly generated thumbnails based on each video's actual aspect ratio. This may take some time. Are you sure?</p>
        <div className="category-modal-actions">
          <button className="cancel-video-button" type="button" onClick={() => setRegenerateAllConfirmOpen(false)}>Cancel</button>
          <button className="button-primary" type="button" disabled={thumbnailBatchRunning} onClick={() => { setRegenerateAllConfirmOpen(false); void regenerateAllThumbnails(); }}>Regenerate All</button>
        </div>
      </section>
    </div>}
    {checkAllConfirmOpen && <div className="modal-backdrop video-check-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCheckAllConfirmOpen(false); }}>
      <section className="add-modal video-check-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="check-all-videos-title" aria-describedby="check-all-videos-message">
        <div className="modal-title"><div><span className="eyebrow">SOURCE HEALTH CHECK</span><h2 id="check-all-videos-title">Check all videos?</h2></div></div>
        <p id="check-all-videos-message">This will test all published videos to make sure their external media sources are still accessible. Videos confirmed as broken will be automatically unpublished. This may take some time.</p>
        <div className="category-modal-actions">
          <button className="cancel-video-button" type="button" onClick={() => setCheckAllConfirmOpen(false)}>Cancel</button>
          <button className="button-primary" type="button" disabled={mediaMaintenanceRunning} onClick={() => { setCheckAllConfirmOpen(false); void checkAllVideos(); }}>Check All Videos</button>
        </div>
      </section>
    </div>}
    {bulkDeleteDialogOpen && bulkDeletePreview && <div className="modal-backdrop bulk-delete-category-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !bulkDeleteBusy) { setBulkDeleteDialogOpen(false); setBulkDeleteCode(""); setBulkDeletePreview(null); } }}>
      <section className="add-modal bulk-delete-category-dialog" role="alertdialog" aria-modal="true" aria-labelledby="bulk-delete-category-title" aria-describedby="bulk-delete-category-description">
        <div className="modal-title"><div><span className="eyebrow">IRREVERSIBLE ACTION</span><h2 id="bulk-delete-category-title">Delete all videos in {bulkDeletePreview.categoryName}?</h2></div></div>
        <p id="bulk-delete-category-description">This will permanently delete all {bulkDeletePreview.count} video records in this category. This cannot be undone. Thumbnails and other stored assets are not changed.</p>
        <label className="bulk-delete-otp-label" htmlFor="bulk-delete-totp">Enter your 6-digit one-time authenticator code</label>
        <input id="bulk-delete-totp" className="bulk-delete-otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={bulkDeleteCode} onChange={(event) => setBulkDeleteCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={bulkDeleteBusy}/>
        <div className="category-modal-actions">
          <button className="cancel-video-button" type="button" onClick={() => { setBulkDeleteDialogOpen(false); setBulkDeleteCode(""); setBulkDeletePreview(null); }} disabled={bulkDeleteBusy}>Cancel</button>
          <button className="danger-action" type="button" onClick={() => void confirmDeleteAllInCategory()} disabled={bulkDeleteBusy || bulkDeleteCode.length !== 6}>{bulkDeleteBusy ? "Deleting…" : "Delete All Videos"}</button>
        </div>
      </section>
    </div>}
  </main>;
}

function Stat({ label, value }: { label: string; value?: number }) { return <div className="stat-card"><span>{label}</span><strong>{value?.toLocaleString() ?? "—"}</strong><small>From your library</small></div>; }
function VideoTable({ videos, categories, onEdit, onDelete, onToggle, onGenerateThumbnail, generatingThumbnailIds, onCheckVideo, checkingVideoIds, checkDisabled }: {
  videos: VideoRecord[];
  categories: Category[];
  onEdit: (video: VideoRecord) => void;
  onDelete: (id: string) => void;
  onToggle: (video: VideoRecord, field: "published" | "featured") => void;
  onGenerateThumbnail: (video: VideoRecord) => Promise<boolean>;
  generatingThumbnailIds: Set<string>;
  onCheckVideo?: (video: VideoRecord) => void;
  checkingVideoIds?: Set<string>;
  checkDisabled?: boolean;
}) {
  return <div className="admin-table video-management-table">
    <div className="video-table-head"><span>VIDEO</span><span>CATEGORY</span><span>STATUS</span><span>VIEWS</span><span>ADDED</span><span>ACTIONS</span></div>
    {videos.map((video) => <div className={`admin-row video-table-row${onCheckVideo ? " has-video-check-action" : ""}`} key={video.id}>
      <img src={video.thumbnail_url || "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=180&q=75"} alt=""/>
      <div className="admin-title"><strong>{video.title}</strong><span>{video.featured ? "Featured · " : ""}{video.duration || "Video"}</span></div>
      <span>{video.categories?.name ?? categories.find((item) => item.id === video.category_id)?.name ?? "—"}</span>
      <span>{video.published ? "Published" : "Draft"}</span>
      <span>{video.views.toLocaleString()}</span>
      <span>{new Date(video.created_at).toLocaleDateString()}</span>
      <div className="row-actions">
        <button onClick={() => onEdit(video)}>Edit</button>
        {onCheckVideo && <button className="video-check-action" onClick={() => onCheckVideo(video)} disabled={!video.published || checkDisabled || checkingVideoIds?.has(video.id)}>{checkingVideoIds?.has(video.id) ? "Checking…" : "Check"}</button>}
        <button className="thumbnail-row-action" onClick={() => void onGenerateThumbnail(video)} disabled={generatingThumbnailIds.has(video.id)} title={video.thumbnail_url ? "Explicitly replace this thumbnail with a frame from the source video" : undefined}>{generatingThumbnailIds.has(video.id) ? "Generating…" : video.thumbnail_url ? "Regenerate thumbnail" : "Generate thumbnail"}</button>
        <button onClick={() => onToggle(video, "published")}>{video.published ? "Unpublish" : "Publish"}</button>
        <button onClick={() => onToggle(video, "featured")}>{video.featured ? "Unfeature" : "Feature"}</button>
        <button onClick={() => { if (window.confirm(`Delete “${video.title}”? This cannot be undone.`)) void onDelete(video.id); }} aria-label={`Delete ${video.title}`}><Trash2 size={14}/></button>
      </div>
    </div>)}
    {videos.length === 0 && <p className="admin-empty">No videos found.</p>}
  </div>;
}

function videoCheckStatusLabel(status: VideoCheckStatus, action: string) {
  if (status === "working") return "✓ Working";
  if (status === "recovered" || status === "temporary") return "⚠️ Temporary failure/recovered";
  if (status === "unpublished") return "✕ Broken — unpublished";
  if (status === "broken") return action === "Not changed; scan stopped" ? "✕ Broken — not unpublished" : "✕ Broken — awaiting final confirmation";
  return "— Skipped";
}
