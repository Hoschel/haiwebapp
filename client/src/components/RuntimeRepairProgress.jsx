import { CheckCircle2Icon, CircleAlertIcon, Loader2Icon, SearchIcon, WrenchIcon } from "lucide-react";

const STEPS = [
    { key: "analyzing", label: "Analyzing runtime error", icon: SearchIcon },
    { key: "locating", label: "Finding affected files", icon: SearchIcon },
    { key: "repairing", label: "Repairing project", icon: WrenchIcon },
    { key: "verifying", label: "Verifying preview", icon: Loader2Icon },
];

export default function RuntimeRepairProgress({ active = false, attempt = 0, error, phase = "repairing" }) {
    const phaseIndex = phase === "fixed" ? STEPS.length : Math.max(0, STEPS.findIndex((step) => step.key === phase));

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/88 backdrop-blur-sm p-6">
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
                <div className="flex items-start gap-3 mb-5">
                    <div className="mt-0.5 rounded-xl bg-zinc-100 p-2">
                        {phase === "failed" ? <CircleAlertIcon size={20} className="text-red-500" /> : phase === "fixed" ? <CheckCircle2Icon size={20} className="text-emerald-500" /> : <Loader2Icon size={20} className="animate-spin text-zinc-800" />}
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-zinc-900">
                            {phase === "failed" ? "Automatic repair stopped" : phase === "fixed" ? "Preview verified" : "AI is repairing the preview"}
                        </h3>
                        <p className="mt-0.5 text-xs text-zinc-500">
                            {attempt > 0 ? `Automatic repair attempt ${attempt} of 2` : "Inspecting the generated project"}
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    {STEPS.map((step, index) => {
                        const Icon = step.icon;
                        const done = phase === "fixed" || index < phaseIndex;
                        const current = active && index === phaseIndex;
                        return (
                            <div key={step.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${current ? "border-zinc-300 bg-zinc-50" : "border-zinc-100 bg-white"}`}>
                                {done ? <CheckCircle2Icon size={16} className="shrink-0 text-emerald-500" /> : current ? <Icon size={16} className="shrink-0 animate-spin text-zinc-900" /> : <div className="h-4 w-4 rounded-full border border-zinc-300 shrink-0" />}
                                <span className={`text-xs font-medium ${done || current ? "text-zinc-800" : "text-zinc-400"}`}>{step.label}</span>
                            </div>
                        );
                    })}
                </div>

                {error?.message && phase !== "fixed" && (
                    <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700 line-clamp-3">{error.message}</p>
                )}
            </div>
        </div>
    );
}
