/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../api/api";
import debounce from "lodash.debounce";
import { mergeFileMaps } from "../utils/threeWayMerge";

const AppContext = createContext(undefined);
const fileContent = (entry) => typeof entry === "string" ? entry : entry?.content || "";
async function hashContent(content) {
    if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
    }
    let hash = 2166136261;
    for (let i = 0; i < content.length; i += 1) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
}

export function AppContextProvider({ children }) {
    const navigate = useNavigate();
    const versionRef = useRef(0), serverFilesRef = useRef({}), conflictRef = useRef(null);
    const [user, setUser] = useState(null), [loadingUser, setLoadingUser] = useState(true);
    const [projects, setProjects] = useState([]), [loadingProjects, setLoadingProjects] = useState(true);
    const [activeProject, setActiveProject] = useState(null), [loadingActiveProject, setLoadingActiveProject] = useState(false);
    const [chatLoading, setChatLoading] = useState(false), [generatingProject, setGeneratingProject] = useState(false);
    const [saveState, setSaveState] = useState("saved"), [conflict, setConflict] = useState(null);
    const [activeFile, setActiveFile] = useState("/App.js"), [showCode, setShowCode] = useState(false);

    const adoptServerProject = useCallback((project) => {
        if (!project) return;
        setActiveProject(project); versionRef.current = project.version ?? 0; serverFilesRef.current = { ...(project.files || {}) };
    }, []);
    const checkSession = useCallback(async () => { setLoadingUser(true); try { const { data } = await api.get("/api/auth/me"); setUser(data?.user || null); } catch { setUser(null); } finally { setLoadingUser(false); } }, []);
    useEffect(() => { checkSession(); }, [checkSession]);
    const login = useCallback(async (email, password) => { try { const { data } = await api.post("/api/auth/login", { email, password }); setUser(data.user); navigate("/"); } catch (e) { const m = e?.response?.data?.error || "Invalid email or password."; toast.error(m); throw new Error(m); } }, [navigate]);
    const register = useCallback(async (name, email, password) => { try { const { data } = await api.post("/api/auth/register", { name, email, password }); setUser(data.user); navigate("/"); } catch (e) { const m = e?.response?.data?.error || "Registration failed."; toast.error(m); throw new Error(m); } }, [navigate]);
    const logout = useCallback(async () => { try { await api.post("/api/auth/logout"); } catch {} setUser(null); setProjects([]); setActiveProject(null); serverFilesRef.current = {}; conflictRef.current = null; setConflict(null); setSaveState("saved"); navigate("/login", { replace: true }); }, [navigate]);
    const loadProjects = useCallback(async () => { if (!user) { setProjects([]); setLoadingProjects(false); return; } setLoadingProjects(true); try { const { data } = await api.get("/api/projects"); setProjects(Array.isArray(data) ? data : []); } catch (e) { toast.error(e?.response?.data?.error || "Failed to load projects."); } finally { setLoadingProjects(false); } }, [user]);
    useEffect(() => { loadProjects(); }, [loadProjects]);
    const loadProject = useCallback(async (id, silent = false) => { if (!user || !id) return null; if (!silent) setLoadingActiveProject(true); try { const { data } = await api.get(`/api/projects/${id}`); adoptServerProject(data); setConflict(null); conflictRef.current = null; setSaveState("saved"); const paths = Object.keys(data.files || {}); setActiveFile((p) => paths.includes(p) ? p : paths.includes("/App.js") ? "/App.js" : paths[0] || "/App.js"); return data; } catch (e) { if (!silent) { toast.error(e?.response?.data?.error || "Failed to load project."); navigate("/", { replace: true }); } return null; } finally { if (!silent) setLoadingActiveProject(false); } }, [user, navigate, adoptServerProject]);
    useEffect(() => { if (!user || !activeProject?._id) return; if (!["generating", "pending", "revising"].includes(activeProject.status)) { setChatLoading(false); return; } setChatLoading(true); const id = setInterval(() => loadProject(activeProject._id, true), 2000); return () => clearInterval(id); }, [user, activeProject?._id, activeProject?.status, loadProject]);
    const handleGenerate = useCallback(async (prompt) => { if (!user) return toast.error("Please login first."); if (!prompt?.trim()) return toast.error("Please enter a prompt."); setGeneratingProject(true); try { const { data } = await api.post("/api/projects", { prompt: prompt.trim() }); navigate(`/builder/${data._id}`); } catch (e) { toast.error(e?.response?.data?.error || "Failed to generate project."); } finally { setGeneratingProject(false); } }, [navigate, user]);
    const handleDelete = useCallback(async (id) => { try { await api.delete(`/api/projects/${id}`); setProjects((p) => p.filter((x) => x._id !== id)); } catch (e) { toast.error(e?.response?.data?.error || "Failed to delete project."); } }, []);

    const handleChat = useCallback(async (prompt) => {
        if (!activeProject || !user || conflictRef.current) return conflictRef.current && toast.error("Resolve the current file conflict first.");
        setChatLoading(true); try { const { data } = await api.post(`/api/projects/${activeProject._id}/chat`, { prompt }); adoptServerProject(data); toast.success(data.errors?.length ? `${data.errors.length} patch(es) failed` : `Updated to version ${data.version}`); } catch (e) { toast.error(e?.response?.data?.error || "Revision request failed"); } finally { setChatLoading(false); }
    }, [activeProject, user, adoptServerProject]);

    const debouncedSave = useMemo(() => debounce(async (patches, id, version, baseFiles, localFiles) => {
        try { const { data } = await api.patch(`/api/projects/${id}/files`, { patches, version }); adoptServerProject(data); setSaveState("saved"); }
        catch (error) {
            if (error.response?.status === 409) {
                const remote = error.response.data?.project;
                if (!remote) { setSaveState("conflict"); return; }
                const merged = mergeFileMaps(baseFiles, localFiles, remote.files || {});
                const state = { project: remote, baseFiles, localFiles, remoteFiles: remote.files || {}, mergedFiles: merged.files, conflicts: merged.conflicts };
                conflictRef.current = state; setConflict(state); setSaveState("conflict");
                setActiveProject((p) => p ? { ...p, ...remote, files: localFiles } : p);
                toast.error(merged.clean ? "Changes were auto-merged. Review and save." : `${merged.conflicts.length} conflict(s) need resolution.`);
                return;
            }
            setSaveState("error"); toast.error(error?.response?.data?.error || "Failed to save code modifications");
        }
    }, 700), [adoptServerProject]);
    useEffect(() => () => debouncedSave.cancel(), [debouncedSave]);

    const updateProjectFiles = useCallback(async (files) => {
        if (!activeProject || !user || conflictRef.current) return;
        const server = serverFilesRef.current || {}, local = { ...(files || {}) }, base = { ...server }, patches = [];
        const paths = new Set([...Object.keys(server), ...Object.keys(local)]);
        for (const path of paths) {
            const before = fileContent(server[path]), afterEntry = local[path], exists = afterEntry !== undefined, after = fileContent(afterEntry);
            if (exists && before === after) continue;
            const baseHash = server[path]?.hash || activeProject.fileHashes?.[path] || await hashContent(before);
            patches.push(exists ? { path, op: "upsert", content: after, baseHash: server[path] ? baseHash : null } : { path, op: "delete", baseHash });
        }
        if (!patches.length) return;
        setActiveProject((p) => p ? { ...p, files: local } : p); setSaveState("unsaved");
        debouncedSave(patches, activeProject._id, versionRef.current, base, local);
    }, [activeProject, user, debouncedSave]);

    const resolveConflict = useCallback(async (strategy = "merged") => {
        const c = conflictRef.current; if (!c?.project) return;
        const files = strategy === "local" ? c.localFiles : strategy === "remote" ? c.remoteFiles : c.mergedFiles;
        const remote = c.remoteFiles || {}, patches = [], paths = new Set([...Object.keys(remote), ...Object.keys(files || {})]);
        for (const path of paths) {
            const before = fileContent(remote[path]), afterEntry = files?.[path], exists = afterEntry !== undefined, after = fileContent(afterEntry);
            if (exists && before === after) continue;
            const baseHash = remote[path]?.hash || await hashContent(before);
            patches.push(exists ? { path, op: "upsert", content: after, baseHash } : { path, op: "delete", baseHash });
        }
        if (!patches.length) { adoptServerProject(c.project); conflictRef.current = null; setConflict(null); setSaveState("saved"); return; }
        setSaveState("saving");
        try { const { data } = await api.patch(`/api/projects/${c.project._id}/files`, { patches, version: c.project.version }); adoptServerProject(data); conflictRef.current = null; setConflict(null); setSaveState("saved"); toast.success("Conflict resolved and saved."); }
        catch (e) { setSaveState(e.response?.status === 409 ? "conflict" : "error"); if (e.response?.status !== 409) toast.error(e?.response?.data?.error || "Failed to save resolution."); }
    }, [adoptServerProject]);

    const value = { user, loadingUser, login, register, logout, projects, loadingProjects, activeProject, loadingActiveProject, chatLoading, generatingProject, activeFile, setActiveFile, showCode, setShowCode, saveState, conflict, loadProjects, loadProject, handleGenerate, handleDelete, updateProjectFiles, handleChat, resolveConflict };
    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export function useAppContext() { const context = useContext(AppContext); if (!context) throw new Error("useAppContext must be used within an AppContextProvider."); return context; }
