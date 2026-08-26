import React, { useEffect, useRef } from 'react';
import { useSandpack } from '@codesandbox/sandpack-react';
import { useAppContext } from '../context/AppContext';
import api from '../api/api';

const NETWORK_MARKERS = ["Failed to fetch", "col.csbops.io", "ERR_CONNECTION_TIMED_OUT", "net::ERR", "NetworkError"];
const SUCCESS_SETTLE_MS = 1200;
function normalizeError(error) { if (!error) return null; const message = String(error.message || error.toString?.() || error); return { message, stack: error.stack ? String(error.stack) : "" }; }

const SandpackErrorMonitor = ({ onErrorChange }) => {
    const { sandpack } = useSandpack();
    const { error } = sandpack;
    const { reportRuntimeError, activeProject } = useAppContext();
    const lastReportedRef = useRef("");
    const reportedVersionRef = useRef("");

    useEffect(() => {
        const normalized = normalizeError(error);
        const projectId = activeProject?._id;
        const version = activeProject?.version;
        const versionKey = projectId != null && version != null ? `${projectId}:${version}` : "";
        if (!Number.isInteger(version)) return undefined;

        if (!normalized) {
            onErrorChange(true);
            if (!versionKey || reportedVersionRef.current === versionKey) return undefined;
            const timer = setTimeout(() => {
                if (reportedVersionRef.current === versionKey) return;
                reportedVersionRef.current = versionKey;
                api.post(`/api/projects/${projectId}/verification/runtime`, { status: "passed", version }).catch(() => {
                    if (reportedVersionRef.current === versionKey) reportedVersionRef.current = "";
                });
            }, SUCCESS_SETTLE_MS);
            return () => clearTimeout(timer);
        }

        const isNetworkError = NETWORK_MARKERS.some((marker) => normalized.message.includes(marker));
        onErrorChange(!isNetworkError);
        if (isNetworkError) return undefined;

        const signature = `${projectId || "unknown"}:${version}:${normalized.message}\n${normalized.stack}`;
        if (signature === lastReportedRef.current) return undefined;
        lastReportedRef.current = signature;
        if (projectId) {
            reportedVersionRef.current = versionKey;
            api.post(`/api/projects/${projectId}/verification/runtime`, { status: "failed", error: normalized.message, version }).catch(() => {});
        }
        reportRuntimeError?.({ ...normalized, source: "sandpack" });
        return undefined;
    }, [error, onErrorChange, reportRuntimeError, activeProject?._id, activeProject?.version]);

    return null;
};
export default SandpackErrorMonitor;
