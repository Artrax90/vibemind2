import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Database, Link, Server, Save } from 'lucide-react';

interface AddDBModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (db: { db_type: string; display_name: string; connection_string: string }) => void;
}

export default function AddDBModal({ isOpen, onClose, onConnect }: AddDBModalProps) {
  const [dbType, setDbType] = useState('postgresql');
  const [displayName, setDisplayName] = useState('');
  const [connectionString, setConnectionString] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect({ db_type: dbType, display_name: displayName, connection_string: connectionString });
    setDisplayName('');
    setConnectionString('');
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-lg bg-background border border-border/50 rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Database className="text-primary w-5 h-5" />
              <h3 className="text-lg font-bold text-foreground tracking-tight">Connect External Database</h3>
            </div>
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Database Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDbType('postgresql')}
                    className={`flex items-center justify-center px-4 py-3 rounded-xl border transition-all ${dbType === 'postgresql' ? 'bg-primary/10 border-primary text-primary' : 'bg-secondary/50 border-border/50 text-muted-foreground hover:border-primary/50'}`}
                  >
                    <Server className="w-4 h-4 mr-2" />
                    PostgreSQL
                  </button>
                  <button
                    type="button"
                    onClick={() => setDbType('mongodb')}
                    className={`flex items-center justify-center px-4 py-3 rounded-xl border transition-all ${dbType === 'mongodb' ? 'bg-primary/10 border-primary text-primary' : 'bg-secondary/50 border-border/50 text-muted-foreground hover:border-primary/50'}`}
                  >
                    <Database className="w-4 h-4 mr-2" />
                    MongoDB
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g., Work DB, Production Analytics"
                  className="w-full bg-secondary/50 border border-border/50 rounded-xl p-3 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Connection String</label>
                <div className="relative group">
                  <div className="absolute top-3 left-3 pointer-events-none">
                    <Link className="w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  </div>
                  <textarea
                    value={connectionString}
                    onChange={(e) => setConnectionString(e.target.value)}
                    placeholder={dbType === 'postgresql' ? 'postgresql://user:pass@host:5432/db' : 'mongodb://user:pass@host:27017/db'}
                    className="w-full bg-secondary/50 border border-border/50 rounded-xl p-3 pl-10 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all min-h-[100px] font-mono text-sm"
                    required
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-2 font-mono">
                  PRO TIP: Ensure your database allows connections from this server's IP.
                </p>
              </div>
            </div>

            <div className="pt-4 flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-secondary text-foreground font-medium rounded-xl border border-border/50 hover:bg-secondary/80 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-[0_0_20px_rgba(var(--primary-rgb),0.3)] hover:shadow-[0_0_30px_rgba(var(--primary-rgb),0.5)] transition-all flex items-center justify-center"
              >
                <Save className="w-4 h-4 mr-2" />
                Connect DB
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
