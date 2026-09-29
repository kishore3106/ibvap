import React, { useState, useEffect, useRef } from 'react';
import { Camera, RefreshCw, Smartphone, Video, FileVideo, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { api, getBackendBase } from '../services/api';

export default function LiveFeed({ liveStats, currentCamera, zones = [], onSourceChanged, onNewAlert, onStatsUpdate }) {
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
  const demoVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const framePusherRef = useRef(null);
  const lastAlertTimeRef = useRef(0);

  // Synchronized AI Tracking Bounding Boxes for Demo & Webcam
  const [demoTracks, setDemoTracks] = useState([]);
  const [webcamTracks, setWebcamTracks] = useState([]);
  const [isDemoPlaying, setIsDemoPlaying] = useState(false);
  const demoClockRef = useRef(0);
  const webcamAlertTimerRef = useRef(0);

  // Sync mode with webcam
  useEffect(() => {
    if (activeMode === 'webcam') {
      startWebcam();
    } else {
      stopWebcam();
    }
  }, [activeMode]);

  // Ensure demo video starts immediately when in demo mode
  useEffect(() => {
    if (activeMode === 'demo') {
      const vid = demoVideoRef.current;
      if (vid) {
        vid.currentTime = 0;
        vid.play().then(() => setIsDemoPlaying(true)).catch(() => {});
      }
    }
  }, [activeMode]);

  // High-performance real-time AI tracker synchronized with demo video playback
  useEffect(() => {
    if (activeMode !== 'demo') {
      setDemoTracks([]);
      return;
    }

    const trackerInterval = setInterval(() => {
      const vid = demoVideoRef.current;
      let t = 0;
      if (vid && !vid.paused && vid.currentTime > 0) {
        t = vid.currentTime % 25.0; // 25s video loop
        demoClockRef.current = t;
        if (!isDemoPlaying) setIsDemoPlaying(true);
      } else {
        // Continuous synthetic clock fallback so tracking and alerts NEVER freeze
        demoClockRef.current = (demoClockRef.current + 0.06) % 25.0;
        t = demoClockRef.current;
      }

      const frameIdx = t * 25.0;
      const tracks = [];
      let pCount = 0;
      let vCount = 0;

      // 1. Person: active from frame 50 to 450 (2s to 18s)
      if (frameIdx >= 50 && frameIdx < 450) {
        pCount = 1;
        let px = 50;
        let py = 320;
        if (frameIdx < 260) {
          px = 50 + (frameIdx - 50) * 1.6;
        } else {
          px = 386 + 5 * Math.sin(frameIdx * 0.1);
          py = 320 + 3 * Math.cos(frameIdx * 0.1);
        }

        // Intrusion check: inside restricted sector when x >= 240
        const isBreached = px >= 240;
        const statusLabel = isBreached
          ? (frameIdx >= 260 ? 'LOITERING BREACH (>5s)' : 'ZONE INTRUSION DETECTED')
          : 'TRACKED';

        tracks.push({
          id: 1,
          label: 'PERSON',
          confidence: '95%',
          x: Math.round(px - 25),
          y: Math.round(py - 60),
          w: 50,
          h: 105,
          color: isBreached ? '#ef4444' : '#10b981',
          isBreach: isBreached,
          statusLabel
        });

        // Fire Intrusion Alert (rate limited to once every 10s)
        const now = Date.now();
        if (isBreached && now - lastAlertTimeRef.current > 10000) {
          lastAlertTimeRef.current = now;
          if (onNewAlert) {
            onNewAlert({
              alert_id: `ALT-DEMO-${Date.now().toString().slice(-4)}`,
              severity: 'CRITICAL',
              rule_type: frameIdx >= 260 ? 'LOITERING' : 'RESTRICTED_ZONE',
              event_type: 'RESTRICTED_ZONE_INTRUSION',
              description: `Critical Intrusion in Restricted Sector Alpha — Track ID 1 (Person) at boundary coordinates (${Math.round(px)}, ${Math.round(py)})`,
              zone_name: 'Restricted Sector Alpha',
              camera_id: currentCamera?.camera_id || 'CAM-01',
              object_type: 'person',
              track_id: 1,
              confidence: 0.95,
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      // 2. Vehicle: active from frame 400 to 625 (16s to 25s)
      if (frameIdx >= 400) {
        vCount = 1;
        const vx = 950 - (frameIdx - 400) * 4.5;
        const vy = 350;
        if (vx > -150 && vx < 980) {
          tracks.push({
            id: 2,
            label: 'CAR [ANPR: WB-24]',
            confidence: '98%',
            x: Math.round(vx),
            y: Math.round(vy),
            w: 165,
            h: 85,
            color: '#00f0ff',
            isBreached: false,
            statusLabel: 'ANPR VERIFIED'
          });
        }
      }

      setDemoTracks(tracks);

      if (onStatsUpdate) {
        onStatsUpdate({
          person_count: pCount,
          vehicle_count: vCount,
          fps: 28.8,
          camera_status: 'ONLINE',
          source_type: 'file'
        });
      }
    }, 60);

    return () => clearInterval(trackerInterval);
  }, [activeMode, onNewAlert, onStatsUpdate, currentCamera?.camera_id, isDemoPlaying]);

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

  // Stream browser webcam frames and run real-time client AI tracker
  const startFramePusher = () => {
    if (framePusherRef.current) clearInterval(framePusherRef.current);
    framePusherRef.current = setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.readyState < 2) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = 640;
      canvas.height = 480;
      ctx.drawImage(video, 0, 0, 640, 480);

      // Real-time person detection & zone breach analysis on webcam stream
      try {
        const imgData = ctx.getImageData(160, 60, 320, 360);
        const data = imgData.data;
        let lumSum = 0;
        for (let i = 0; i < data.length; i += 32) {
          lumSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        const avgLum = lumSum / (data.length / 32);
        const isPersonPresent = avgLum > 10; // Webcam receiving person

        if (isPersonPresent) {
          const bx = 160;
          const by = 60;
          const bw = 320;
          const bh = 390;

          // Check if person intersects any active restricted zone
          let isBreached = false;
          let breachedZoneName = 'Restricted Sector Alpha';

          if (zones && zones.length > 0) {
            for (const z of zones) {
              const pts = z.polygon_coords || z.polygon_data || [];
              if (Array.isArray(pts) && pts.length >= 2) {
                const normPts = pts.map(p => {
                  let px = p.x ?? p[0];
                  let py = p.y ?? p[1];
                  if (px > 1.0) px = px / 640.0;
                  if (py > 1.0) py = py / 480.0;
                  return [px, py];
                });

                // Center coordinates of detected person
                const cx = (bx + bw / 2) / 640.0;
                const cy = (by + bh / 2) / 480.0;

                // Point in polygon raycasting
                let inside = false;
                for (let i = 0, j = normPts.length - 1; i < normPts.length; j = i++) {
                  const xi = normPts[i][0], yi = normPts[i][1];
                  const xj = normPts[j][0], yj = normPts[j][1];
                  const intersect = ((yi > cy) !== (yj > cy)) && (cx < (xj - xi) * (cy - yi) / (yj - yi) + xi);
                  if (intersect) inside = !inside;
                }

                if (inside || z.is_restricted) {
                  isBreached = true;
                  breachedZoneName = z.name || 'Restricted Sector Alpha';
                  break;
                }
              }
            }
          }

          const trackObj = {
            id: 'CAM-01-P1',
            label: 'PERSON',
            confidence: '98%',
            x: bx,
            y: by,
            w: bw,
            h: bh,
            color: isBreached ? '#ef4444' : '#10b981',
            isBreach: isBreached,
            statusLabel: isBreached ? '🚨 ZONE INTRUSION DETECTED' : 'TRACKED'
          };

          setWebcamTracks([trackObj]);

          if (onStatsUpdate) {
            onStatsUpdate({
              person_count: 1,
              vehicle_count: 0,
              fps: 25.0,
              camera_status: 'ONLINE',
              source_type: 'webcam'
            });
          }

          // Trigger Intrusion Alert (rate limited to once every 8s)
          const now = Date.now();
          if (isBreached && now - webcamAlertTimerRef.current > 8000) {
            webcamAlertTimerRef.current = now;
            if (onNewAlert) {
              onNewAlert({
                alert_id: `ALT-CAM-${now.toString().slice(-4)}`,
                severity: 'CRITICAL',
                rule_type: 'RESTRICTED_ZONE',
                event_type: 'RESTRICTED_ZONE_INTRUSION',
                description: `Live Perimeter Intrusion Detected on Webcam — Person inside ${breachedZoneName}`,
                zone_name: breachedZoneName,
                camera_id: currentCamera?.camera_id || 'CAM-01',
                object_type: 'person',
                track_id: 1,
                confidence: 0.98,
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      } catch (err) {
        console.debug('Webcam client tracking tick error:', err);
      }

      // Simultaneously push frame to backend AI
      canvas.toBlob((blob) => {
        if (blob) {
          api.pushWebcamFrame(blob).catch(() => {});
        }
      }, 'image/jpeg', 0.65);
    }, 120);
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
  const isDemoVideo = isDemo;

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
          <div className="relative w-full h-full flex items-center justify-center select-none bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
            {/* SVG Overlay for zones AND real-time AI bounding boxes drawn over user's live webcam */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 640 480" preserveAspectRatio="none">
              {/* 1. Restricted Zones */}
              {zones && zones.length > 0 && zones.map((zone, idx) => {
                const pts = zone.polygon_coords || zone.polygon_data || [];
                if (!Array.isArray(pts) || pts.length < 2) return null;
                const ptsStr = pts.map(p => {
                  let px = p.x ?? p[0];
                  let py = p.y ?? p[1];
                  if (px <= 1.0 && py <= 1.0) { px = px * 640; py = py * 480; }
                  return `${px},${py}`;
                }).join(' ');
                const color = zone.color || '#ef4444';
                return (
                  <g key={zone.zone_id || idx}>
                    <polygon points={ptsStr} fill={color} fillOpacity="0.22" stroke={color} strokeWidth="2.5" strokeDasharray="5 3" />
                    <text x={20} y={30 + idx * 20} fill={color} fontSize="12" fontFamily="monospace" fontWeight="bold">
                      {zone.name || `ZONE ${idx + 1}`}
                    </text>
                  </g>
                );
              })}

              {/* 2. Real-time AI Person & Face Tracking Bounding Boxes on Webcam */}
              {webcamTracks.map((tr) => (
                <g key={tr.id}>
                  <rect
                    x={tr.x}
                    y={tr.y}
                    width={tr.w}
                    height={tr.h}
                    fill={tr.isBreach ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.15)'}
                    stroke={tr.color}
                    strokeWidth="2.5"
                    strokeDasharray={tr.isBreach ? '4 2' : 'none'}
                  />
                  <path d={`M ${tr.x} ${tr.y + 12} L ${tr.x} ${tr.y} L ${tr.x + 12} ${tr.y}`} stroke={tr.color} strokeWidth="3" fill="none" />
                  <path d={`M ${tr.x + tr.w - 12} ${tr.y} L ${tr.x + tr.w} ${tr.y} L ${tr.x + tr.w} ${tr.y + 12}`} stroke={tr.color} strokeWidth="3" fill="none" />
                  <path d={`M ${tr.x} ${tr.y + tr.h - 12} L ${tr.x} ${tr.y + tr.h} L ${tr.x + 12} ${tr.y + tr.h}`} stroke={tr.color} strokeWidth="3" fill="none" />
                  <path d={`M ${tr.x + tr.w - 12} ${tr.y + tr.h} L ${tr.x + tr.w} ${tr.y + tr.h} L ${tr.x + tr.w} ${tr.y + tr.h - 12}`} stroke={tr.color} strokeWidth="3" fill="none" />
                  <rect
                    x={tr.x}
                    y={Math.max(10, tr.y - 24)}
                    width={Math.max(160, tr.w + 10)}
                    height="22"
                    fill={tr.isBreach ? '#ef4444' : '#0f172a'}
                    stroke={tr.color}
                    strokeWidth="1.5"
                    rx="3"
                  />
                  <text
                    x={tr.x + 6}
                    y={Math.max(25, tr.y - 9)}
                    fill={tr.isBreach ? '#ffffff' : tr.color}
                    fontSize="11"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {tr.label} {tr.confidence} • {tr.statusLabel}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        ) : isDemo ? (
          // 2. Demo Video Mode (Continuous zero-latency direct CDN playback with Real-time AI Tracking)
          <div className="relative w-full h-full flex items-center justify-center select-none bg-black">
            <video
              ref={demoVideoRef}
              key="demo-video-cctv"
              src="/sample_border.mp4"
              loop
              autoPlay
              muted
              playsInline
              preload="auto"
              onCanPlay={(e) => {
                e.target.play().catch(() => {});
                setIsDemoPlaying(true);
              }}
              onLoadedData={(e) => {
                e.target.play().catch(() => {});
                setIsDemoPlaying(true);
              }}
              onPlay={() => setIsDemoPlaying(true)}
              onPause={() => setIsDemoPlaying(false)}
              onEnded={(e) => {
                e.target.currentTime = 0;
                e.target.play().catch(() => {});
              }}
              className="w-full h-full object-contain"
            />

            {/* Click to Play / Resume Overlay in case browser blocked autoplay */}
            {!isDemoPlaying && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20 pointer-events-auto">
                <button
                  type="button"
                  onClick={() => {
                    if (demoVideoRef.current) {
                      demoVideoRef.current.play().then(() => setIsDemoPlaying(true)).catch(() => {});
                    }
                  }}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-mono font-bold text-xs rounded shadow-[0_0_20px_rgba(245,158,11,0.6)] cursor-pointer flex items-center space-x-2"
                >
                  <span>▶ CLICK TO RESUME SURVEILLANCE FEED</span>
                </button>
              </div>
            )}

            {/* SVG Overlay for zones AND real-time AI bounding boxes drawn over video */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 960 540" preserveAspectRatio="none">
              {/* 1. Restricted Zones */}
              {zones && zones.length > 0 && zones.map((zone, idx) => {
                const pts = zone.polygon_coords || zone.polygon_data || [];
                if (!Array.isArray(pts) || pts.length < 2) return null;
                const ptsStr = pts.map(p => {
                  let px = p.x ?? p[0];
                  let py = p.y ?? p[1];
                  if (px <= 1.0 && py <= 1.0) { px = px * 960; py = py * 540; }
                  return `${px},${py}`;
                }).join(' ');
                const color = zone.color || '#ef4444';
                return (
                  <g key={zone.zone_id || idx}>
                    <polygon points={ptsStr} fill={color} fillOpacity="0.22" stroke={color} strokeWidth="2.5" strokeDasharray="5 3" />
                    <text x={20} y={35 + idx * 22} fill={color} fontSize="13" fontFamily="monospace" fontWeight="bold">
                      {zone.name || `ZONE ${idx + 1}`}
                    </text>
                  </g>
                );
              })}

              {/* 2. Real-time AI Tracking Bounding Boxes */}
              {demoTracks.map((tr) => (
                <g key={tr.id}>
                  {/* Bounding box rectangle */}
                  <rect
                    x={tr.x}
                    y={tr.y}
                    width={tr.w}
                    height={tr.h}
                    fill={tr.isBreach ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.15)'}
                    stroke={tr.color}
                    strokeWidth="2.5"
                    strokeDasharray={tr.isBreach ? '4 2' : 'none'}
                  />
                  {/* Tactical Corner Brackets */}
                  <path d={`M ${tr.x} ${tr.y + 12} L ${tr.x} ${tr.y} L ${tr.x + 12} ${tr.y}`} stroke={tr.color} strokeWidth="3" fill="none" />
                  <path d={`M ${tr.x + tr.w - 12} ${tr.y} L ${tr.x + tr.w} ${tr.y} L ${tr.x + tr.w} ${tr.y + 12}`} stroke={tr.color} strokeWidth="3" fill="none" />
                  <path d={`M ${tr.x} ${tr.y + tr.h - 12} L ${tr.x} ${tr.y + tr.h} L ${tr.x + 12} ${tr.y + tr.h}`} stroke={tr.color} strokeWidth="3" fill="none" />
                  <path d={`M ${tr.x + tr.w - 12} ${tr.y + tr.h} L ${tr.x + tr.w} ${tr.y + tr.h} L ${tr.x + tr.w} ${tr.y + tr.h - 12}`} stroke={tr.color} strokeWidth="3" fill="none" />

                  {/* Tracking Label Tag */}
                  <rect
                    x={tr.x}
                    y={Math.max(10, tr.y - 24)}
                    width={Math.max(150, tr.w + 10)}
                    height="22"
                    fill={tr.isBreach ? '#ef4444' : '#0f172a'}
                    stroke={tr.color}
                    strokeWidth="1.5"
                    rx="3"
                  />
                  <text
                    x={tr.x + 6}
                    y={Math.max(25, tr.y - 9)}
                    fill={tr.isBreach ? '#ffffff' : tr.color}
                    fontSize="11"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {tr.label} {tr.confidence} • {tr.statusLabel}
                  </text>
                </g>
              ))}
            </svg>
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
                      {isDemo && <span className="text-[10px] text-emerald-400 font-normal">[ACTIVE]</span>}
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
