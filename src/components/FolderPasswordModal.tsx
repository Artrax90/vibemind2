import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

type FolderPasswordModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (password: string, oldPassword?: string) => Promise<boolean>;
  mode: 'set' | 'verify' | 'change';
  folderName: string;
};

export default function FolderPasswordModal({ isOpen, onClose, onConfirm, mode, folderName }: FolderPasswordModalProps) {
  const { t } = useLanguage();
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'change' && !oldPassword) {
      setError(t('folder.oldPasswordRequired') || 'Old password is required');
      return;
    }
    if (!password) {
      setError(t('folder.passwordRequired') || 'Password is required');
      return;
    }

    if ((mode === 'set' || mode === 'change') && password !== confirmPassword) {
      setError(t('folder.passwordsMismatch') || 'Passwords do not match');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const success = await onConfirm(password, oldPassword);
      if (success) {
        onClose();
        setOldPassword('');
        setPassword('');
        setConfirmPassword('');
      } else {
        setError(mode === 'verify' || mode === 'change' ? (t('folder.wrongPassword') || 'Wrong password') : (t('folder.setupError') || 'Failed to set password'));
      }
    } catch (e) {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (mode === 'change' && !oldPassword) {
      setError(t('folder.oldPasswordRequired') || 'Old password is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const success = await onConfirm('', oldPassword);
      if (success) {
        onClose();
        setOldPassword('');
        setPassword('');
        setConfirmPassword('');
      } else {
        setError(mode === 'change' ? (t('folder.wrongPassword') || 'Wrong password') : 'Failed to remove password');
      }
    } catch (e) {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-sm border border-border/50 rounded-xl shadow-2xl overflow-hidden bg-background flex flex-col"
      >
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-primary" />
            <h2 className="text-lg font-semibold text-foreground">
              {mode === 'set' ? t('folder.setPassword') || 'Set Folder Password' : t('folder.enterPassword') || 'Enter Password'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-center mb-2">
            <p className="text-sm text-muted-foreground">
              {mode === 'set' 
                ? (t('folder.setDesc') || `Protect folder "${folderName}" with a password.`)
                : (mode === 'change' ? (t('folder.changeDesc') || `Change password for "${folderName}".`) : (t('folder.verifyDesc') || `Folder "${folderName}" is protected.`))}
            </p>
          </div>

          <div className="space-y-4">
            {mode === 'change' && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('folder.oldPassword') || 'Old Password'}
                </label>
                <input
                  autoFocus
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full bg-secondary/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  placeholder="••••••••"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {mode === 'change' ? (t('settings.newPassword') || 'New Password') : (t('folder.password') || 'Password')}
              </label>
              <input
                autoFocus={mode !== 'change'}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-secondary/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                placeholder="••••••••"
              />
            </div>

            {(mode === 'set' || mode === 'change') && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('folder.confirmPassword') || 'Confirm Password'}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-secondary/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  placeholder="••••••••"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded">
              <ShieldAlert size={14} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ShieldCheck size={16} className="mr-2" />
            )}
            {mode === 'set' ? (t('folder.confirmSet') || 'Set Password') : (mode === 'change' ? (t('folder.confirmChange') || 'Change Password') : (t('folder.unlock') || 'Unlock'))}
          </button>
          
          {(mode === 'set' || mode === 'change') && (
             <button
              type="button"
              onClick={mode === 'change' ? handleRemove : () => onConfirm('')}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors mt-2"
            >
              {t('folder.removePassword') || 'Remove Password'}
            </button>
          )}
        </form>
      </motion.div>
    </div>
  );
}
