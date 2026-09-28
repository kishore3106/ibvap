import React, { useState, useEffect, useRef } from 'react';
import { Camera, RefreshCw, Smartphone, Video, FileVideo, Maximize2, ShieldAlert } from 'lucide-react';
import { api, getBackendBase } from '../services/api';

export default function LiveFeed({ liveStats, currentCamera, zones = [], onSourceChanged }) {
  const [streamError, setStreamError] = useState(false);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [customSource, setCustomSource] = useState('');
  const [isSwitching, setIsSwitching] = useState(false);
  const [streamKey, setStreamKey] = useState(Date.now());
  const [useSnapshotMode, setUseSnapshotMode] = useState(false);
  const [snapTick, setSnapTick] = useState(Date.now());
  const [hasLoaded, setHasLoaded] = useState(false);

  const handleFrameLoad = () => {
    setHasLoaded(true);
    setStreamError(false);
    if (useSnapshotMode) {
      // Progressively request next frame only after current frame finishes rendering
      setTimeout(() => {
        setSnapTick(Date.now());
      }, 40);
    }
  };

  const handleFrameError = () => {
    if (!useSnapshotMode) {
      console.warn('[LiveFeed] MJPEG stream error. Failing over to snapshot mode.');
      setUseSnapshotMode(true);
    } else {
      // Retry snapshot after brief pause
      setTimeout(() => {
        setSnapTick(Date.now());
      }, 400);
    }
  };

  // If MJPEG stream doesn't fire within 3.5 seconds, auto-switch to snapshot mode
  useEffect(() => {
    if (useSnapshotMode || hasLoaded) return;
    const stallTimer = setTimeout(() => {
      if (!hasLoaded) {
        console.warn('[LiveFeed] Initial stream stalled. Switching to snapshot engine.');
        setUseSnapshotMode(true);
      }
    }, 3500);
    return () => clearTimeout(stallTimer);
  }, [useSnapshotMode, hasLoaded, streamKey]);

  const streamUrl = useSnapshotMode
    ? `${getBackendBase()}/api/v1/stream/snapshot?t=${snapTick}`
    : `${getBackendBase()}/api/v1/stream/video_feed?t=${streamKey}`;

  const handleReconnect = () => {
    setStreamError(false);
    setHasLoaded(false);
    setStreamKey(Date.now());
    setSnapTick(Date.now());
  };

  const handleSwitchSource = async (newSource) => {
    if (!newSource) return;
    const cleanSource = String(newSource).trim().replace(/^["']|["']$/g, '');
    if (!cleanSource) return;
    setIsSwitching(true);
    setStreamError(false);
    try {
      await api.switchCameraSource(currentCamera?.camera_id || 'CAM-01', cleanSource);
      if (onSourceChanged) onSourceChanged(cleanSource);
      setShowSwitchModal(false);
      handleReconnect();
    } catch (e) {
      console.error('Failed to switch source:', e);
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <div className="bg-[#0d1117] border border-slate-800 rounded flex flex-col h-full relative overflow-hidden">
      {/* Feed Tactical Header */}
      <div className="h-10 bg-slate-900/90 border-b border-slate-800 px-4 flex items-center justify-between z-10">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span className="text-[10px] font-mono font-bold text-rose-400 tracking-wider">LIVE FEED</span>
          </div>
          <span className="text-slate-600 font-mono">|</span>
          <span className="text-xs font-mono text-slate-300 font-semibold">
            {currentCamera?.camera_id || 'CAM-01'} — {currentCamera?.name || 'North Border Sector'}
          </span>
          <span className={`px-1.5 py-0.5 text-[10px] font-mono uppercase rounded border ${
            liveStats?.source_type === 'file'
              ? 'bg-amber-950/80 text-amber-300 border-amber-500/50 font-bold'
              : 'bg-slate-800 text-cyan-400 border-slate-700'
          }`}>
            {liveStats?.source_type === 'file' ? 'DEMO CCTV VIDEO' : (liveStats?.source_type || 'STREAM')}
          </span>
          {zones && zones.length > 0 ? (
            <span className="px-2 py-0.5 text-[10px] font-mono bg-rose-950/70 border border-rose-500/50 rounded text-rose-300 flex items-center space-x-1.5 max-w-[280px] sm:max-w-none truncate" title={zones.map(z => z.name).join(' | ')}>
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse shrink-0" />
              <span className="font-bold truncate">ACTIVE: {zones.map(z => z.name).join(' | ')}</span>
            </span>
          ) : (
            <span className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-mono text-slate-500 border border-slate-800 rounded">
              NO ZONE SET
            </span>
          )}

        </div>

        <div className="flex items-center space-x-2">
          {/* Stream Mode Toggle (MJPEG / High-Speed Snapshot) */}
          <button
            onClick={() => {
              setUseSnapshotMode(prev => !prev);
              handleReconnect();
            }}
            className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors ${
              useSnapshotMode
                ? 'bg-amber-950/70 text-amber-300 border-amber-500/50 font-bold'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title="Toggle between MJPEG Stream and Snapshot Polling Mode (Use if browser connection is congested)"
          >
            {useSnapshotMode ? 'MODE: SNAPSHOTS' : 'MODE: MJPEG'}
          </button>

          {/* Reconnect / Refresh button */}
          <button
            onClick={handleReconnect}
            className="p-1 px-2 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 rounded transition-colors"
            title="Refresh stream connection"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Switch Source Button */}
          <button
            onClick={() => setShowSwitchModal(true)}
            className="flex items-center space-x-1 px-2.5 py-1 text-xs font-mono bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-400 border border-cyan-500/40 rounded transition-colors"
            title="Switch between Smartphone RTSP, Webcam, or Demo Video"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>CHANGE SOURCE</span>
          </button>
        </div>
      </div>

      {/* Video Stream Canvas */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-[360px]">
        {streamError ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <ShieldAlert className="w-12 h-12 text-rose-500 mb-3 animate-pulse" />
            <span className="text-sm font-mono font-bold text-rose-400 mb-1">STREAM CONGESTED / OFFLINE</span>
            <p className="text-xs text-slate-500 max-w-sm mb-4">
              Browser connection was interrupted or blocked by multiple open tabs.
            </p>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleReconnect}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-black font-bold text-xs font-mono rounded"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>RECONNECT STREAM</span>
              </button>
              <button
                onClick={() => {
                  setUseSnapshotMode(true);
                  handleReconnect();
                }}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-mono rounded border border-slate-700"
              >
                <span>SWITCH TO SNAPSHOT MODE</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="relative w-full h-full flex items-center justify-center select-none">
            <img
              key={useSnapshotMode ? 'snapshot-feed' : `mjpeg-${streamKey}`}
              src={streamUrl}
              alt="IBVAP Real-time Surveillance Stream"
              onLoad={handleFrameLoad}
              onError={handleFrameError}
              className="w-full h-full object-contain"
            />
          </div>
        )}

        {/* Tactical Corner HUD Overlays */}
        <div className="absolute top-3 left-3 pointer-events-none flex flex-col space-y-1">
          <div className="bg-black/60 backdrop-blur-sm border border-slate-800 px-2 py-1 rounded text-[10px] font-mono text-slate-300">
            FPS: <span className="text-cyan-400 font-bold">{liveStats?.fps || 0}</span>
          </div>
          {useSnapshotMode && (
            <div className="bg-amber-950/80 border border-amber-500/50 px-2 py-0.5 rounded text-[9px] font-mono text-amber-300 font-bold">
              ZERO-BLOCK SNAPSHOT ENGINE
            </div>
          )}
        </div>

        <div className="absolute top-3 right-3 pointer-events-none">
          <div className="bg-black/60 backdrop-blur-sm border border-slate-800 px-2 py-1 rounded text-[10px] font-mono text-emerald-400 flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>AI ANALYTICS ENGAGED</span>
          </div>
        </div>
      </div>

      {/* Camera Switcher Modal */}
      {showSwitchModal && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0d1117] border border-cyan-500/40 rounded-lg p-6 max-w-md w-full shadow-[0_0_24px_rgba(0,240,255,0.2)]">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
              <div className="flex items-center space-x-2">
                <Camera className="w-5 h-5 text-cyan-400" />
                <h3 className="font-mono font-bold text-white text-sm">SELECT CAMERA INPUT SOURCE</h3>
              </div>
              <button
                onClick={() => setShowSwitchModal(false)}
                className="text-slate-500 hover:text-white font-mono text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Select one of the quick presets or enter a custom RTSP / HTTP URL from your smartphone.
            </p>

            {/* Quick Presets */}
            <div className="space-y-2 mb-5">
              <button
                onClick={() => handleSwitchSource('data/demo_videos/sample_border.mp4')}
                disabled={isSwitching}
                className="w-full flex items-center justify-between p-3 rounded bg-slate-900/90 hover:bg-cyan-950/40 border border-slate-800 hover:border-cyan-500/40 text-left transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <FileVideo className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="text-xs font-mono font-bold text-white">Demo Video (Continuous CCTV Loop)</div>
                    <div className="text-[11px] text-slate-400">Pre-recorded border surveillance clip with person & vehicle</div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleSwitchSource('0')}
                disabled={isSwitching}
                className="w-full flex items-center justify-between p-3 rounded bg-slate-900/90 hover:bg-cyan-950/40 border border-slate-800 hover:border-cyan-500/40 text-left transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <Video className="w-4 h-4 text-amber-400" />
                  <div>
                    <div className="text-xs font-mono font-bold text-white">Laptop Built-in Webcam (Source 0)</div>
                    <div className="text-[11px] text-slate-400">Direct camera input for local physical testing</div>
                  </div>
                </div>
              </button>
            </div>

            {/* Custom Smartphone RTSP Input */}
            <div className="border-t border-slate-800 pt-4">
              <label className="block text-xs font-mono text-slate-300 mb-1.5 flex items-center space-x-1.5">
                <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
                <span>Smartphone IP Webcam / RTSP URL:</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 192.168.1.50:8080 or http://192.168.1.50:8080/video"
                value={customSource}
                onChange={(e) => setCustomSource(e.target.value)}
                className="w-full bg-black/60 border border-slate-700 rounded px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 mb-1.5"
              />
              <p className="text-[10px] text-slate-400 font-mono mb-3">
                📱 Tip: In Android &quot;IP Webcam&quot; app, use <span className="text-cyan-400">http://&lt;phone-ip&gt;:8080/video</span>. Both devices must be on the same Wi-Fi.
              </p>
              <button
                onClick={() => handleSwitchSource(customSource)}
                disabled={isSwitching || !customSource.trim()}
                className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-mono font-bold text-xs rounded transition-colors cursor-pointer"
              >
                {isSwitching ? 'CONNECTING...' : 'APPLY SMARTPHONE STREAM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
