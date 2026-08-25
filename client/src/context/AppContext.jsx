/* eslint-disable react-refresh/only-export-components */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    useMemo,
    useRef,
} from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../api/api";
import debounce from "lodash.debounce";

const AppContext = createContext(undefined);

export function AppContextProvider({ children }) {
    const navigate = useNavigate();
    const projectVersionRef = useRef(0);

    const [user, setUser] = useState(null);
    const [loadingUser, setLoadingUser] = useState(true);
    const [projects, setProjects] = useState([]);
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [activeProject, setActiveProject] = useState(null);
    const [loadingActiveProject, setLoadingActiveProject] = useState(false);
    const [chatLoading, setChatLoading] = useState(false);
    const [generatingProject, setGeneratingProject] = useState(false);
    const [saveState, setSaveState] = useState("saved");
    const [activeFile, setActiveFile] = useState("/App.js");
    const [showCode, setShowCode] = useState(false);

    useEffect(() => {
        projectVersionRef.current = activeProject?.version ?? 0;
    }, [activeProject?.version]);

    const checkSession = useCallback(async () => {
        setLoadingUser(true);
        try {
            const { data } = await api.get("/api/auth/me");
            setUser(data?.user || null);
        } catch (error) {
            console.error("Session check failed:", error);
            setUser(null);
        } finally {
            setLoadingUser(false);
        }
    }, []);

    useEffect(() => { checkSession(); }, [checkSession]);

    const login = useCallback(async (email, password) => {
        try {
            const { data } = await api.post("/api/auth/login", { email, password });
            setUser(data.user);
            toast.success("Welcome back!");
            navigate("/");
        } catch (error) {
            const message = error?.response?.data?.error || error?.response?.data?.message || "Invalid email or password.";
            toast.error(message);
            throw new Error(message);
        }
    }, [navigate]);

    const register = useCallback(async (name, email, password) => {
        try {
            const { data } = await api.post("/api/auth/register", { name, email, password });
            setUser(data.user);
            toast.success("Account created successfully!");
            navigate("/");
        } catch (error) {
            const message = error?.response?.data?.error || error?.response?.data?.message || "Registration failed. Please try again.";
            toast.error(message);
            throw new Error(message);
        }
    }, [navigate]);

    const logout = useCallback(async () => {
        try { await api.post("/api/auth/logout"); } catch (error) { console.error("Logout request failed:", error); }
        setUser(null);
        setProjects([]);
        setActiveProject(null);
        setActiveFile("/App.js");
        setShowCode(false);
        setChatLoading(false);
        setSaveState("saved");
        toast.success("Logged out successfully.");
        navigate("/login", { replace: true });
    }, [navigate]);

    const loadProjects = useCallback(async () => {
        if (!user) { setProjects([]); setLoadingProjects(false); return; }
        setLoadingProjects(true);
        try {
            const { data } = await api.get("/api/projects");
            setProjects(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Failed to list projects:", error);
            toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to load projects list.");
            setProjects([]);
        } finally { setLoadingProjects(false); }
    }, [user]);

    useEffect(() => { loadProjects(); }, [loadProjects]);

    const loadProject = useCallback(async (id, silent = false) => {
        if (!user || !id) return null;
        if (!silent) setLoadingActiveProject(true);
        try {
            const { data } = await api.get(`/api/projects/${id}`);
            setActiveProject(data);
            projectVersionRef.current = data?.version ?? 0;

            const files = data?.files && typeof data.files === "object" ? Object.keys(data.files) : [];
            if (files.length > 0) {
                setActiveFile((previous) => files.includes(previous) ? previous : files.includes("/App.js") ? "/App.js" : files[0]);
            } else setActiveFile("/App.js");

            setProjects((previous) => previous.map((project) => project._id === data?._id ? { ...project, ...data } : project));
            return data;
        } catch (error) {
            console.error("Failed to load project:", error);
            if (!silent) {
                toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to load project details.");
                navigate("/", { replace: true });
            }
            return null;
        } finally { if (!silent) setLoadingActiveProject(false); }
    }, [user, navigate]);

    useEffect(() => {
        if (!user || !activeProject?._id) return;
        const isOngoing = ["generating", "pending", "revising"].includes(activeProject.status);
        if (!isOngoing) { setChatLoading(false); return; }
        setChatLoading(true);
        let cancelled = false;
        const interval = setInterval(async () => {
            if (cancelled) return;
            await loadProject(activeProject._id, true);
        }, 2000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [user, activeProject?._id, activeProject?.status, loadProject]);

    const handleGenerate = useCallback(async (prompt) => {
        if (!user) return toast.error("Please login first.");
        if (!prompt?.trim()) return toast.error("Please enter a prompt.");
        setGeneratingProject(true);
        try {
            const { data } = await api.post("/api/projects", { prompt: prompt.trim() });
            if (!data?._id) throw new Error("Project was created but no project ID was returned.");
            toast.success("HAI is planning the project structure...");
            navigate(`/builder/${data._id}`);
        } catch (error) {
            toast.error(error?.response?.data?.error || error?.response?.data?.message || error?.message || "Failed to generate project.");
        } finally { setGeneratingProject(false); }
    }, [navigate, user]);

    const handleDelete = useCallback(async (id) => {
        if (!user) return toast.error("Please login first.");
        if (!id) return toast.error("Invalid project.");
        try {
            await api.delete(`/api/projects/${id}`);
            setProjects((previous) => previous.filter((project) => project._id !== id));
            setActiveProject((previous) => previous?._id === id ? null : previous);
            toast.success("Project deleted successfully.");
        } catch (error) {
            toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to delete project.");
        }
    }, [user]);

    const handleChat = useCallback(async (prompt) => {
        if (!activeProject || !user) return;
        setChatLoading(true);
        try {
            const { data } = await api.post(`/api/projects/${activeProject._id}/chat`, { prompt });
            setActiveProject(data);
            projectVersionRef.current = data?.version ?? projectVersionRef.current;
            if (data.errors?.length) toast.error(`${data.errors.length} revision patch(es) failed`);
            else toast.success(`Updated to version ${data.version}`);
        } catch (error) {
            toast.error(error?.response?.data?.error || error?.response?.data?.message || "Revision request failed");
        } finally { setChatLoading(false); }
    }, [activeProject, user]);

    const debouncedSave = useMemo(() => debounce(async (files, id, version) => {
        try {
            const { data } = await api.put(`/api/projects/${id}/files`, { files, version });
            setActiveProject(data?.project || data);
            projectVersionRef.current = data?.project?.version ?? data?.version ?? version + 1;
            setSaveState("saved");
        } catch (error) {
            if (error.response?.status === 409) {
                const serverProject = error.response.data?.project;
                if (serverProject) {
                    setActiveProject(serverProject);
                    projectVersionRef.current = serverProject.version ?? 0;
                }
                setSaveState("conflict");
                toast.error("Your editor is out of date. The latest project version was loaded.");
                return;
            }
            setSaveState("error");
            toast.error("Failed to save code modifications");
        }
    }, 1000), []);

    useEffect(() => () => debouncedSave.cancel(), [debouncedSave]);

    const updateProjectFiles = useCallback((files) => {
        if (!activeProject || !user) return;
        setActiveProject((current) => current ? { ...current, files } : current);
        setSaveState("unsaved");
        debouncedSave(files, activeProject._id, projectVersionRef.current);
    }, [activeProject, user, debouncedSave]);

    const contextValue = {
        user, loadingUser, login, register, logout,
        projects, loadingProjects, activeProject, loadingActiveProject,
        chatLoading, generatingProject,
        activeFile, setActiveFile, showCode, setShowCode,
        saveState,
        loadProjects, loadProject, handleGenerate, handleDelete,
        updateProjectFiles, handleChat,
    };

    return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

export function useAppContext() {
    const context = useContext(AppContext);
    if (context === undefined) throw new Error("useAppContext must be used within an AppContextProvider.");
    return context;
}
