import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type CreateUserModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (user: any) => void;
  initialData?: any;
};

export default function CreateUserModal({ isOpen, onClose, onCreate, initialData }: CreateUserModalProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('User');

  useEffect(() => {
    if (initialData) {
      setUsername(initialData.username || '');
      setEmail(initialData.email || '');
      setPassword(''); // Don't show existing password
      setRole(initialData.role || 'User');
    } else {
      setUsername('');
      setEmail('');
      setPassword('');
      setRole('User');
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username && email && (password || initialData)) {
      onCreate({ username, email, password, role });
      setUsername(''); setEmail(''); setPassword(''); setRole('User');
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md bg-card border border-border/50 rounded-xl shadow-2xl overflow-hidden glass-strong"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
              <h3 className="text-lg font-semibold text-foreground">{initialData ? 'Edit User' : 'Add New User'}</h3>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Username</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" required />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" required />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Password {initialData && '(Leave blank to keep current)'}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" required={!initialData} />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Role</label>
                <select value={role} onChange={e => setRole(e.target.value)} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all">
                  <option value="User">User</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={onClose} className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors glow-primary">{initialData ? 'Save Changes' : 'Add User'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
