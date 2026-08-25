import React from "react";
import { useAppContext } from "../context/AppContext";

export default function ConflictResolutionBar() {
    const { conflict, saveState, resolveConflict } = useAppContext();
    if (!conflict && saveState !== "conflict") return null;
    const count = conflict?.conflicts?.length || 0;
    return (
        <div className="absolute left-3 right-3 top-3 z-50 rounded-xl border border-amber-300 bg-white/95 p-3 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900">File changes conflict</div>
                    <div className="text-xs text-zinc-500">{count ? `${count} file conflict(s) require review.` : "Changes were merged automatically; choose how to save them."}</div>
                </div>
                <button type="button" onClick={() => resolveConflict("local")} className="rounded-lg border px-3 py-1.5 text-xs font-medium">Keep mine</button>
                <button type="button" onClick={() => resolveConflict("remote")} className="rounded-lg border px-3 py-1.5 text-xs font-medium">Keep server</button>
                <button type="button" onClick={() => resolveConflict("merged")} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white">Save merged</button>
            </div>
        </div>
    );
}
