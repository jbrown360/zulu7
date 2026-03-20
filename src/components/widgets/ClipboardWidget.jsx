import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Upload, Trash2, Download, File, Infinity as InfinityIcon, Loader2, CloudRain, Copy, Check, Send, AlignLeft, ExternalLink } from 'lucide-react';

const ClipboardWidget = ({ widget, isLocked, isStandalone }) => {
    // Expected config format: "share_key|Display Name"
    const safeValue = widget?.value || '';
    const [key, displayName] = safeValue.split('|');
    const displayTitle = displayName || 'Shared Clipboard';
    const activeKey = key || 'default';

    const [files, setFiles] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const [textInput, setTextInput] = useState('');
    const [copiedFile, setCopiedFile] = useState(null);
    
    const fileInputRef = useRef(null);

    const copyToClipboard = (text) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
            }).catch(err => {
                console.error('Async: Could not copy text: ', err);
                fallbackCopyTextToClipboard(text);
            });
        } else {
            fallbackCopyTextToClipboard(text);
        }
    };

    const fallbackCopyTextToClipboard = (text) => {
        var textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            var successful = document.execCommand('copy');
            if (successful) {
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
            }
        } catch (err) {}
        document.body.removeChild(textArea);
    };

    const fetchFiles = useCallback(async () => {
        try {
            const res = await fetch(`/api/clipboard/${activeKey}`);
            if (!res.ok) throw new Error('Failed to fetch files');
            const data = await res.json();
            setFiles(data.files || []);
            setError(null);
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [activeKey]);

    // Poll for updates every 2 seconds for faster cross-device syncing
    useEffect(() => {
        fetchFiles();
        const interval = setInterval(fetchFiles, 2000);
        return () => clearInterval(interval);
    }, [fetchFiles]);

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatDate = (ms) => {
        if (!ms) return '';
        const d = new Date(ms);
        return d.toLocaleString(undefined, { 
            month: 'short', day: 'numeric', 
            hour: 'numeric', minute: '2-digit' 
        });
    };

    const handleUpload = async (uploadFile, customName = null) => {
        if (!uploadFile) return;
        
        setIsUploading(true);
        setUploadProgress(10);
        setError(null);

        const formData = new FormData();
        if (customName) {
            formData.append('file', uploadFile, customName);
        } else {
            formData.append('file', uploadFile);
        }

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/clipboard/${activeKey}/upload`, true);
            
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percentComplete = (e.loaded / e.total) * 100;
                    setUploadProgress(percentComplete);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    setUploadProgress(100);
                    setTimeout(() => {
                        setIsUploading(false);
                        setUploadProgress(0);
                        fetchFiles(); // Refresh list immediately
                    }, 500);
                } else {
                    console.error("Upload failed", xhr.responseText);
                    setError('Upload failed');
                    setIsUploading(false);
                    setUploadProgress(0);
                }
            };

            xhr.onerror = () => {
                setError('Network error during upload');
                setIsUploading(false);
                setUploadProgress(0);
            };

            xhr.send(formData);

        } catch (err) {
            console.error("Upload error:", err);
            setError('Upload failed');
            setIsUploading(false);
            setUploadProgress(0);
        }
    };

    const onFileChange = (e) => {
        const file = e.target.files[0];
        if (file) handleUpload(file);
    };

    const onDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const onDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const onDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleUpload(e.dataTransfer.files[0]);
        }
    };

    const handleTextUpload = async (e) => {
        if (e) e.preventDefault();
        try {
            if (!textInput.trim()) return;

            const dateStr = new Date().toISOString().replace(/[:.T]/g, '-').slice(0, 19);
            let previewName = textInput.trim().slice(0, 10).replace(/[^a-zA-Z0-9_-]/g, '_');
            if (!previewName) previewName = 'text';
            const fileName = `${previewName}_${dateStr}.txt`;
            
            const blob = new Blob([textInput], { type: 'text/plain' });
            await handleUpload(blob, fileName);
            setTextInput('');
        } catch (err) {
            console.error("Text Upload Error:", err);
            setError(err.message || "Failed to process text input");
        }
    };

    const handleCopyFile = async (filename, e) => {
        if (e) e.stopPropagation();
        try {
            const res = await fetch(`/api/clipboard/${activeKey}/download/${encodeURIComponent(filename)}`);
            if (!res.ok) throw new Error('Failed to fetch file for copying');
            const text = await res.text();
            copyToClipboard(text);
            setCopiedFile(filename);
            setTimeout(() => setCopiedFile(null), 2000);
        } catch (err) {
            console.error("Copy failed:", err);
        }
    };

    const handleDownload = (filename) => {
        window.open(`/api/clipboard/${activeKey}/download/${encodeURIComponent(filename)}`, '_blank');
    };

    const handleDelete = async (filename, e) => {
        e.stopPropagation();
        
        try {
            const res = await fetch(`/api/clipboard/${activeKey}/${encodeURIComponent(filename)}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                setFiles(files.filter(f => f.name !== filename));
            } else {
                throw new Error('Failed to delete');
            }
        } catch (err) {
            console.error(err);
            setError('Failed to delete file');
        }
    };

    return (
        <div 
            className={`${isStandalone ? 'w-full h-full' : 'widget-container w-full h-full ' + (widget.config?.color || 'bg-slate-800')} flex flex-col relative overflow-hidden transition-all duration-300 ${isDragging ? 'ring-2 ring-blue-500 bg-blue-900/20' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {isDragging && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
                    <CloudRain size={48} className="text-blue-400 mb-4 animate-bounce" />
                    <p className="text-xl font-bold text-white tracking-widest uppercase">Drop to Upload</p>
                </div>
            )}

            <div className="p-4 flex-1 flex flex-col min-h-0 relative z-10 w-full">
                <div className="mb-4 shrink-0 flex items-center justify-between">
                    <h3 className="widget-title flex items-center gap-2">
                        <Box size={18} className="text-blue-400" />
                        {displayTitle}
                    </h3>
                    <div className="flex items-center gap-2">
                        {!isStandalone && (
                            <button
                                onClick={() => window.open(`/clipboard/${activeKey}`, '_blank')}
                                className="text-slate-500 hover:text-blue-400 p-1.5 rounded transition-colors flex items-center gap-1 text-xs font-bold uppercase tracking-wider"
                                title="Open in Standalone View"
                            >
                                <ExternalLink size={14} />
                            </button>
                        )}
                        {isLocked && (
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="text-slate-500 hover:text-blue-400 p-1.5 rounded transition-colors flex items-center gap-1 text-xs font-bold uppercase tracking-wider"
                                title="Upload File"
                                disabled={isUploading}
                            >
                                {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                <span className="hidden sm:inline">{isUploading ? 'Uploading...' : 'Upload'}</span>
                            </button>
                        )}
                    </div>
                </div>

                <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={onFileChange} 
                    className="hidden" 
                />

                {isUploading && (
                    <div className="shrink-0 mb-3 h-1.5 bg-black/50 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-blue-500 transition-all duration-300 ease-out"
                            style={{ width: `${uploadProgress}%` }}
                        />
                    </div>
                )}

                {error && (
                    <div className="shrink-0 mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2 rounded">
                        {error}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2 pb-2 content-start">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 opacity-50 space-y-3">
                            <Loader2 size={24} className="animate-spin" />
                            <p className="text-sm">Loading Clipboard...</p>
                        </div>
                    ) : files.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 opacity-50 space-y-3 p-4 text-center">
                            <Box size={32} />
                            <p className="text-sm">Clipboard is empty.</p>
                            <p className="text-xs">Drag and drop files here to upload.</p>
                        </div>
                    ) : (
                        <div className="flex flex-col space-y-2">
                            {files.map((file, i) => (
                                <div 
                                    key={i}
                                    className="group/file flex items-start justify-between p-2.5 bg-black/20 border border-white/5 hover:border-blue-500/30 rounded-lg transition-all duration-200"
                                >
                                    <div 
                                        className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer p-1 -m-1 rounded transition-colors"
                                        onClick={(e) => file.isSnippet ? handleCopyFile(file.name, e) : handleDownload(file.name)}
                                        title={file.isSnippet ? 'Copy Text Snippet' : file.name}
                                    >
                                        <div className="mt-0.5 p-2 rounded-md shrink-0 flex items-center justify-center transition-colors bg-blue-500/10 text-blue-400 group-hover/file:bg-blue-500/20 group-hover/file:text-blue-300">
                                            {file.isSnippet ? (
                                                copiedFile === file.name ? <Check size={16} className="text-green-400" /> : <Copy size={16} />
                                            ) : (
                                                <Download size={16} />
                                            )}
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            {file.isSnippet ? (
                                                <>
                                                    <span className="text-sm text-slate-400 break-all font-mono leading-tight pr-2 py-1">
                                                        {file.content}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500 font-medium">
                                                        {formatDate(file.created || file.modified)}
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="text-sm text-slate-400 truncate font-medium">
                                                        {file.name}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-1.5 opacity-80">
                                                        <span>{formatSize(file.size)}</span>
                                                        <span className="opacity-50 text-[8px]">•</span>
                                                        <span className="font-sans font-medium">{formatDate(file.modified || file.created)}</span>
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-2 shrink-0 ml-4 pt-1.5">
                                        <button
                                            onClick={(e) => handleDelete(file.name, e)}
                                            className="p-1.5 text-slate-500 hover:text-red-400 rounded transition-colors"
                                            title="Delete File"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="shrink-0 mt-3 relative">
                    <input
                        type="text"
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleTextUpload(e);
                            }
                        }}
                        placeholder="Paste text..."
                        className="w-full bg-black/20 border border-white/5 focus:border-blue-500/50 rounded-lg py-2 pl-3 pr-10 text-sm text-slate-200 placeholder-slate-500 outline-none transition-colors"
                    />
                    <button
                        type="button"
                        onClick={handleTextUpload}
                        disabled={!textInput.trim() || isUploading}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-blue-400 disabled:opacity-50 disabled:hover:text-slate-400"
                    >
                        {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(ClipboardWidget);
