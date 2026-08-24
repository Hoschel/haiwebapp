/* eslint-disable react-refresh/only-export-components */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    useMemo
} from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../api/api";
import debounce from "lodash.debounce";

const AppContext = createContext(undefined);

export function AppContextProvider({ children }) {
    const navigate = useNavigate();

    // =========================
    // Auth State
    // =========================

    const [user, setUser] = useState(null);
    const [loadingUser, setLoadingUser] = useState(true);

    // =========================
    // Project State
    // =========================

    const [projects, setProjects] = useState([]);
    const [loadingProjects, setLoadingProjects] = useState(true);

    const [activeProject, setActiveProject] = useState(null);
    const [loadingActiveProject, setLoadingActiveProject] = useState(false);

    const [chatLoading, setChatLoading] = useState(false);
    const [generatingProject, setGeneratingProject] = useState(false);

    const [activeFile, setActiveFile] = useState("/App.js");
    const [showCode, setShowCode] = useState(false);

    // =========================
    // Auth
    // =========================

    const checkSession = useCallback(async () => {
        setLoadingUser(true);

        try {
            const { data } = await api.get("/api/auth/me");

            if (data?.user) {
                setUser(data.user);
            } else {
                setUser(null);
            }
        } catch (error) {
            console.error("Session check failed:", error);
            setUser(null);
        } finally {
            setLoadingUser(false);
        }
    }, []);

    useEffect(() => {
        checkSession();
    }, [checkSession]);

    const login = useCallback(
        async (email, password) => {
            try {
                const { data } = await api.post("/api/auth/login", {
                    email,
                    password,
                });

                setUser(data.user);

                toast.success("Welcome back!");
                navigate("/");
            } catch (error) {
                console.error("Login failed:", error);

                const message =
                    error?.response?.data?.message ||
                    "Invalid email or password.";

                toast.error(message);

                throw new Error(message);
            }
        },
        [navigate]
    );

    const register = useCallback(
        async (name, email, password) => {
            try {
                const { data } = await api.post("/api/auth/register", {
                    name,
                    email,
                    password,
                });

                setUser(data.user);

                toast.success("Account created successfully!");
                navigate("/");
            } catch (error) {
                console.error("Registration failed:", error);

                const message =
                    error?.response?.data?.message ||
                    "Registration failed. Please try again.";

                toast.error(message);

                throw new Error(message);
            }
        },
        [navigate]
    );

    const logout = useCallback(async () => {
        try {
            await api.post("/api/auth/logout");
        } catch (error) {
            console.error("Logout request failed:", error);

            // Even if the server request fails,
            // clear the local authentication state.
        } finally {
            setUser(null);
            setProjects([]);
            setActiveProject(null);
            setActiveFile("/App.js");
            setShowCode(false);
            setChatLoading(false);

            toast.success("Logged out successfully.");
            navigate("/login", { replace: true });
        }
    }, [navigate]);

    // =========================
    // Projects
    // =========================

    const loadProjects = useCallback(async () => {
        if (!user) {
            setProjects([]);
            setLoadingProjects(false);
            return;
        }

        setLoadingProjects(true);

        try {
            const { data } = await api.get("/api/projects");

            setProjects(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Failed to list projects:", error);

            toast.error(
                error?.response?.data?.message ||
                    "Failed to load projects list."
            );

            setProjects([]);
        } finally {
            setLoadingProjects(false);
        }
    }, [user]);

    // Automatically load projects after authentication.
    useEffect(() => {
        if (!user) {
            setProjects([]);
            setLoadingProjects(false);
            return;
        }

        loadProjects();
    }, [user, loadProjects]);

    // =========================
    // Load Single Project
    // =========================

    const loadProject = useCallback(
        async (id, silent = false) => {
            if (!user || !id) {
                return null;
            }

            if (!silent) {
                setLoadingActiveProject(true);
            }

            try {
                const { data } = await api.get(`/api/projects/${id}`);

                setActiveProject(data);

                // =========================
                // Active File
                // =========================

                const files =
                    data?.files && typeof data.files === "object"
                        ? Object.keys(data.files)
                        : [];

                if (files.length > 0) {
                    setActiveFile((previousFile) => {
                        if (files.includes(previousFile)) {
                            return previousFile;
                        }

                        if (files.includes("/App.js")) {
                            return "/App.js";
                        }

                        return files[0];
                    });
                } else {
                    setActiveFile("/App.js");
                }

                // Keep project list synchronized.
                setProjects((previousProjects) =>
                    previousProjects.map((project) =>
                        project._id === data?._id
                            ? { ...project, ...data }
                            : project
                    )
                );

                return data;
            } catch (error) {
                console.error("Failed to load project:", error);

                if (!silent) {
                    toast.error(
                        error?.response?.data?.message ||
                            "Failed to load project details."
                    );

                    navigate("/", { replace: true });
                }

                return null;
            } finally {
                if (!silent) {
                    setLoadingActiveProject(false);
                }
            }
        },
        [user, navigate]
    );

    // =========================
    // Project Polling
    // =========================

    useEffect(() => {
        if (!user || !activeProject?._id) {
            setChatLoading(false);
            return;
        }

        const status = activeProject.status;

        const isOngoing =
            status === "generating" ||
            status === "pending" ||
            status === "revising";

        if (!isOngoing) {
            setChatLoading(false);
            return;
        }

        setChatLoading(true);

        let cancelled = false;
        let polling = false;

        const poll = async () => {
            if (cancelled || polling) {
                return;
            }

            polling = true;

            try {
                await loadProject(activeProject._id, true);
            } finally {
                polling = false;
            }
        };

        const interval = setInterval(poll, 2000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [
        user,
        activeProject?._id,
        activeProject?.status,
        loadProject,
    ]);

    // =========================
    // Generate Project
    // =========================

    const handleGenerate = useCallback(
        async (prompt) => {
            if (!user) {
                toast.error("Please login first.");
                return;
            }

            if (!prompt?.trim()) {
                toast.error("Please enter a prompt.");
                return;
            }

            setGeneratingProject(true);

            try {
                const { data } = await api.post("/api/projects", {
                    prompt: prompt.trim(),
                });

                if (!data?._id) {
                    throw new Error(
                        "Project was created but no project ID was returned."
                    );
                }

                toast.success("HAI is planning the project structure...");

                navigate(`/builder/${data._id}`);
            } catch (error) {
                console.error("Failed to generate project:", error);

                const message =
                    error?.response?.data?.error ||
                    error?.response?.data?.message ||
                    error?.message ||
                    "Failed to generate project.";

                toast.error(message);
            } finally {
                setGeneratingProject(false);
            }
        },
        [navigate, user]
    );

    // =========================
    // Delete Project
    // =========================

    const handleDelete = useCallback(
        async (id) => {
            if (!user) {
                toast.error("Please login first.");
                return;
            }

            if (!id) {
                toast.error("Invalid project.");
                return;
            }

            try {
                await api.delete(`/api/projects/${id}`);

                setProjects((previousProjects) =>
                    previousProjects.filter(
                        (project) => project._id !== id
                    )
                );

                // If deleted project is currently active,
                // clear it.
                setActiveProject((previousProject) => {
                    if (previousProject?._id === id) {
                        return null;
                    }

                    return previousProject;
                });

                toast.success("Project deleted successfully.");
            } catch (error) {
                console.error("Failed to delete project:", error);

                toast.error(
                    error?.response?.data?.message ||
                        "Failed to delete project."
                );
            }
        },
        [user]
    )

    const handleChat = useCallback(
        async (prompt)=>{
            if(!activeProject || !user) return;
            setChatLoading(true)
            try{
                const {data} = await api.post(`/api/projects/${activeProject._id}/chat`, {prompt});
                setActiveProject(data)
                if(data.errors && data.errors.length > 0){
                    toast.error(`${data.errors.length} revision patch(es) failed`);
                }else{
                    toast.success(`Updated to version ${data.version}`);
                }
            } catch (err) {
                console.error("Revision request failed:", err);
                toast.error(err?.response?.data?.error || "Revision request failed");
            }finally{
                setChatLoading(false)
            }
        },[activeProject, user]
    )

    const debouncedSave = useMemo( // 'React.useMemo' yerine sadece 'useMemo' yapıldı
        () => debounce(async (files, id) => {
            try {
                await api.put(`/api/projects/${id}/files`, {files})
            } catch (err) {
                console.error("Failed to auto-save files:", err);
                toast.error("Failed to save code modifications");
            }
        }, 1000), [],
    )

    useEffect(()=>{
        return ()=>{
            debouncedSave.flush();
        }
    },[debouncedSave])

    const updateProjectFiles = useCallback(
        async (files) =>{
            if(!activeProject || !user) return;
            debouncedSave(files, activeProject._id)
        },[activeProject, user, debouncedSave]
    )

    // =========================
    // Context
    // =========================

    const contextValue = {
        // Auth
        user,
        loadingUser,
        login,
        register,
        logout,

        // Projects
        projects,
        loadingProjects,
        activeProject,
        loadingActiveProject,

        // AI / Generation
        chatLoading,
        generatingProject,

        // Editor
        activeFile,
        setActiveFile,
        showCode,
        setShowCode,

        // Actions
        loadProjects,
        loadProject,
        handleGenerate,
        handleDelete,
        updateProjectFiles,
        handleChat,
    };

    return (
        <AppContext.Provider value={contextValue}>
            {children}
        </AppContext.Provider>
    );
}

export function useAppContext() {
    const context = useContext(AppContext);

    if (context === undefined) {
        throw new Error(
            "useAppContext must be used within an AppContextProvider."
        );
    }

    return context;
}