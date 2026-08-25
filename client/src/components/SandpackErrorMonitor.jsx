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
    const reportedVersionRef = useRef("");

    useEffect(() => {
        const normalized = normalizeError(error);
        const projectId = activeProject?._id;
        const version = activeProject?.version;
        const versionKey = projectId != null && version != null ? `${projectId}:${version}` : "";

        if (!normalized) {
            onErrorChange(true);
            // Sandpack has mounted without an application error. Report one
            // successful runtime result per project version so new revisions
            // can become verified without first having to fail.
            if (versionKey && reportedVersionRef.current !== versionKey) {
                runtimeStateRef.current = "passed";
                reportedVersionRef.current = versionKey;
                api.post(`/api/projects/${projectId}/verification/runtime`, { status: "passed" }).catch(() => {});
            }
            return;
        }

        const isNetworkError = NETWORK_MARKERS.some((marker) => normalized.message.includes(marker));
        onErrorChange(!isNetworkError);
        if (isNetworkError) return;

        const signature = `${projectId || "unknown"}:${version ?? "unknown"}:${normalized.message}\n${normalized.stack}`;
        if (signature === lastReportedRef.current) return;
        lastReportedRef.current = signature;
        runtimeStateRef.current = "failed";
        if (projectId) {
            reportedVersionRef.current = versionKey;
            api.post(`/api/projects/${projectId}/verification/runtime`, { status: "failed", error: normalized.message }).catch(() => {});
        }
        reportRuntimeError?.({ ...normalized, source: "sandpack" });
    }, [error, onErrorChange, reportRuntimeError, activeProject?._id, activeProject?.version]);

    return null;
};
export default SandpackErrorMonitor;
