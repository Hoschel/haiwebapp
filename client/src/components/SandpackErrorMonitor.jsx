import React, { useEffect, useRef } from 'react';
import { useSandpack } from '@codesandbox/sandpack-react';
import { useAppContext } from '../context/AppContext';

const NETWORK_MARKERS = ["Failed to fetch", "col.csbops.io", "ERR_CONNECTION_TIMED_OUT", "net::ERR", "NetworkError"];

function normalizeError(error) {
    if (!error) return null;
    const message = String(error.message || error.toString?.() || error);
    return { message, stack: error.stack ? String(error.stack) : "" };
}

const SandpackErrorMonitor = ({ onErrorChange }) => {
    const { sandpack } = useSandpack();
    const { error } = sandpack;
    const { reportRuntimeError } = useAppContext();
    const lastReportedRef = useRef("");

    useEffect(() => {
        const normalized = normalizeError(error);
        if (!normalized) {
            onErrorChange(true);
            return;
        }

        const isNetworkError = NETWORK_MARKERS.some((marker) => normalized.message.includes(marker));
        onErrorChange(!isNetworkError);
        if (isNetworkError) return;

        const signature = `${normalized.message}\n${normalized.stack}`;
        if (signature === lastReportedRef.current) return;
        lastReportedRef.current = signature;
        reportRuntimeError?.({ ...normalized, source: "sandpack" });
    }, [error, onErrorChange, reportRuntimeError]);

    return null;
};

export default SandpackErrorMonitor;
