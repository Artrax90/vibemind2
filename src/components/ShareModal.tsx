import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Loader2, Trash2 } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

type ShareEntry = {
  id: string;
  target_username: string;
  permission: 'read' | 'write';
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
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && resourceId) {
      setLoading(true);
      // Mock loading shares
      setTimeout(() => {
        setShares([
          { id: '1', target_username: 'alex_cyber', permission: 'read' }
        ]);
        setLoading(false);
      }, 500);
    }
  }, [isOpen, resourceId]);

  const handleShare = () => {
    if (!username.trim()) return;
    const newShare: ShareEntry = {
      id: Date.now().toString(),
      target_username: username,
      permission
    };
    setShares([...shares, newShare]);
    setUsername('');
  };

  const handleDeleteShare = (id: string) => {
    setShares(shares.filter(s => s.id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg border border-border/50 rounded-xl shadow-2xl overflow-hidden bg-background glass-strong flex flex-col"
      >
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {resourceType === 'folder' ? 'Share folder' : 'Share note'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Add a user by username and grant the required access.
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

          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="space-y-2 flex-1 w-full">
              <label className="text-sm font-medium text-foreground">Target username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              />
            </div>
            <div className="space-y-2 w-full sm:w-32">
              <label className="text-sm font-medium text-foreground">Access</label>
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all appearance-none"
              >
                <option value="read">Read</option>
                <option value="write">Write</option>
              </select>
            </div>
            <button
              onClick={handleShare}
              disabled={!username.trim()}
              className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed glow-primary h-[38px]"
            >
              <UserPlus size={16} className="mr-2" />
              Grant
            </button>
          </div>

          <div className="h-px bg-border/50 w-full" />

          <div className="space-y-2">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading shares...
              </div>
            ) : shares.length === 0 ? (
              <div className="text-sm text-muted-foreground">No shares exist for this resource yet.</div>
            ) : (
              shares.map((share) => (
                <div key={share.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{share.target_username}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground capitalize">{share.permission}</span>
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
