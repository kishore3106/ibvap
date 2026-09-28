import React, { useState, useEffect } from 'react';
import {
  Mail,
  Shield,
  Key,
  Server,
  Send,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  ExternalLink,
  Info,
  Check
} from 'lucide-react';
import { api } from '../services/api';

export default function EmailSetupModal({ isOpen, onClose, onConfigSaved }) {
  const [recipientEmail, setRecipientEmail] = useState(() => localStorage.getItem('ibvap_alert_email') || 'kishore3106avenger@gmail.com');
  const [deliveryMode, setDeliveryMode] = useState('smtp'); // 'smtp' or 'local'
  const [smtpProvider, setSmtpProvider] = useState('gmail');
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [autoDispatch, setAutoDispatch] = useState(true);

  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState(null); // { success: boolean, message: string }

  // Load existing config on mount
  useEffect(() => {
    if (isOpen) {
      api.getEmailAlertConfig()
        .then((cfg) => {
          if (cfg) {
            if (cfg.recipient_email) {
              setRecipientEmail(cfg.recipient_email);
              setSmtpUser(cfg.smtp_user || cfg.recipient_email);
            }
            if (cfg.smtp_host) setSmtpHost(cfg.smtp_host);
            if (cfg.smtp_port) setSmtpPort(cfg.smtp_port);
            if (cfg.smtp_password) setSmtpPassword(cfg.smtp_password);
            if (cfg.smtp_host || cfg.smtp_password) {
              setDeliveryMode('smtp');
            }
            setAutoDispatch(cfg.enabled ?? true);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Sync provider presets
  const handleProviderChange = (provider) => {
    setSmtpProvider(provider);
    if (provider === 'gmail') {
      setSmtpHost('smtp.gmail.com');
      setSmtpPort(587);
    } else if (provider === 'outlook') {
      setSmtpHost('smtp-mail.outlook.com');
      setSmtpPort(587);
    } else if (provider === 'yahoo') {
      setSmtpHost('smtp.mail.yahoo.com');
      setSmtpPort(587);
    }
  };

  const handleTestConnection = async () => {
    const cleanEmail = recipientEmail.trim();
    if (!cleanEmail) {
      setTestResult({ success: false, message: 'Please enter a recipient email address.' });
      return;
    }
    if (!smtpPassword.trim()) {
      setTestResult({
        success: false,
        message: 'Google App Password / SMTP password is required to send real emails to your inbox.'
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const payload = {
        recipient_email: cleanEmail,
        smtp_host: smtpHost.trim(),
        smtp_port: Number(smtpPort) || 587,
        smtp_user: (smtpUser.trim() || cleanEmail),
        smtp_password: smtpPassword.trim()
      };
      const res = await api.testEmailConnection(payload);
      if (res?.success) {
        setTestResult({ success: true, message: res.message || 'Verification email successfully delivered to your inbox!' });
        localStorage.setItem('ibvap_alert_email', cleanEmail);
        if (onConfigSaved) onConfigSaved(cleanEmail);
      } else {
        setTestResult({ success: false, message: res?.error || 'SMTP verification failed.' });
      }
    } catch (err) {
      setTestResult({ success: false, message: `Error testing connection: ${err.message}` });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAndArm = async () => {
    const cleanEmail = recipientEmail.trim();
    if (!cleanEmail) {
      setTestResult({ success: false, message: 'Recipient email is required.' });
      return;
    }

    setIsSaving(true);
    setTestResult(null);

    try {
      const configPayload = {
        recipient_email: cleanEmail,
        enabled: autoDispatch,
        smtp_host: deliveryMode === 'smtp' ? smtpHost.trim() : '',
        smtp_port: deliveryMode === 'smtp' ? Number(smtpPort) || 587 : 587,
        smtp_user: deliveryMode === 'smtp' ? (smtpUser.trim() || cleanEmail) : '',
        smtp_password: deliveryMode === 'smtp' ? smtpPassword.trim() : '',
        smtp_from: deliveryMode === 'smtp' ? (smtpUser.trim() || cleanEmail) : 'ibvap-alerts@defense.gov'
      };

      await api.saveEmailAlertConfig(configPayload);
      localStorage.setItem('ibvap_alert_email', cleanEmail);
      localStorage.setItem('ibvap_email_setup_dismissed', 'true');

      if (onConfigSaved) onConfigSaved(cleanEmail);
      onClose();
    } catch (err) {
      setTestResult({ success: false, message: 'Failed to save configuration.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-[#0b0f17] border border-cyan-500/50 rounded-xl p-6 max-w-lg w-full shadow-[0_0_35px_rgba(0,240,255,0.25)] flex flex-col space-y-4 max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded bg-cyan-950/80 border border-cyan-500/50 text-cyan-400">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-mono font-bold text-white text-sm tracking-wider">
                AUTOMATED ALERT DISPATCH SETUP
              </h3>
              <p className="text-[11px] font-mono text-slate-400">
                Configure operator email for instant breach snapshots & telemetry.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white font-mono text-sm p-1 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Recipient Email Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono font-bold text-slate-200 flex items-center space-x-1.5">
            <Shield className="w-3.5 h-3.5 text-cyan-400" />
            <span>ALERT RECIPIENT EMAIL ADDRESS</span>
          </label>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => {
              setRecipientEmail(e.target.value);
              if (!smtpUser || smtpUser === recipientEmail) {
                setSmtpUser(e.target.value);
              }
            }}
            placeholder="e.g. kishore3106avenger@gmail.com"
            className="w-full bg-slate-900 border border-slate-700 focus:border-cyan-400 rounded px-3 py-2 text-xs font-mono text-white placeholder-slate-600 outline-none transition-all shadow-inner"
          />
          <div className="text-[10px] font-mono text-slate-400">
            Every breach alert (zone intrusion / vehicle tracking) will be addressed to this inbox.
          </div>
        </div>

        {/* Delivery Mode Selector */}
        <div className="space-y-1.5 pt-1">
          <label className="text-xs font-mono font-bold text-slate-200">
            TRANSMISSION GATEWAY
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDeliveryMode('smtp')}
              className={`p-2.5 rounded-lg border text-left font-mono transition-all ${
                deliveryMode === 'smtp'
                  ? 'bg-cyan-950/70 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center space-x-1.5 text-xs font-bold mb-0.5">
                <Server className="w-3.5 h-3.5" />
                <span>Live Inbox Delivery</span>
              </div>
              <div className="text-[10px] text-slate-400 leading-tight">
                Sends real email directly to Gmail / external inbox via SMTP.
              </div>
            </button>

            <button
              type="button"
              onClick={() => setDeliveryMode('local')}
              className={`p-2.5 rounded-lg border text-left font-mono transition-all ${
                deliveryMode === 'local'
                  ? 'bg-cyan-950/70 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center space-x-1.5 text-xs font-bold mb-0.5">
                <Shield className="w-3.5 h-3.5" />
                <span>Local Report Archive</span>
              </div>
              <div className="text-[10px] text-slate-400 leading-tight">
                Generates full HTML + snapshots saved to disk (zero password required).
              </div>
            </button>
          </div>
        </div>

        {/* SMTP Configuration Form (When Live Inbox is selected) */}
        {deliveryMode === 'smtp' && (
          <div className="p-3.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-3 font-mono">
            {/* Provider presets */}
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400">Provider:</span>
              {['gmail', 'outlook', 'custom'].map((prov) => (
                <button
                  key={prov}
                  type="button"
                  onClick={() => handleProviderChange(prov)}
                  className={`px-2 py-0.5 rounded text-[11px] uppercase font-bold border transition-colors ${
                    smtpProvider === prov
                      ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
                      : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                  }`}
                >
                  {prov}
                </button>
              ))}
            </div>

            {/* Explanatory Banner for Gmail App Password */}
            <div className="p-2.5 rounded bg-blue-950/40 border border-blue-500/30 text-blue-200 text-[11px] leading-relaxed flex items-start space-x-2">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-cyan-300">Why an App Password is needed:</strong><br />
                Google blocks basic passwords for security. To deliver real emails to your Gmail inbox, generate a free 16-character <strong>App Password</strong> in your Google Account:
                <div className="mt-1 font-sans text-slate-300 text-[10px]">
                  1. Visit <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-cyan-400 underline font-mono inline-flex items-center space-x-0.5"><span>myaccount.google.com/apppasswords</span> <ExternalLink className="w-2.5 h-2.5 inline" /></a><br />
                  2. Select app name (e.g. <em>IBVAP Surveillance</em>) and click Generate.<br />
                  3. Paste the 16-letter code below.
                </div>
              </div>
            </div>

            {/* SMTP Inputs */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 text-[11px]">SMTP Host</label>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-xs outline-none"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1 text-[11px]">Port</label>
                <input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-xs outline-none"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <label className="text-slate-400 block text-[11px]">Sender Email / Account</label>
              <input
                type="email"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="e.g. kishore3106avenger@gmail.com"
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-white text-xs outline-none"
              />
            </div>

            <div className="space-y-1 text-xs">
              <label className="text-slate-400 block text-[11px] flex items-center justify-between">
                <span>Google App Password (16 characters)</span>
                <span className="text-[10px] text-cyan-400">Required for Live Gmail Delivery</span>
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder="abcd efgh ijkl mnop"
                  className="w-full bg-slate-900 border border-slate-700 focus:border-cyan-400 rounded px-2.5 py-1.5 text-white text-xs font-mono outline-none tracking-widest"
                />
              </div>
            </div>

            {/* Test Connection Button */}
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || !recipientEmail || !smtpPassword}
              className={`w-full flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded text-xs font-bold border transition-colors ${
                !smtpPassword
                  ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                  : isTesting
                  ? 'bg-amber-950/70 text-amber-300 border-amber-500/50 animate-pulse'
                  : 'bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 border-cyan-500/40 hover:border-cyan-400'
              }`}
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>TRANSMITTING TEST VERIFICATION EMAIL...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>TEST CONNECTION & SEND VERIFICATION EMAIL</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Automated Dispatch Checkbox */}
        <div className="flex items-center space-x-2.5 p-2 rounded bg-slate-900/60 border border-slate-800">
          <input
            type="checkbox"
            id="autoDispatchCheck"
            checked={autoDispatch}
            onChange={(e) => setAutoDispatch(e.target.checked)}
            className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
          />
          <label htmlFor="autoDispatchCheck" className="text-xs font-mono text-slate-300 cursor-pointer select-none">
            <strong>Automated Breach Dispatch:</strong> Transmit email immediately whenever a person or vehicle breaches a zone.
          </label>
        </div>

        {/* Test Result Message */}
        {testResult && (
          <div
            className={`p-3 rounded text-xs font-mono flex items-start space-x-2 ${
              testResult.success
                ? 'bg-emerald-950/90 border border-emerald-500/60 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                : 'bg-rose-950/90 border border-rose-500/60 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="leading-snug">{testResult.message}</div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-mono text-slate-400 hover:text-white transition-colors"
          >
            DISMISS
          </button>
          <button
            type="button"
            onClick={handleSaveAndArm}
            disabled={isSaving || !recipientEmail.trim()}
            className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-mono font-bold text-xs rounded transition-all shadow-[0_0_15px_rgba(0,240,255,0.3)]"
          >
            <Check className="w-4 h-4" />
            <span>SAVE & ARM AUTOMATED ALERTS</span>
          </button>
        </div>
      </div>
    </div>
  );
}
