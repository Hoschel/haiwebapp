import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SandpackCodeEditor, SandpackLayout, SandpackPreview, SandpackProvider, useSandpack } from '@codesandbox/sandpack-react'
import { detectDependencies } from '../utils/sandpackUtils';
import { useAppContext } from '../context/AppContext';
import SandpackErrorMonitor from './SandpackErrorMonitor';
import ConflictResolutionBar from './ConflictResolutionBar';

function SandpackFileWatches({ onLiveFilesChange }) {
    const { sandpack } = useSandpack();
    const { files } = sandpack;
    const { activeProject, updateProjectFiles } = useAppContext();
    const projectRef = useRef(activeProject);
    const lastSentRef = useRef("");
    const initializedRef = useRef(false);

    useEffect(() => {
        projectRef.current = activeProject;
    }, [activeProject]);

    useEffect(() => {
        initializedRef.current = false;
        lastSentRef.current = "";
    }, [activeProject?._id, activeProject?.version]);

    useEffect(() => {
        const project = projectRef.current;
        if (!project || !files) return;
        const updatedFiles = {};
        for (const [path, fileObj] of Object.entries(files)) updatedFiles[path] = typeof fileObj === "string" ? fileObj : fileObj?.code || "";
        onLiveFilesChange(updatedFiles);
        const serialized = JSON.stringify(updatedFiles);
        if (!initializedRef.current) { initializedRef.current = true; lastSentRef.current = serialized; return; }
        if (serialized === lastSentRef.current) return;
        lastSentRef.current = serialized;
        const projectFiles = project.files || {};
        let hasChanges = Object.keys(updatedFiles).length !== Object.keys(projectFiles).length;
        if (!hasChanges) for (const [path, code] of Object.entries(updatedFiles)) {
            const original = typeof projectFiles[path] === "string" ? projectFiles[path] : projectFiles[path]?.content;
            if (original !== code) { hasChanges = true; break; }
        }
        if (hasChanges) updateProjectFiles(updatedFiles);
    }, [files, onLiveFilesChange, updateProjectFiles]);
    return null;
}

const PreviewPanel = ({ project, activeFile, showCode }) => {
    const [showErrorOverlay, setShowErrorOverlay] = useState(true);
    const [liveFiles, setLiveFiles] = useState(project.files || {});
    const projectKey = `${project._id}-${project.version}`;
    const projectKeyRef = useRef(projectKey);
    useEffect(() => { if (projectKeyRef.current !== projectKey) { projectKeyRef.current = projectKey; setLiveFiles(project.files || {}); } }, [projectKey, project.files]);
    const handleLiveFilesChange = useCallback((newFiles) => setLiveFiles((previous) => JSON.stringify(previous) === JSON.stringify(newFiles) ? previous : newFiles), []);
    const sandpackFiles = useMemo(() => Object.fromEntries(Object.entries(liveFiles).map(([path, content]) => [path, { code: typeof content === "string" ? content : content?.content || "", active: path === activeFile }])), [liveFiles, activeFile]);
    const dependencies = useMemo(() => detectDependencies(liveFiles), [liveFiles]);

    return (
        <div className='relative h-full w-full'>
            <ConflictResolutionBar />
            <SandpackProvider key={projectKey} template='react' files={sandpackFiles} customSetup={{ dependencies }} options={{ externalResources: ["https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.3.1/css/all.min.css"], classes: { "sp-wrapper": "sp-wrapper", "sp-layout": "sp-layout", "sp-preview": "sp-preview" }, logLevel: 0 }} theme={{ colors: { surface1: "#ffffff", surface2: "#f4f4f5", surface3: "#e4e4e7", clickable: "#71717a", base: "#09090b", disabled: "#a1a1aa", hover: "#18181b", accent: "#18181b", error: "#ef4444", errorSurface: "#fef2f2" }, font: { body: "'Urbanist', system-ui, -apple-system, sans-serif", mono: "'Geist Mono', ui-monospace, monospace", size: "13px", lineHeight: "1.6" } }}>
                <SandpackFileWatches onLiveFilesChange={handleLiveFilesChange} />
                <SandpackErrorMonitor onErrorChange={setShowErrorOverlay} />
                <SandpackLayout style={{ height: "100%", border: "none", borderRadius: 0, background: "transparent" }}>
                    {showCode && <SandpackCodeEditor showTabs showLineNumbers showInlineErrors wrapContent style={{ height: "100%", flex: 1, minWidth: 0 }} />}
                    <SandpackPreview showNavigator={false} showRefreshButton showOpenInCodeSandbox={false} showSandpackErrorOverlay={showErrorOverlay} style={{ height: "100%", flex: showCode ? 1 : 2, minWidth: 0 }} />
                </SandpackLayout>
            </SandpackProvider>
        </div>
    );
};
export default PreviewPanel;
