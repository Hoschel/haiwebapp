import React, { useEffect, useRef } from 'react';
import { useSandpack } from '@codesandbox/sandpack-react';
import { useAppContext } from '../context/AppContext';
import api from '../api/api';

const NETWORK_MARKERS = ["Failed to fetch", "col.csbops.io", "ERR_CONNECTION_TIMED_OUT", "net::ERR", "NetworkError"];
function normalizeError(error) { if (!error) return null; const message = String(error.message || error.toString?.() || error); return { message, stack: error.stack ? String(error.stack) : "" }; }

const SandpackErrorMonitor = ({ onErrorChange }) => {
    const { sandpack } = useSandpack();
    const { error } = sandpack;
    const { reportRuntimeError, activeProject } = useAppContext();
    const lastReportedRef = useRef("");
    const runtimeStateRef = useRef("pending");

    useEffect(() => {
        const normalized = normalizeError(error);
        if (!normalized) {
            onErrorChange(true);
            if (runtimeStateRef.current === "failed" && activeProject?._id) {
                runtimeStateRef.current = "passed";
                api.post(`/api/projects/${activeProject._id}/verification/runtime`, { status: "passed" }).catch(() => {});
            }
            return;
        }
        const isNetworkError = NETWORK_MARKERS.some((marker) => normalized.message.includes(marker));
        onErrorChange(!isNetworkError);
        if (isNetworkError) return;
        const signature = `${activeProject?._id || "unknown"}:${normalized.message}\n${normalized.stack}`;
        if (signature === lastReportedRef.current) return;
        lastReportedRef.current = signature;
        runtimeStateRef.current = "failed";
        if (activeProject?._id) api.post(`/api/projects/${activeProject._id}/verification/runtime`, { status: "failed", error: normalized.message }).catch(() => {});
        reportRuntimeError?.({ ...normalized, source: "sandpack" });
    }, [error, onErrorChange, reportRuntimeError, activeProject?._id]);
    return null;
};
export default SandpackErrorMonitor;
