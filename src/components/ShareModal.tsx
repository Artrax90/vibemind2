import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Loader2, Trash2, Globe, Link as LinkIcon, Copy, Check } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { api } from '../api/client';

type ShareEntry = {
  id: string;
  target_username: string | null;
  permission: 'read' | 'write';
  is_public: number;
};

type ShareModalProps = {
  isOpen: boolean;
  onClose: () => void;
  resourceId: string | null;
  resourceType: 'note' | 'folder' | null;
  resourceName: string | null;
};

export default function ShareModal({ isOpen, onClose, resourceId, resourceType, resourceName }: ShareModalProps) {
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [isPublic, setIsPublic] = useState(false);
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && resourceId && resourceType) {
      loadShares();
    }
  }, [isOpen, resourceId, resourceType]);

  const loadShares = async () => {
    if (!resourceId || !resourceType) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.getShares(resourceType, resourceId);
      setShares(data);
    } catch (e) {
      console.error('Failed to load shares', e);
      setError('Failed to load shares');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (!isPublic && !username.trim()) return;
    if (!resourceId || !resourceType) return;
    
    setError('');
    try {
      const newShare = await api.createShare(resourceType, resourceId, {
        target_username: isPublic ? null : username,
        permission,
        is_public: isPublic ? 1 : 0
      });
      if (newShare) {
        setShares([...shares, newShare]);
        setUsername('');
        if (isPublic) {
          copyLink(newShare.id);
        }
      }
    } catch (e: any) {
      console.error('Failed to create share', e);
      setError(e.message || 'Failed to create share');
    }
  };

  const handleDeleteShare = async (id: string) => {
    try {
      await api.deleteShare(id);
      setShares(shares.filter(s => s.id !== id));
    } catch (e) {
      console.error('Failed to delete share', e);
    }
  };

  const copyLink = async (shareId: string) => {
    const url = `${window.location.origin}/shared/${shareId}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for non-secure contexts or older browsers
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setCopiedId(shareId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy link', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg border border-border/50 rounded-xl shadow-2xl overflow-hidden bg-background flex flex-col"
      >
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {resourceType === 'folder' ? t('share.titleFolder') : t('share.titleNote')}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('share.description')}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground font-mono">
            {resourceName || resourceId}
          </div>

          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="radio" 
                checked={!isPublic} 
                onChange={() => setIsPublic(false)}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">{t('share.specificUser')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="radio" 
                checked={isPublic} 
                onChange={() => setIsPublic(true)}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">{t('share.publicLink')}</span>
            </label>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-end">
            {!isPublic && (
              <div className="space-y-2 flex-1 w-full">
                <label className="text-sm font-medium text-foreground">{t('share.targetUsername')}</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('share.usernamePlaceholder')}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
              </div>
            )}
            <div className="space-y-2 w-full sm:w-32">
              <label className="text-sm font-medium text-foreground">{t('share.access')}</label>
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all appearance-none"
              >
                <option value="read">{t('share.read')}</option>
                <option value="write">{t('share.write')}</option>
              </select>
            </div>
            <button
              onClick={handleShare}
              disabled={!isPublic && !username.trim()}
              className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-[38px]"
            >
              {isPublic ? <Globe size={16} className="mr-2" /> : <UserPlus size={16} className="mr-2" />}
              {isPublic ? t('share.createLink') : t('share.grant')}
            </button>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}

          <div className="h-px bg-border/50 w-full" />

          <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('share.loading')}
              </div>
            ) : shares.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('share.noShares')}</div>
            ) : (
              shares.map((share) => (
                <div key={share.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {share.is_public ? (
                        <Globe size={16} className="text-primary" />
                      ) : (
                        <UserPlus size={16} className="text-muted-foreground" />
                      )}
                      <div className="text-sm font-medium text-foreground truncate">
                        {share.is_public ? t('share.publicLink') : share.target_username}
                      </div>
                    </div>
                    {share.is_public === 1 && (
                      <div className="text-[10px] text-muted-foreground truncate mt-1 select-all">
                        {`${window.location.origin}/shared/${share.id}`}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground capitalize">
                      {share.permission === 'read' ? t('share.read') : t('share.write')}
                    </span>
                    {share.is_public === 1 && (
                      <button
                        onClick={() => copyLink(share.id)}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
                        title={t('share.copyLink')}
                      >
                        {copiedId === share.id ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteShare(share.id)}
                      className="p-1.5 text-destructive hover:bg-destructive/10 rounded transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
