import React, { useState, useEffect, useRef } from 'react';
import { X, Save, ShieldAlert, Code, Loader2, RotateCcw } from 'lucide-react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-css';

const IntegrationFullscreenEditor = ({ isOpen, filename, onClose }) => {
    const [content, setContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);
    const [saveStatus, setSaveStatus] = useState(null); // 'success' | 'error' | null
    const [restoreStatus, setRestoreStatus] = useState(null); // 'success' | 'error' | null
    const [hasDefault, setHasDefault] = useState(false);
    const [isLocked, setIsLocked] = useState(false);

    useEffect(() => {
        if (isOpen && filename) {
            fetchContent();
        }
    }, [isOpen, filename]);

    useEffect(() => {
        let pollInterval;
        if (isOpen) {
            pollInterval = setInterval(async () => {
                try {
                    const res = await fetch('/api/integrations/status');
                    const data = await res.json();

                    // If it transitions from unlocked to locked
                    if (data.isLocked && !isLocked) {
                        setIsLocked(true);
                        setContent(prev => prev.replace(/[a-zA-Z0-9]/g, '*'));
                    } else if (!data.isLocked && isLocked) {
                        // Optional: unlock if file is removed? 
                        // User didn't ask for this specifically but it makes sense for a "live" UI.
                        // However, once obfuscated, we'd need to re-fetch the content.
                        setIsLocked(false);
                        fetchContent();
                    }
                } catch (err) {
                    console.error("Lock polling error:", err);
                }
            }, 5000);
        }
        return () => {
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [isOpen, isLocked, filename]);

    const fetchContent = async () => {
        setIsLoading(true);
        setError(null);
        try {
            // Check lock status first
            const lockRes = await fetch('/api/integrations/status');
            const lockData = await lockRes.json();
            setIsLocked(lockData.isLocked);

            const encodedFilename = encodeURIComponent(filename);
            const res = await fetch(`/integrations/${encodedFilename}?t=${Date.now()}`);
            if (!res.ok) throw new Error(`Failed to load ${filename}`);
            let text = await res.text();

            // If locked, obfuscate locally as well (redundancy with backend)
            if (lockData.isLocked) {
                text = text.replace(/[a-zA-Z0-9]/g, '*');
            }

            setContent(text);

            // Check if .default file exists
            const lastDot = filename.lastIndexOf('.');
            const baseName = lastDot !== -1 ? filename.substring(0, lastDot) : filename;
            const defaultFilename = baseName + '.default';
            const encodedDefaultFilename = encodeURIComponent(defaultFilename);
            const defaultCheck = await fetch(`/integrations/${encodedDefaultFilename}`, { method: 'HEAD' });
            setHasDefault(defaultCheck.ok);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRestoreDefaults = async () => {
        if (isLocked) return;
        const lastDot = filename.lastIndexOf('.');
        const baseName = lastDot !== -1 ? filename.substring(0, lastDot) : filename;
        const defaultFilename = baseName + '.default';

        if (!confirm(`Are you sure you want to restore "${filename}" to its default state? Your current changes will be lost.`)) {
            return;
        }

        setIsLoading(true);
        setRestoreStatus(null);
        setError(null);

        try {
            const encodedDefaultFilename = encodeURIComponent(defaultFilename);
            const res = await fetch(`/integrations/${encodedDefaultFilename}?t=${Date.now()}`);
            if (!res.ok) throw new Error(`Default template for ${filename} not found.`);
            const text = await res.text();
            setContent(text);
            setRestoreStatus('success');
            setTimeout(() => setRestoreStatus(null), 3000);
        } catch (err) {
            setError(err.message);
            setRestoreStatus('error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        if (isLocked) return;
        setIsSaving(true);
        setSaveStatus(null);
        setError(null);
        try {
            const res = await fetch('/api/integration/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, content })
            });
            const data = await res.json();
            if (data.success) {
                setSaveStatus('success');
                setTimeout(() => setSaveStatus(null), 3000);
            } else {
                throw new Error(data.error || 'Failed to save');
            }
        } catch (err) {
            setError(err.message);
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            handleSave();
        }
        if (e.key === 'Escape') {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[1000] flex flex-col bg-[#0a0a0f] text-gray-300 font-sans"
            onKeyDown={handleKeyDown}
        >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/5 bg-[#16161e] shadow-lg">
                <div className="flex items-center space-x-4">
                    <div className="p-2 bg-orange-500/10 rounded-lg">
                        <Code size={20} className="text-orange-500" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-white uppercase tracking-widest leading-none">
                            Integration Editor
                        </h2>
                        <p className="text-[10px] text-gray-500 font-mono mt-1">
                            {filename}
                        </p>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    {saveStatus === 'success' && (
                        <span className="text-[10px] text-green-400 font-bold uppercase tracking-widest animate-pulse">
                            Changes Saved Successfully
                        </span>
                    )}
                    {saveStatus === 'error' && (
                        <span className="text-[10px] text-red-400 font-bold uppercase tracking-widest">
                            Save Failed
                        </span>
                    )}

                    {restoreStatus === 'success' && (
                        <span className="text-[10px] text-orange-400 font-bold uppercase tracking-widest animate-pulse">
                            Defaults Restored
                        </span>
                    )}

                    {hasDefault && !isLocked && !isLoading && (
                        <button
                            onClick={handleRestoreDefaults}
                            className="flex items-center px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold uppercase tracking-widest transition-all mr-2"
                            title="Restore to default template"
                        >
                            <RotateCcw size={14} className="mr-2" />
                            Restore Defaults
                        </button>
                    )}

                    <button
                        onClick={handleSave}
                        disabled={isSaving || isLoading || isLocked}
                        className={`flex items-center px-4 py-2 rounded-none text-xs font-bold uppercase tracking-widest transition-all ${(isSaving || isLocked) ? 'bg-gray-600/50 cursor-not-allowed opacity-50' : 'bg-orange-600 hover:bg-orange-500 text-white shadow-lg active:scale-95'
                            }`}
                        title={isLocked ? "Editor is locked" : "Save changes (CTRL+S)"}
                    >
                        {isSaving ? <Loader2 size={14} className="mr-2 animate-spin" /> : isLocked ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mr-2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor" stroke="none" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                        ) : <Save size={14} className="mr-2" />}
                        {isSaving ? 'Saving...' : isLocked ? 'Locked' : 'Save Changes'}
                    </button>

                    <button
                        onClick={onClose}
                        className="p-2 text-gray-500 hover:text-white hover:bg-white/5 transition-colors rounded-full"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 relative flex flex-col overflow-hidden bg-[#0d0d12]">
                {isLoading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f] z-10">
                        <Loader2 size={40} className="text-orange-500 animate-spin mb-4" />
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">Loading Codebase...</p>
                    </div>
                ) : error ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f] z-10 p-6 text-center">
                        <ShieldAlert size={48} className="text-red-500 mb-4" />
                        <h3 className="text-lg font-bold text-white uppercase tracking-widest mb-2">Editor Error</h3>
                        <p className="text-sm text-gray-400 max-w-md mb-6">{error}</p>
                        <button
                            onClick={fetchContent}
                            className="px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold uppercase tracking-widest transition-all"
                        >
                            Retry Loading
                        </button>
                    </div>
                ) : null}

                <div className="flex-1 overflow-auto custom-scrollbar p-8">
                    <Editor
                        value={content}
                        onValueChange={code => !isLocked && setContent(code)}
                        highlight={code => Prism.highlight(code, Prism.languages.markup, 'html')}
                        padding={10}
                        style={{
                            fontFamily: '"Fira Code", "Fira Mono", monospace',
                            fontSize: '1.5rem',
                            outline: 'none',
                            minHeight: '100%',
                            opacity: isLocked ? 0.4 : 1,
                            pointerEvents: isLocked ? 'none' : 'auto'
                        }}
                        textareaClassName="focus:outline-none"
                    />
                </div>

                {/* Lock Overlay */}
                {isLocked && !isLoading && !error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] z-20 pointer-events-none">
                        <div className="bg-[#16161e] border border-orange-500/20 p-8 shadow-2xl flex flex-col items-center max-w-sm text-center transform -rotate-1 animate-in zoom-in-95 duration-300">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-orange-500 mb-4 animate-pulse" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor" stroke="none" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            <h3 className="text-xl font-black text-white uppercase tracking-[0.2em] mb-2 font-mono">
                                INTEGRATION LOCKED
                            </h3>
                        </div>
                    </div>
                )}
            </div>

            {/* Styling for the editor container to ensure it looks good */}
            <style dangerouslySetInnerHTML={{
                __html: `
                .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #6272a4; }
                .token.punctuation { color: #f8f8f2; }
                .token.namespace { opacity: .7; }
                .token.property, .token.tag, .token.constant, .token.symbol, .token.deleted { color: #ff79c6; }
                .token.boolean, .token.number { color: #bd93f9; }
                .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #50fa7b; }
                .token.operator, .token.entity, .token.url, .language-css .token.string, .style .token.string, .token.variable { color: #f8f8f2; }
                .token.atrule, .token.attr-value, .token.function, .token.class-name { color: #f1fa8c; }
                .token.keyword { color: #8be9fd; }
                .token.regex, .token.important { color: #ffb86c; }
            `}} />

            {/* Footer / Status Bar */}
            <div className="px-4 py-1.5 bg-[#16161e] border-t border-white/5 flex items-center justify-between text-[9px] font-mono text-gray-600 tracking-tighter uppercase">
                <div className="flex items-center space-x-4">
                    <span>Path: /integrations/{filename}</span>
                    <span>Syntax: HTML/MIXED</span>
                </div>
                <div className="flex items-center space-x-4">
                    <span>{content.length} characters</span>
                    <span>CTRL+S to Save</span>
                </div>
            </div>
        </div>
    );
};

export default IntegrationFullscreenEditor;
