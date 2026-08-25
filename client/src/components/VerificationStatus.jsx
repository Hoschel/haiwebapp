import React, { useEffect, useState } from 'react';
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, ShieldCheckIcon, XCircleIcon } from 'lucide-react';
import api from '../api/api';

const STATUS = {
    passed: { label: 'Passed', icon: CheckCircle2Icon, className: 'text-emerald-600' },
    failed: { label: 'Failed', icon: XCircleIcon, className: 'text-red-600' },
    pending: { label: 'Pending', icon: Loader2Icon, className: 'text-zinc-400' },
};

function VerificationItem({ label, status }) {
    const config = STATUS[status] || STATUS.pending;
    const Icon = config.icon;
    return <div className='flex items-center justify-between gap-3 text-xs'>
        <span className='text-zinc-600'>{label}</span>
        <span className={`inline-flex items-center gap-1 font-medium ${config.className}`}><Icon size={13} className={status === 'pending' ? 'animate-spin' : ''} />{config.label}</span>
    </div>;
}

const VerificationStatus = ({ projectId, version, compact = true }) => {
    const [verification, setVerification] = useState(null);
    const [loading, setLoading] = useState(Boolean(projectId));
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        api.get(`/api/projects/${projectId}/verification`)
            .then(({ data }) => { if (!cancelled) setVerification(data?.verification || null); })
            .catch((requestError) => { if (!cancelled) setError(requestError?.response?.data?.error || 'Verification unavailable'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [projectId, version]);

    if (loading) return compact ? <span className='inline-flex items-center gap-1 text-[10px] text-zinc-400'><Loader2Icon size={12} className='animate-spin' /> Checking</span> : null;
    if (error) return <span title={error} className='inline-flex items-center gap-1 text-[10px] text-amber-600'><AlertTriangleIcon size={12} /> Verification unavailable</span>;
    if (!verification) return null;

    const verified = verification.status === 'verified';
    if (compact) {
        return <span title={verified ? 'Syntax, dependencies and runtime verified' : verification.status === 'failed' ? 'Project verification failed' : 'Waiting for runtime verification'} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${verified ? 'bg-emerald-50 text-emerald-700' : verification.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
            {verified ? <ShieldCheckIcon size={12} /> : verification.status === 'failed' ? <XCircleIcon size={12} /> : <Loader2Icon size={12} className='animate-spin' />}
            {verified ? 'Verified' : verification.status === 'failed' ? 'Verification failed' : 'Verifying'}
        </span>;
    }

    return <div className='absolute top-14 right-3 z-20 w-72 rounded-xl border border-zinc-200 bg-white shadow-lg p-3 space-y-2'>
        <div className='flex items-center gap-2 border-b border-zinc-100 pb-2'><ShieldCheckIcon size={15} className={verified ? 'text-emerald-600' : 'text-zinc-500'} /><span className='text-sm font-semibold'>Project verification</span></div>
        <VerificationItem label='Syntax & integrity' status={verification.static?.status} />
        <VerificationItem label='Runtime preview' status={verification.runtime?.status} />
        {verification.static?.errors?.length > 0 && <p className='text-[11px] text-red-600 line-clamp-3'>{verification.static.errors[0]?.message || 'Static verification failed'}</p>}
        {verification.runtime?.error && <p className='text-[11px] text-red-600 line-clamp-3'>{verification.runtime.error}</p>}
    </div>;
};

export default VerificationStatus;
