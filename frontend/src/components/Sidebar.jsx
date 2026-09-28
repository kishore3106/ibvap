import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Video,
  AlertTriangle,
  History,
  Camera,
  MapPin,
  Settings as SettingsIcon,
  Radio,
  Mail,
  Send,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { api } from '../services/api';

export default function Sidebar({ activeTab, setActiveTab, alertCount = 0, onOpenEmailSetup }) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'live', label: 'Live Monitoring', icon: Video },
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle, badge: alertCount },
    { id: 'history', label: 'Event History', icon: History },
    { id: 'cameras', label: 'Cameras', icon: Camera },
    { id: 'zones', label: 'Zones', icon: MapPin },
    { id: 'settings', label: 'Settings', icon: SettingsIcon }
  ];

  const [email, setEmail] = useState(() => localStorage.getItem('ibvap_alert_email') || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusType, setStatusType] = useState('idle');

  useEffect(() => {
    api.getEmailAlertConfig()
      .then((cfg) => {
        if (cfg?.recipient_email) {
          setEmail(cfg.recipient_email);
          localStorage.setItem('ibvap_alert_email', cfg.recipient_email);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveEmail = async (e) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) return;
    setIsSaving(true);
    try {
      await api.saveEmailAlertConfig(cleanEmail);
      setStatusType('success');
      setStatusMsg('Alerts Armed: Email Saved');
      setTimeout(() => setStatusMsg(''), 4000);
    } catch (err) {
      setStatusType('error');
      setStatusMsg('Failed to save config');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDispatchReport = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setStatusType('error');
      setStatusMsg('Enter email address first');
      return;
    }
    setIsSending(true);
    setStatusMsg('');
    try {
      await api.saveEmailAlertConfig(cleanEmail);
      const res = await api.dispatchEmailReport(cleanEmail);
      if (res?.smtp_sent) {
        setStatusType('success');
        setStatusMsg(`Delivered to inbox!`);
      } else {
        setStatusType('success');
        setStatusMsg(`Report Dispatched (Local)`);
      }
      setTimeout(() => setStatusMsg(''), 5000);
    } catch (err) {
      setStatusType('error');
      setStatusMsg('Dispatch error');
      setTimeout(() => setStatusMsg(''), 4000);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <aside className="w-60 bg-[#0d1117] border-r border-slate-800 flex flex-col justify-between py-4 select-none shrink-0 overflow-y-auto">
      <div>
        {/* Navigation Category */}
        <div className="px-4 mb-3">
          <span className="text-[10px] font-mono tracking-widest text-slate-500 uppercase font-semibold">
            TACTICAL NAVIGATION
          </span>
        </div>

        <nav className="space-y-1 px-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-[0_0_8px_rgba(0,240,255,0.15)]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge > 0 && (
                  <span className="px-1.5 py-0.5 text-xs font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 rounded-full animate-pulse">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Dynamic Email Alert Dispatch Bar (Directly below Settings) */}
        <div className="mt-4 mx-2 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 hover:border-cyan-500/40 transition-all shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center space-x-1.5">
              <Mail className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[11px] font-mono font-bold text-slate-200">EMAIL ALERT DISPATCH</span>
            </div>
            {onOpenEmailSetup && (
              <button
                type="button"
                onClick={onOpenEmailSetup}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 font-bold transition-colors"
                title="Configure Live SMTP & Verification"
              >
                SETUP
              </button>
            )}
          </div>

          <div className="text-[10px] text-slate-400 font-mono mb-2 leading-tight">
            Send breach report & snapshot to email
          </div>

          <form onSubmit={handleSaveEmail} className="space-y-1.5">
            <div className="relative">
              <input
                type="email"
                placeholder="operator@defense.gov"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  localStorage.setItem('ibvap_alert_email', e.target.value);
                }}
                onBlur={() => {
                  if (email.trim()) api.saveEmailAlertConfig(email.trim());
                }}
                className="w-full bg-black/80 border border-slate-700 focus:border-cyan-400 rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder-slate-600 outline-none transition-all pr-6"
              />
              {email.trim() && (
                <button
                  type="submit"
                  disabled={isSaving}
                  title="Save Email"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-cyan-400 hover:text-cyan-300 text-xs font-bold"
                >
                  ✓
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleDispatchReport}
              disabled={isSending || !email.trim()}
              className={`w-full flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded text-[10px] font-mono font-bold tracking-wide transition-all ${
                !email.trim()
                  ? 'bg-slate-800/40 text-slate-600 cursor-not-allowed border border-slate-800'
                  : isSending
                  ? 'bg-amber-950/70 text-amber-300 border border-amber-500/40 animate-pulse'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-[0_0_12px_rgba(0,240,255,0.25)] border border-cyan-400/40'
              }`}
            >
              {isSending ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-amber-300" />
                  <span>DISPATCHING...</span>
                </>
              ) : (
                <>
                  <Send className="w-3 h-3" />
                  <span>DISPATCH ALERT & SNAPSHOT</span>
                </>
              )}
            </button>
          </form>

          {statusMsg && (
            <div
              className={`mt-2 text-[10px] font-mono flex items-center space-x-1 px-2 py-1 rounded transition-all ${
                statusType === 'success'
                  ? 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-950/80 border border-rose-500/50 text-rose-300'
              }`}
            >
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              <span className="truncate">{statusMsg}</span>
            </div>
          )}
        </div>
      </div>

      {/* Mission Footer */}
      <div className="px-4 pt-4 border-t border-slate-800/80">
        <div className="flex items-center space-x-2 text-slate-400 mb-2">
          <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="text-[11px] font-mono tracking-wide text-slate-300">SURVEILLANCE ACTIVE</span>
        </div>
        <div className="text-[10px] text-slate-500 font-mono leading-relaxed">
          SECURE PERIMETER MONITORING<br />
          EDGE NODE: 01-ONLINE
        </div>
      </div>
    </aside>
  );
}
