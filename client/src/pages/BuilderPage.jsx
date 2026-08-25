import React, { useEffect, useRef, useState } from 'react'
import { useAppContext } from '../context/AppContext'
import { useNavigate, useParams } from 'react-router-dom';
import Loading from '../components/Loading';
import BuilderHeader from '../components/BuilderHeader';
import { FolderTreeIcon, MessageSquareIcon } from 'lucide-react';
import ChatPanel from '../components/ChatPanel';
import FileExplorer from '../components/FileExplorer';
import PreviewPanel from '../components/PreviewPanel';
import AgentProgressDashboard from '../components/AgentProgressDashboard';
import RuntimeRepairProgress from '../components/RuntimeRepairProgress';
import PublishModel from '../components/PublishModel';
import api from '../api/api';
import toast from 'react-hot-toast';
import { exportProjectZip } from '../utils/exportProject';

const BuilderPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [leftTab, setLeftTab] = useState("chat");
  const [publishing, setPublishing] = useState(false);
  const [publishUrl, setPublishUrl] = useState(null);
  const [repairPhase, setRepairPhase] = useState(null);
  const repairTimerRef = useRef(null);

  const {
    activeProject,
    loadingActiveProject,
    activeFile,
    showCode,
    setActiveFile,
    setShowCode,
    loadProject,
    logout,
    chatLoading,
    handleChat,
    saveState,
    runtimeError,
    repairingRuntime,
    runtimeRepairCount,
  } = useAppContext();

  useEffect(() => {
    if (!id) return;
    loadProject(id);
  }, [id, loadProject]);

  useEffect(() => {
    if (repairTimerRef.current) clearTimeout(repairTimerRef.current);
    if (repairingRuntime) {
      setRepairPhase("analyzing");
      repairTimerRef.current = setTimeout(() => setRepairPhase("locating"), 350);
      return;
    }
    if (runtimeRepairCount > 0 && !runtimeError) {
      setRepairPhase("verifying");
      repairTimerRef.current = setTimeout(() => setRepairPhase("fixed"), 600);
      return;
    }
    if (runtimeRepairCount >= 2 && runtimeError) {
      setRepairPhase("failed");
      return;
    }
    setRepairPhase(null);
  }, [repairingRuntime, runtimeRepairCount, runtimeError]);

  useEffect(() => () => repairTimerRef.current && clearTimeout(repairTimerRef.current), []);

  const handleOpenPreview = () => {
    if (id) window.open(`/preview/${id}`, "_blank", "noopener,noreferrer");
  };

  const handlePublish = async () => {
    if (!id || saveState === "conflict" || saveState === "saving") {
      if (saveState === "conflict") toast.error("Resolve the save conflict before publishing.");
      return;
    }
    setPublishing(true);
    try {
      await api.post(`/api/project/${id}/publish`);
      const url = `${window.location.origin}/publish/${id}`;
      setPublishUrl(url);
      toast.success("Website published successfully!");
    } catch (err) {
      console.error("Publish failed:", err);
      toast.error(err?.response?.data?.error || "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  const handleDownload = () => {
    if (activeProject) exportProjectZip(activeProject);
  };

  if (loadingActiveProject || !activeProject) return <Loading />;

  const isGenerating = ["pending", "generating", "revising"].includes(activeProject.status);
  const showRepairOverlay = !isGenerating && activeProject.status !== "failed" && repairPhase;
  const effectiveRepairPhase = repairingRuntime && repairPhase === "locating" ? "locating" : repairingRuntime ? "repairing" : repairPhase;

  return (
    <div className='h-screen flex flex-col bg-white overflow-hidden text-zinc-900 relative'>
      <BuilderHeader
        projectName={activeProject.name}
        version={activeProject.version}
        saveState={saveState}
        status={activeProject.status}
        showCode={showCode}
        publishing={publishing}
        onToggleShowCode={() => setShowCode(!showCode)}
        onOpenPreview={handleOpenPreview}
        onPublish={handlePublish}
        onDownload={handleDownload}
        onBack={() => navigate("/")}
        onLogout={logout}
      />

      <div className='flex-1 flex overflow-hidden'>
        <div className='w-[320px] shrink-0 flex flex-col border-r border-zinc-200 bg-white'>
          <div className='flex border-b border-zinc-100'>
            <button onClick={() => setLeftTab("chat")} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium cursor-pointer ${leftTab === "chat" ? "text-zinc-900 border-b-2 border-zinc-900" : "text-zinc-400 hover:text-zinc-700"}`}>
              <MessageSquareIcon size={13}/> Chat
            </button>
            <button onClick={() => setLeftTab("files")} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium cursor-pointer ${leftTab === "files" ? "text-zinc-900 border-b-2 border-zinc-900" : "text-zinc-400 hover:text-zinc-700"}`}>
              <FolderTreeIcon size={13}/> Files
            </button>
          </div>
          <div className='flex-1 overflow-hidden'>
            {leftTab === 'chat' ? (
              <ChatPanel messages={activeProject.messages} onSend={handleChat} loading={chatLoading || activeProject.status === "revising" || repairingRuntime} />
            ) : (
              <FileExplorer files={activeProject.files} activeFile={activeFile} onFileSelect={(path) => { setActiveFile(path); setShowCode(true); }} />
            )}
          </div>
        </div>

        <div className='flex-1 overflow-hidden relative'>
          {isGenerating || activeProject.status === "failed" ? (
            <AgentProgressDashboard project={activeProject} />
          ) : (
            <PreviewPanel project={activeProject} activeFile={activeFile} showCode={showCode} />
          )}
          {showRepairOverlay && (
            <RuntimeRepairProgress
              active={repairingRuntime}
              attempt={runtimeRepairCount}
              error={runtimeError}
              phase={effectiveRepairPhase}
            />
          )}
        </div>
      </div>
      {publishUrl && <PublishModel publishUrl={publishUrl} onClose={() => setPublishUrl(null)} />}
    </div>
  );
};

export default BuilderPage;
