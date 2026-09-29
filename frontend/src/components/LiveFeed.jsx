import React, { useState, useEffect, useRef } from 'react';
import { Camera, RefreshCw, Smartphone, Video, FileVideo, ShieldAlert, CheckCircle2 } from 'lucide-react';
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

  // Active Mode: 'demo' | 'webcam' | 'stream'
  const [activeMode, setActiveMode] = useState(() => {
    return localStorage.getItem('ibvap_feed_mode') || 'demo';
  });

  // Client-side Browser Webcam Integration
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const framePusherRef = useRef(null);

  // Sync mode with webcam
  useEffect(() => {
    if (activeMode === 'webcam') {
      startWebcam();
    } else {
      stopWebcam();
    }
  }, [activeMode]);

  // Handle frame loaded from backend stream
  const handleFrameLoad = () => {
    setHasLoaded(true);
    setStreamError(false);
    if (useSnapshotMode) {
      setTimeout(() => {
        setSnapTick(Date.now());
      }, 45);
    }
  };

  const handleFrameError = () => {
    setHasLoaded(false);
    if (!useSnapshotMode) {
      setUseSnapshotMode(true);
    } else {
      setTimeout(() => {
        setSnapTick(Date.now());
      }, 1000);
    }
  };

  // Start client browser webcam using Web MediaDevices API
  const startWebcam = async () => {
    try {
      setWebcamError(null);
      stopWebcam();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported by your browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      setIsWebcamActive(true);
      setStreamError(false);
      setHasLoaded(true);

      // Notify backend in background to expect browser webcam
      api.switchCameraSource(currentCamera?.camera_id || 'CAM-01', '0').catch(() => {});

      // Launch background frame pusher loop to feed YOLO on FastAPI backend
      startFramePusher();
    } catch (err) {
      console.error('[LiveFeed] Webcam access error:', err);
      setWebcamError(err.message || 'Camera permission denied or camera unavailable.');
      setIsWebcamActive(false);
    }
  };

  // Stop client browser webcam
  const stopWebcam = () => {
    if (framePusherRef.current) {
      clearInterval(framePusherRef.current);
      framePusherRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsWebcamActive(false);
  };

  // Stream browser webcam frames to backend AI pipeline (~8 FPS)
  const startFramePusher = () => {
    if (framePusherRef.current) clearInterval(framePusherRef.current);
    framePusherRef.current = setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.readyState < 2) return;

      const ctx = canvas.getContext('2d');
      canvas.width = 640;
      canvas.height = 480;
      ctx.drawImage(video, 0, 0, 640, 480);

      canvas.toBlob((blob) => {
        if (blob) {
          api.pushWebcamFrame(blob).catch(() => {});
        }
      }, 'image/jpeg', 0.65);
    }, 125);
  };

  // Cleanup webcam when unmounting
  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, []);

  const streamUrl = useSnapshotMode
    ? `${getBackendBase()}/api/v1/stream/snapshot?t=${snapTick}`
    : `${getBackendBase()}/api/v1/stream/video_feed?t=${streamKey}`;

  const handleReconnect = () => {
    setStreamError(false);
    setHasLoaded(false);
    setStreamKey(Date.now());
    setSnapTick(Date.now());
  };

  const handleSwitchSource = (newSource) => {
    if (!newSource) return;
    const cleanSource = String(newSource).trim().replace(/^["']|["']$/g, '');
    if (!cleanSource) return;

    setShowSwitchModal(false);
    setStreamError(false);

    if (cleanSource === '0' || cleanSource.toLowerCase() === 'webcam') {
      setActiveMode('webcam');
      localStorage.setItem('ibvap_feed_mode', 'webcam');
      startWebcam();
      if (onSourceChanged) onSourceChanged('0');
      return;
    }

    if (cleanSource.includes('sample_border') || cleanSource.includes('demo')) {
      setActiveMode('demo');
      localStorage.setItem('ibvap_feed_mode', 'demo');
      stopWebcam();
      api.switchCameraSource(currentCamera?.camera_id || 'CAM-01', cleanSource).catch(() => {});
      if (onSourceChanged) onSourceChanged(cleanSource);
      return;
    }

    // Custom RTSP / Smartphone stream
    setActiveMode('stream');
    localStorage.setItem('ibvap_feed_mode', 'stream');
    stopWebcam();
    api.switchCameraSource(currentCamera?.camera_id || 'CAM-01', cleanSource).catch(() => {});
    if (onSourceChanged) onSourceChanged(cleanSource);
    handleReconnect();
  };

  const isDemo = activeMode === 'demo';

  return (
    <div className="bg-[#0d1117] border border-slate-800 rounded flex flex-col h-full relative overflow-hidden">
      {/* Hidden canvas for client-side webcam frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Feed Tactical Header */}
      <div className="h-10 bg-slate-900/90 border-b border-slate-800 px-4 flex items-center justify-between z-10">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span className="text-[10px] font-mono font-bold text-rose-400 tracking-wider">LIVE FEED</span>
          </div>
          <span className="text-slate-600 font-mono">|</span>
          <span className="text-xs font-mono text-slate-300 font-semibold truncate max-w-[200px] sm:max-w-none">
            {currentCamera?.camera_id || 'CAM-01'} — {currentCamera?.name || 'North Border Sector'}
          </span>
          <span className={`px-1.5 py-0.5 text-[10px] font-mono uppercase rounded border ${
            activeMode === 'webcam'
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 font-bold'
              : isDemo
                ? 'bg-amber-950/80 text-amber-300 border-amber-500/50 font-bold'
                : 'bg-slate-800 text-cyan-400 border-slate-700'
          }`}>
            {activeMode === 'webcam' ? 'LOCAL WEBCAM' : (isDemo ? 'DEMO CCTV STREAM' : 'RTSP STREAM')}
          </span>
          {zones && zones.length > 0 ? (
            <span className="px-2 py-0.5 text-[10px] font-mono bg-rose-950/70 border border-rose-500/50 rounded text-rose-300 flex items-center space-x-1.5 max-w-[240px] sm:max-w-none truncate" title={zones.map(z => z.name).join(' | ')}>
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
          {/* Stream Mode Toggle (Only when in RTSP mode) */}
          {activeMode === 'stream' && (
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
              title="Toggle between MJPEG Stream and Snapshot Polling Mode"
            >
              {useSnapshotMode ? 'MODE: SNAPSHOTS' : 'MODE: MJPEG'}
            </button>
          )}

          {/* Reconnect / Refresh button */}
          <button
            onClick={() => {
              if (activeMode === 'webcam') {
                startWebcam();
              } else {
                handleReconnect();
              }
            }}
            className="p-1 px-2 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 rounded transition-colors"
            title="Refresh feed connection"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Switch Source Button */}
          <button
            onClick={() => setShowSwitchModal(true)}
            className="flex items-center space-x-1 px-2.5 py-1 text-xs font-mono bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-400 border border-cyan-500/40 rounded transition-colors"
            title="Switch between Webcam, Demo Video, or Smartphone RTSP"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>CHANGE SOURCE</span>
          </button>
        </div>
      </div>

      {/* Video Stream Canvas */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-[360px]">
        {/* 1. Client Browser Webcam Mode */}
        {activeMode === 'webcam' ? (
          <div className="relative w-full h-full flex items-center justify-center select-none">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
            {/* SVG Overlay for zones drawn over user's live webcam */}
            {zones && zones.length > 0 && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 640 480" preserveAspectRatio="none">
                {zones.map((zone, idx) => {
                  const pts = zone.polygon_coords || zone.polygon_data || [];
                  if (!Array.isArray(pts) || pts.length < 2) return null;
                  const ptsStr = pts.map(p => `${p.x || p[0]},${p.y || p[1]}`).join(' ');
                  const color = zone.color || '#ef4444';
                  return (
                    <g key={zone.zone_id || idx}>
                      <polygon points={ptsStr} fill={color} fillOpacity="0.2" stroke={color} strokeWidth="2" strokeDasharray="4 2" />
                      <text x={pts[0].x || pts[0][0] || 20} y={Math.max(20, (pts[0].y || pts[0][1] || 20) - 8)} fill={color} fontSize="12" fontFamily="monospace" fontWeight="bold">
                        {zone.name || `ZONE ${idx + 1}`}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        ) : isDemo ? (
          // 2. Demo Video Mode (Continuous zero-latency direct CDN playback)
          <div className="relative w-full h-full flex items-center justify-center select-none">
            <video
              src="/sample_border.mp4"
              loop
              autoPlay
              muted
              playsInline
              className="w-full h-full object-contain"
            />

            {/* Overlaid backend AI inference detections (only shown if backend stream loads) */}
            <img
              key={useSnapshotMode ? `snapshot-${snapTick}` : `mjpeg-${streamKey}`}
              src={streamUrl}
              alt=""
              onLoad={handleFrameLoad}
              onError={handleFrameError}
              className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${
                hasLoaded ? 'block opacity-90' : 'hidden'
              }`}
            />

            {/* SVG Overlay for zones drawn over video */}
            {zones && zones.length > 0 && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 640 480" preserveAspectRatio="none">
                {zones.map((zone, idx) => {
                  const pts = zone.polygon_coords || zone.polygon_data || [];
                  if (!Array.isArray(pts) || pts.length < 2) return null;
                  const ptsStr = pts.map(p => `${p.x || p[0]},${p.y || p[1]}`).join(' ');
                  const color = zone.color || '#ef4444';
                  return (
                    <g key={zone.zone_id || idx}>
                      <polygon points={ptsStr} fill={color} fillOpacity="0.2" stroke={color} strokeWidth="2" strokeDasharray="4 2" />
                      <text x={pts[0].x || pts[0][0] || 20} y={Math.max(20, (pts[0].y || pts[0][1] || 20) - 8)} fill={color} fontSize="12" fontFamily="monospace" fontWeight="bold">
                        {zone.name || `ZONE ${idx + 1}`}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        ) : (
          // 3. Custom RTSP Stream Mode
          <div className="relative w-full h-full flex items-center justify-center select-none">
            <img
              key={useSnapshotMode ? `snapshot-${snapTick}` : `mjpeg-${streamKey}`}
              src={streamUrl}
              alt=""
              onLoad={handleFrameLoad}
              onError={handleFrameError}
              className={`w-full h-full object-contain ${hasLoaded ? 'block' : 'hidden'}`}
            />
            {!hasLoaded && (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <ShieldAlert className="w-10 h-10 text-cyan-400 mb-3 animate-pulse" />
                <span className="text-xs font-mono font-bold text-cyan-300 mb-1">CONNECTING TO STREAM SOURCE...</span>
                <p className="text-[11px] text-slate-500 max-w-xs mb-3">
                  Verifying RTSP stream connection on edge network.
                </p>
                <button
                  onClick={() => handleSwitchSource('data/demo_videos/sample_border.mp4')}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs font-mono rounded"
                >
                  SWITCH TO DEMO VIDEO
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tactical Corner HUD Overlays */}
        <div className="absolute top-3 left-3 pointer-events-none flex flex-col space-y-1">
          <div className="bg-black/70 backdrop-blur-sm border border-slate-800 px-2 py-1 rounded text-[10px] font-mono text-slate-300">
            FPS: <span className="text-cyan-400 font-bold">{activeMode === 'webcam' ? 25.0 : (hasLoaded ? (liveStats?.fps || 30.0) : 30.0)}</span>
          </div>
          {activeMode === 'webcam' ? (
            <div className="bg-emerald-950/90 border border-emerald-500/60 px-2 py-0.5 rounded text-[9px] font-mono text-emerald-300 font-bold flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>BROWSER WEBCAM ACTIVE</span>
            </div>
          ) : isDemo ? (
            <div className="bg-amber-950/80 border border-amber-500/50 px-2 py-0.5 rounded text-[9px] font-mono text-amber-300 font-bold flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>DEMO SURVEILLANCE FEED</span>
            </div>
          ) : null}
        </div>

        <div className="absolute top-3 right-3 pointer-events-none">
          <div className="bg-black/70 backdrop-blur-sm border border-slate-800 px-2 py-1 rounded text-[10px] font-mono text-emerald-400 flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>AI ANALYTICS ENGAGED</span>
          </div>
        </div>

        {webcamError && (
          <div className="absolute bottom-3 left-3 right-3 bg-rose-950/90 border border-rose-500/80 text-rose-300 text-xs font-mono p-2.5 rounded flex items-center justify-between">
            <span>⚠️ {webcamError}</span>
            <button onClick={() => setWebcamError(null)} className="text-white hover:text-rose-200 ml-2">✕</button>
          </div>
        )}
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
                className="text-slate-500 hover:text-white font-mono text-sm cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Select one of the quick presets or stream from your smartphone or laptop webcam.
            </p>

            {/* Quick Presets */}
            <div className="space-y-2 mb-5">
              <button
                onClick={() => handleSwitchSource('data/demo_videos/sample_border.mp4')}
                disabled={isSwitching}
                className="w-full flex items-center justify-between p-3 rounded bg-slate-900/90 hover:bg-cyan-950/40 border border-slate-800 hover:border-cyan-500/40 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-3">
                  <FileVideo className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="text-xs font-mono font-bold text-white flex items-center space-x-2">
                      <span>Demo Video (Continuous CCTV Loop)</span>
                      {isDemoVideo && <span className="text-[10px] text-emerald-400 font-normal">[ACTIVE]</span>}
                    </div>
                    <div className="text-[11px] text-slate-400">Pre-recorded border surveillance clip with person & vehicle</div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleSwitchSource('0')}
                disabled={isSwitching}
                className="w-full flex items-center justify-between p-3 rounded bg-slate-900/90 hover:bg-cyan-950/40 border border-slate-800 hover:border-cyan-500/40 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-3">
                  <Video className="w-4 h-4 text-emerald-400" />
                  <div>
                    <div className="text-xs font-mono font-bold text-white flex items-center space-x-2">
                      <span>Laptop Built-in Webcam</span>
                      {isWebcamActive && <span className="text-[10px] text-emerald-400 font-normal">[ACTIVE]</span>}
                    </div>
                    <div className="text-[11px] text-slate-400">Direct camera input from your browser with live AI detection</div>
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
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowSwitchModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs rounded transition-colors cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchSource(customSource)}
                  disabled={isSwitching || !customSource.trim()}
                  className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-mono font-bold text-xs rounded transition-colors cursor-pointer"
                >
                  {isSwitching ? 'CONNECTING...' : 'APPLY SMARTPHONE STREAM'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
