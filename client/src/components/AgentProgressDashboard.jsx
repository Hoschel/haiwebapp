import { CheckCircle2Icon, CircleIcon, Loader2Icon, WrenchIcon } from "lucide-react";

const STAGES = [
    ["planning", "Planning architecture"],
    ["generating", "Generating project files"],
    ["validating_integrity", "Checking syntax & dependencies"],
    ["validating_build", "Validating project build"],
    ["finalizing", "Finalizing project"],
    ["awaiting_runtime", "Waiting for preview verification"],
];

function stageIndex(stage, completed, planned) {
    if (stage) {
        const index = STAGES.findIndex(([key]) => key === stage);
        if (index >= 0) return index;
    }
    if (!planned.length) return 0;
    if (completed.length < planned.length) return 1;
    return 2;
}

export default function AgentProgressDashboard({ project }) {
    const planned = project.filesPlanned || [];
    const completed = project.filesGenerated || [];
    const current = project.currentFile;
    const isFailed = project.status === "failed";
    const currentStage = project.generationStage || null;
    const activeStage = stageIndex(currentStage, completed, planned);
    const fileProgress = planned.length ? completed.length / planned.length : 0;
    const validationStarted = activeStage >= 2;

    return (
        <div className="h-full w-full bg-zinc-50 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
            <div className="max-w-xl w-full bg-white border border-zinc-200 rounded-2xl p-6 md:p-8 relative overflow-hidden">
                <div className="flex items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-base font-medium text-zinc-800">
                            {isFailed ? "Generation Failed" : activeStage === 0 ? "Planning Architecture..." : activeStage >= 2 ? "Validating Generated Project..." : "AI Agent is Building..."}
                        </h2>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {isFailed ? "An error occurred during generation or validation" : activeStage >= 2 ? "Checking the generated project before opening the preview" : "Writing production-ready React codebase"}
                        </p>
                    </div>
                </div>

                {isFailed && project.error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700 font-medium">Error: {project.error}</div>
                )}

                {!isFailed && (
                    <div className="mb-7">
                        <div className="flex justify-between text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                            <span>{validationStarted ? "Validation" : "File generation"}</span>
                            <span>{validationStarted ? `${activeStage + 1}/${STAGES.length}` : `${Math.round(fileProgress * 100)}%`}</span>
                        </div>
                        <div className="w-full h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                            <div className="h-full bg-zinc-700 transition-all duration-500 ease-out" style={{ width: `${validationStarted ? ((activeStage + 1) / STAGES.length) * 100 : fileProgress * 100}%` }} />
                        </div>
                    </div>
                )}

                {!isFailed && (
                    <div className="mb-7 space-y-2">
                        {STAGES.map(([key, label], index) => {
                            const done = index < activeStage || (project.status === "completed" && key !== "awaiting_runtime");
                            const active = index === activeStage && project.status !== "completed";
                            return (
                                <div key={key} className={`flex items-center gap-3 rounded-lg px-2.5 py-2 ${active ? "bg-zinc-50" : ""}`}>
                                    {done ? <CheckCircle2Icon size={16} className="text-emerald-500 shrink-0" /> : active ? <Loader2Icon size={16} className="animate-spin text-zinc-900 shrink-0" /> : <CircleIcon size={16} className="text-zinc-300 shrink-0" />}
                                    <span className={`text-xs font-medium ${active ? "text-zinc-900" : done ? "text-zinc-700" : "text-zinc-400"}`}>{label}</span>
                                    {active && <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-semibold uppercase tracking-wider animate-pulse">Active</span>}
                                </div>
                            );
                        })}
                    </div>
                )}

                {planned.length > 0 && (
                    <div>
                        <span className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-3">Planned Files ({completed.length}/{planned.length})</span>
                        <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                            {planned.map((file) => {
                                const isCompleted = completed.includes(file.path);
                                const isGenerating = current === file.path;
                                return (
                                    <div key={file.path} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${isGenerating ? "bg-zinc-50/50 border-zinc-300" : isCompleted ? "bg-white border-zinc-100" : "bg-white border-zinc-100 opacity-60"}`}>
                                        {isCompleted ? <CheckCircle2Icon size={16} className="text-emerald-500 shrink-0" /> : isGenerating ? <Loader2Icon size={16} className="animate-spin text-zinc-900 shrink-0" /> : <CircleIcon size={16} className="text-zinc-300 shrink-0" />}
                                        <div className="flex-1 min-w-0"><p className={`text-xs font-medium truncate ${isGenerating ? "text-zinc-800" : "text-zinc-700"}`}>{file.path}</p><p className="text-[10px] text-zinc-400 truncate mt-0.5">{file.description}</p></div>
                                        {isGenerating && <WrenchIcon size={13} className="text-zinc-500 shrink-0" />}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {!planned.length && !isFailed && <div className="flex flex-col items-center justify-center py-6 text-zinc-400"><Loader2Icon size={24} className="animate-spin mb-2" /><p className="text-xs">Analyzing requirements and designing project structure...</p></div>}
            </div>
        </div>
    );
}
