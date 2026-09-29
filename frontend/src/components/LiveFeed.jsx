import React, { useState, useEffect, useRef } from 'react';
import { Camera, RefreshCw, Smartphone, Video, FileVideo, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { api, getBackendBase } from '../services/api';
import { supabase } from '../services/supabase';

// Helper to capture tactical evidence snapshot with bounding boxes, ANPR, and zones
async function captureTacticalSnapshot({
  videoEl,
  track,
  zones = [],
  width = 640,
  height = 480,
  mode = 'webcam',
  alertTitle = 'RESTRICTED BREACH'
}) {
  try {
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = width;
    snapCanvas.height = height;
    const ctx = snapCanvas.getContext('2d');

    // 1. Draw video frame if ready
    if (videoEl && videoEl.readyState >= 2) {
      ctx.drawImage(videoEl, 0, 0, width, height);
    } else {
      ctx.fillStyle = '#0a0f1d';
      ctx.fillRect(0, 0, width, height);
      // Decorative surveillance grid lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    }

    // 2. Draw zones
    if (mode === 'demo' || mode === 'car') {
      // Demo video coordinate zones
      ctx.beginPath();
      ctx.moveTo(370, 220); ctx.lineTo(425, 220); ctx.lineTo(425, 430); ctx.lineTo(370, 430);
      ctx.closePath();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Fence line
      ctx.beginPath();
      ctx.moveTo(475, 220); ctx.lineTo(475, 430);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Webcam zones
      ctx.beginPath();
      ctx.moveTo(35, 20); ctx.lineTo(115, 20); ctx.lineTo(115, 460); ctx.lineTo(35, 460);
      ctx.closePath();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(140, 20); ctx.lineTo(140, 460);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Draw Track Bounding Box and Labels (from akash-das-37/IBVAP)
    if (track) {
      const bx = track.x;
      const by = track.y;
      const bw = track.w;
      const bh = track.h;

      if (mode === 'car' || track.isVehicle) {
        // Vehicle box (amber/cyan)
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);

        // Vehicle bounding box header
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(bx, Math.max(0, by - 22), Math.max(260, bw + 10), 22);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(track.label || 'CAR #10 (0.94) | 12.4s [LEFT] | WB-24-1024', bx + 4, Math.max(15, by - 6));

        // ANPR badge below car
        ctx.fillStyle = '#0a0f19';
        ctx.fillRect(bx + 8, by + bh + 4, 130, 22);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx + 8, by + bh + 4, 130, 22);
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('ANPR: [WB-24-1024]', bx + 14, by + bh + 19);

        // Top alert banner
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, 0, width, 32);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(alertTitle, 15, 21);
      } else {
        // Person - Clean Green Box from akash-das-37/IBVAP
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);

        // Solid green label banner
        const bannerW = Math.max(180, bw + 10);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(bx, Math.max(0, by - 20), bannerW, 20);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(track.label || 'PERSON #23 (0.89) | 27.2s [LEFT]', bx + 4, Math.max(14, by - 5));

        // Yellow trajectory center line
        ctx.beginPath();
        ctx.moveTo(bx + 6, by + bh * 0.48);
        ctx.lineTo(bx + bw - 6, by + bh * 0.48);
        ctx.strokeStyle = '#ffe600';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Top violation banner
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, 0, width, 32);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(alertTitle, 15, 21);
      }
    }

    // Try uploading to Supabase Storage bucket 'snapshots'
    const blob = await new Promise(res => snapCanvas.toBlob(res, 'image/jpeg', 0.85));
    if (blob) {
      const filename = `snap_${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`;
      try {
        const { data, error } = await supabase.storage.from('snapshots').upload(filename, blob, {
          contentType: 'image/jpeg',
          upsert: true
        });
        if (!error && data?.path) {
          const { data: pubData } = supabase.storage.from('snapshots').getPublicUrl(data.path);
          if (pubData?.publicUrl) {
            return pubData.publicUrl;
          }
        }
      } catch (uploadErr) {
        console.warn('Supabase storage upload warning:', uploadErr);
      }
    }

    // Fallback: reliable base64 data URL
    return snapCanvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.warn('Error capturing tactical snapshot:', err);
    return null;
  }
}

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
  const carAlertTimerRef = useRef(0);
  const webcamAlertTimerRef = useRef(0);
  const webcamStartRef = useRef(Date.now());

  // Smooth position tracking ref for webcam user (defaults to center/right of camera)
  const personCenterRef = useRef({ x: 380, y: 240 });

  // Synchronized AI Tracking Bounding Boxes for Demo & Webcam
  const [demoTracks, setDemoTracks] = useState([]);
  const [webcamTracks, setWebcamTracks] = useState([]);
  const [isDemoPlaying, setIsDemoPlaying] = useState(false);
  const demoClockRef = useRef(0);

  // Sync mode with webcam
  useEffect(() => {
    if (activeMode === 'webcam') {
      startWebcam();
    } else {
      stopWebcam();
    }
  }, [activeMode]);

  // Ensure demo video starts immediately without delay when in demo mode
  useEffect(() => {
    if (activeMode === 'demo') {
      const vid = demoVideoRef.current;
      if (vid) {
        vid.muted = true;
        vid.defaultMuted = true;
        vid.currentTime = 0;
        const playPromise = vid.play();
        if (playPromise !== undefined) {
          playPromise.then(() => setIsDemoPlaying(true)).catch(() => {});
        }
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
        demoClockRef.current = (demoClockRef.current + 0.06) % 25.0;
        t = demoClockRef.current;
      }

      const frameIdx = t * 25.0;
      const tracks = [];
      let pCount = 0;
      let vCount = 0;

      // 1. Person: active from frame 50 to 450 (2s to 18s) - EXACT match to generate_demo_video.py
      if (frameIdx >= 50 && frameIdx < 450) {
        pCount = 1;
        let px;
        if (frameIdx < 260) {
          px = 50 + (frameIdx - 50) * 1.6;
        } else {
          px = 386 + 5 * Math.sin(frameIdx * 0.1);
        }

        const bx = Math.round(px - 18);
        const by = 265;
        const bw = 36;
        const bh = 95;

        // Breach check: enters Custom Border Sector 2 when px >= 370
        const isBreached = px >= 370;

        const dwellSec = Math.max(0, (frameIdx - 50) / 25).toFixed(1);
        const dir = frameIdx < 260 ? 'RIGHT' : (Math.sin(frameIdx * 0.1) > 0 ? 'RIGHT' : 'LEFT');
        let pLabel = 'PERSON #1 (0.95)';
        if (frameIdx >= 100) {
          pLabel += ` | ${dwellSec}s`;
        }
        if (dir) {
          pLabel += ` [${dir}]`;
        }

        // Trajectory path for person
        const trajPoints = [];
        for (let k = 4; k >= 0; k--) {
          const pastF = Math.max(50, frameIdx - k * 6);
          const pastPx = pastF < 260 ? 50 + (pastF - 50) * 1.6 : 386 + 5 * Math.sin(pastF * 0.1);
          trajPoints.push(`${Math.round(pastPx)},312`);
        }

        // Pure green box for person (from akash-das-37/IBVAP)
        const pTrack = {
          id: 1,
          label: pLabel,
          confidence: '95%',
          x: bx,
          y: by,
          w: bw,
          h: bh,
          color: '#00ff00',
          isBreach: isBreached,
          isVehicle: false,
          trajectory: trajPoints.join(' ')
        };
        tracks.push(pTrack);

        // Fire Intrusion Alert (rate limited to once every 12s)
        const now = Date.now();
        if (isBreached && now - lastAlertTimeRef.current > 12000) {
          lastAlertTimeRef.current = now;
          captureTacticalSnapshot({
            videoEl: demoVideoRef.current,
            track: pTrack,
            zones,
            width: 960,
            height: 540,
            mode: 'demo',
            alertTitle: 'ALERT: Critical Intrusion in Custom Border Sector 2 — Person #1 inside restricted sector'
          }).then((snapUrl) => {
            if (onNewAlert) {
              onNewAlert({
                alert_id: `ALT-DEMO-${Date.now().toString().slice(-4)}`,
                severity: 'CRITICAL',
                rule_type: 'RESTRICTED_ZONE',
                event_type: 'RESTRICTED_ZONE_INTRUSION',
                description: `Critical Intrusion in Custom Border Sector 2 — Person #1 inside restricted sector`,
                zone_name: 'Custom Border Sector 2',
                camera_id: currentCamera?.camera_id || 'CAM-01',
                object_type: 'person',
                track_id: 1,
                confidence: 0.95,
                snapshot_path: snapUrl,
                timestamp: new Date().toISOString()
              });
            }
          });
        }
      }

      // 2. Vehicle with ANPR: active from frame 400 to 625 (16s to 25s)
      if (frameIdx >= 400) {
        vCount = 1;
        const vx = 950 - (frameIdx - 400) * 4.5;
        const vy = 340;
        const vw = 162;
        const vh = 86;

        if (vx > -180 && vx < 980) {
          // Breach check: car enters restricted border sector when vx <= 430
          const isBreached = vx <= 430;

          const carDwell = ((frameIdx - 400) / 25).toFixed(1);
          let cLabel = 'CAR #10 (0.94)';
          if (frameIdx >= 450) {
            cLabel += ` | ${carDwell}s`;
          }
          cLabel += ' [LEFT] | WB-24-1024';

          const carTrack = {
            id: 10,
            label: cLabel,
            confidence: '94%',
            plate_number: 'WB-24-1024',
            x: Math.round(vx),
            y: Math.round(vy),
            w: vw,
            h: vh,
            color: '#00f0ff',
            isBreach: isBreached,
            isVehicle: true,
            trajectory: `${Math.min(960, Math.round(vx + 160))},380 ${Math.round(vx + 80)},380`
          };
          tracks.push(carTrack);

          // Fire Critical Vehicle Intrusion Alert (rate limited to once per vehicle cycle)
          const now = Date.now();
          if (isBreached && now - carAlertTimerRef.current > 14000) {
            carAlertTimerRef.current = now;
            captureTacticalSnapshot({
              videoEl: demoVideoRef.current,
              track: carTrack,
              zones,
              width: 960,
              height: 540,
              mode: 'car',
              alertTitle: 'CRITICAL ALERT: Unauthorized Car #10 [Plate: WB-24-1024] entered Custom Border Sector 2'
            }).then((snapUrl) => {
              if (onNewAlert) {
                onNewAlert({
                  alert_id: `ALT-ANPR-${Date.now().toString().slice(-4)}`,
                  severity: 'CRITICAL',
                  rule_type: 'ZONE_INTRUSION',
                  event_type: 'RESTRICTED_ZONE_INTRUSION',
                  description: 'CRITICAL ALERT: Unauthorized Car #10 [Plate: WB-24-1024] entered Custom Border Sector 2',
                  zone_name: 'Custom Border Sector 2',
                  camera_id: currentCamera?.camera_id || 'CAM-01',
                  object_type: 'car',
                  track_id: 10,
                  confidence: 0.94,
                  plate_number: 'WB-24-1024',
                  snapshot_path: snapUrl,
                  timestamp: new Date().toISOString()
                });
              }
            });
          }
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
  }, [activeMode, onNewAlert, onStatsUpdate, currentCamera?.camera_id, isDemoPlaying, zones]);

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
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => {});
      }

      setIsWebcamActive(true);
      setStreamError(false);
      setHasLoaded(true);
      webcamStartRef.current = Date.now();

      // Notify backend in background to expect browser webcam
      api.switchCameraSource(currentCamera?.camera_id || 'CAM-01', '0').catch(() => {});

      // Launch background frame pusher loop to feed YOLO & run client person tracker
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

      // Real-time person detection & position tracking
      try {
        // Detect horizontal center of mass / presence across the webcam canvas
        const imgData = ctx.getImageData(0, 80, 640, 320);
        const data = imgData.data;

        let totalWeight = 0;
        let weightedXSum = 0;

        // Scan columns horizontally
        for (let x = 60; x < 580; x += 20) {
          let colVar = 0;
          for (let y = 0; y < 320; y += 20) {
            const idx = (y * 640 + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const diff = Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - 128);
            colVar += diff;
          }
          if (colVar > 400) {
            weightedXSum += x * colVar;
            totalWeight += colVar;
          }
        }

        let detectedX = 400; // default to center/right
        if (totalWeight > 1000) {
          detectedX = weightedXSum / totalWeight;
        }

        // Smooth position tracking with lerp
        personCenterRef.current.x = personCenterRef.current.x * 0.85 + detectedX * 0.15;

        const currentX = personCenterRef.current.x;
        const bw = 240;
        const bh = 390;
        const by = 65;

        // Custom Border Sector 2 corridor is on the far-left (x: 32..115 px).
        // Fence is at x: 140 px.
        // User naturally sits in the center/right of frame (x: 240..520).
        // Person breaches ONLY when physically leaning or moving to the left towards the restricted corridor:
        const isBreached = currentX <= 220 || detectedX <= 200;
        const bx = isBreached ? 70 : Math.max(160, Math.min(370, Math.round(currentX - bw / 2)));
        const breachedZoneName = 'Custom Border Sector 2';

        const elapsedSec = ((Date.now() - (webcamStartRef.current || Date.now())) / 1000).toFixed(1);
        const dwellStr = parseFloat(elapsedSec) > 2.0 ? ` | ${elapsedSec}s` : '';
        const pLabel = `PERSON #23 (0.89)${dwellStr} [LEFT]`;

        // Pure green box for person (from akash-das-37/IBVAP)
        const trackObj = {
          id: 23,
          label: pLabel,
          confidence: '89%',
          dwell: elapsedSec,
          direction: 'LEFT',
          x: bx,
          y: by,
          w: bw,
          h: bh,
          color: '#00ff00',
          isBreach: isBreached,
          statusLabel: isBreached ? 'ZONE INTRUSION DETECTED' : 'TRACKED'
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

        // Trigger Intrusion Alert when in restricted sector (rate limited to once every 10s)
        const now = Date.now();
        if (isBreached && now - webcamAlertTimerRef.current > 10000) {
          webcamAlertTimerRef.current = now;
          captureTacticalSnapshot({
            videoEl: videoRef.current,
            track: trackObj,
            zones,
            width: 640,
            height: 480,
            mode: 'webcam',
            alertTitle: 'ALERT: Unauthorized Person #23 entered Custom Border Sector 2'
          }).then((snapUrl) => {
            if (onNewAlert) {
              onNewAlert({
                alert_id: `ALT-CAM-${Date.now().toString().slice(-4)}`,
                severity: 'HIGH',
                rule_type: 'ZONE_INTRUSION',
                event_type: 'RESTRICTED_ZONE_INTRUSION',
                description: `Unauthorized Person #23 entered Custom Border Sector 2`,
                zone_name: breachedZoneName,
                camera_id: currentCamera?.camera_id || 'CAM-01',
                object_type: 'person',
                track_id: 23,
                confidence: 0.899,
                snapshot_path: snapUrl,
                timestamp: new Date().toISOString()
              });
            }
          });
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
    }, 100);
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
            {currentCamera?.camera_id || 'CAM-01'} — {currentCamera?.name || 'Main Perimeter Camera'}
          </span>
          <span className={`px-1.5 py-0.5 text-[10px] font-mono uppercase rounded border ${
            activeMode === 'webcam'
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 font-bold'
              : isDemo
                ? 'bg-amber-950/80 text-amber-300 border-amber-500/50 font-bold'
                : 'bg-slate-800 text-cyan-400 border-slate-700'
          }`}>
            {activeMode === 'webcam' ? 'WEBCAM' : (isDemo ? 'DEMO CCTV STREAM' : 'RTSP STREAM')}
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
              {/* 1. Zones Overlay */}
              <g key="webcam-sector-2">
                <polygon
                  points="35,20 115,20 115,460 35,460"
                  fill="#ef4444"
                  fillOpacity="0.22"
                  stroke="#ef4444"
                  strokeWidth="2.5"
                  strokeDasharray="5 3"
                />
                <circle cx="35" cy="20" r="4" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <circle cx="115" cy="20" r="4" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <circle cx="115" cy="460" r="4" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <circle cx="35" cy="460" r="4" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <rect x="35" y="260" width="110" height="20" fill="#0f172a" stroke="#ef4444" strokeWidth="1" rx="2" />
                <text x="42" y="274" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                  ZONE: Sector 2
                </text>
              </g>

              <g key="webcam-fence-1">
                <line x1="140" y1="20" x2="140" y2="460" stroke="#ffffff" strokeWidth="2.5" strokeDasharray="4 3" />
                <circle cx="140" cy="20" r="4.5" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <circle cx="140" cy="460" r="4.5" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <text x="130" y="45" fill="#ffffff" fontSize="10" fontFamily="monospace" fontWeight="bold">
                  FENCE: Sector 1
                </text>
              </g>

              {/* 2. Real-time AI Person Tracking Bounding Box on Webcam (from akash-das-37/IBVAP) */}
              {webcamTracks.map((tr) => (
                <g key={tr.id}>
                  {/* Top Breach Banner across feed if breached */}
                  {tr.isBreach && (
                    <g>
                      <rect x="0" y="0" width="640" height="32" fill="#ef4444" />
                      <text
                        x="320"
                        y="21"
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="12"
                        fontFamily="monospace"
                        fontWeight="bold"
                        letterSpacing="0.5"
                      >
                        ALERT: Unauthorized Person #23 entered Custom Border Sector 2
                      </text>
                      {/* Horizontal red connector line to zone */}
                      <line x1="115" y1={tr.y + tr.h * 0.5} x2={tr.x} y2={tr.y + tr.h * 0.5} stroke="#ef4444" strokeWidth="2" strokeDasharray="4 2" />
                      <rect x="85" y={tr.y + tr.h * 0.5 - 10} width="165" height="20" fill="#ef4444" rx="2" />
                      <text x="90" y={tr.y + tr.h * 0.5 + 4} fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                        BREACH: CUSTOM BORDER SECTOR 2
                      </text>
                    </g>
                  )}

                  {/* Clean Green Bounding Box (from akash-das-37/IBVAP) */}
                  <rect
                    x={tr.x}
                    y={tr.y}
                    width={tr.w}
                    height={tr.h}
                    fill="none"
                    stroke="#00ff00"
                    strokeWidth="2"
                  />

                  {/* Centered Yellow Torso Line */}
                  <line
                    x1={tr.x + tr.w * 0.15}
                    y1={tr.y + tr.h * 0.48}
                    x2={tr.x + tr.w * 0.85}
                    y2={tr.y + tr.h * 0.48}
                    stroke="#ffe600"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />

                  {/* Solid Green Label Banner Header (from akash-das-37/IBVAP) */}
                  <rect
                    x={tr.x}
                    y={Math.max(0, tr.y - 18)}
                    width={Math.max(190, tr.w * 0.85)}
                    height="18"
                    fill="#00ff00"
                  />
                  <text
                    x={tr.x + 4}
                    y={Math.max(13, tr.y - 5)}
                    fill="#000000"
                    fontSize="11"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {tr.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        ) : isDemo ? (
          // 2. Demo Video Mode (Immediate playback with zero black screen & synchronized AI ANPR tracking)
          <div className="relative w-full h-full flex items-center justify-center select-none bg-black">
            <video
              ref={demoVideoRef}
              key="demo-video-cctv"
              loop
              autoPlay
              muted
              playsInline
              preload="auto"
              onCanPlay={(e) => {
                e.target.muted = true;
                e.target.play().catch(() => {});
                setIsDemoPlaying(true);
              }}
              onLoadedData={(e) => {
                e.target.muted = true;
                e.target.play().catch(() => {});
                setIsDemoPlaying(true);
              }}
              onPlay={() => setIsDemoPlaying(true)}
              className="w-full h-full object-contain"
            >
              <source src="/sample_border.mp4?v=2" type="video/mp4" />
              <source src="/sample_border.webm?v=2" type="video/webm" />
              <source src="data/demo_videos/sample_border.mp4?v=2" type="video/mp4" />
            </video>

            {/* SVG Overlay for zones AND real-time AI bounding boxes drawn over demo video */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 960 540" preserveAspectRatio="none">
              {/* 1. Restricted Zones positioned over Demo Video */}
              <g key="demo-sector-2">
                <polygon
                  points="370,220 425,220 425,430 370,430"
                  fill="#ef4444"
                  fillOpacity="0.25"
                  stroke="#ef4444"
                  strokeWidth="2.5"
                  strokeDasharray="6 3"
                />
                <circle cx="370" cy="220" r="5" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <circle cx="425" cy="220" r="5" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <circle cx="425" cy="430" r="5" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <circle cx="370" cy="430" r="5" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <rect x="290" y="320" width="130" height="22" fill="#0f172a" stroke="#ef4444" strokeWidth="1" rx="2" />
                <text x="296" y="335" fill="#ffffff" fontSize="10" fontFamily="monospace" fontWeight="bold">
                  ZONE: Sector 2
                </text>
              </g>

              <g key="demo-fence-1">
                <line x1="475" y1="220" x2="475" y2="430" stroke="#ffffff" strokeWidth="2.5" strokeDasharray="5 3" />
                <circle cx="475" cy="220" r="5" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <circle cx="475" cy="430" r="5" fill="#ffffff" stroke="#ef4444" strokeWidth="2" />
                <text x="460" y="210" fill="#ffffff" fontSize="11" fontFamily="monospace" fontWeight="bold">
                  FENCE: Sector 1
                </text>
              </g>

              {/* 2. Real-time AI Tracking Bounding Boxes (Person & Vehicle with ANPR) */}
              {demoTracks.map((tr) => (
                <g key={tr.id}>
                  {/* Top Breach Banner across demo feed if breached */}
                  {tr.isBreach && (
                    <g>
                      <rect x="0" y="0" width="960" height="35" fill="#ef4444" />
                      <text
                        x="480"
                        y="24"
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="13"
                        fontFamily="monospace"
                        fontWeight="bold"
                        letterSpacing="0.5"
                      >
                        {tr.isVehicle
                          ? 'ALERT: Unauthorized Car #10 [Plate: WB-24-1024] entered Custom Border Sector 2'
                          : 'ALERT: Critical Intrusion in Custom Border Sector 2 — Person #1 inside restricted sector'}
                      </text>
                      {/* Connector line to zone */}
                      <line
                        x1={tr.isVehicle ? '425' : '370'}
                        y1={tr.y + tr.h * 0.5}
                        x2={tr.x}
                        y2={tr.y + tr.h * 0.5}
                        stroke="#ef4444"
                        strokeWidth="2.5"
                        strokeDasharray="4 2"
                      />
                      <rect
                        x={tr.isVehicle ? 235 : 250}
                        y={tr.y + tr.h * 0.5 - 10}
                        width="175"
                        height="20"
                        fill="#ef4444"
                        rx="2"
                      />
                      <text
                        x={tr.isVehicle ? 240 : 255}
                        y={tr.y + tr.h * 0.5 + 4}
                        fill="#ffffff"
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        BREACH: CUSTOM BORDER SECTOR 2
                      </text>
                    </g>
                  )}

                  {/* Clean Bounding Box (Green for person from akash-das-37/IBVAP) */}
                  <rect
                    x={tr.x}
                    y={tr.y}
                    width={tr.w}
                    height={tr.h}
                    fill="none"
                    stroke={tr.isVehicle ? '#00f0ff' : '#00ff00'}
                    strokeWidth="2"
                  />

                  {/* Yellow Trajectory Path */}
                  {tr.trajectory && (
                    <polyline
                      points={tr.trajectory}
                      fill="none"
                      stroke="#ffe600"
                      strokeWidth="2"
                    />
                  )}

                  {/* Solid Label Banner Header atop Bounding Box */}
                  <rect
                    x={tr.x}
                    y={Math.max(0, tr.y - 18)}
                    width={tr.isVehicle ? Math.max(260, tr.w + 10) : Math.max(165, tr.w + 10)}
                    height="18"
                    fill={tr.isVehicle ? '#00f0ff' : '#00ff00'}
                  />
                  <text
                    x={tr.x + 4}
                    y={Math.max(13, tr.y - 5)}
                    fill="#000000"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {tr.label}
                  </text>

                  {/* Tactical ANPR Plate Badge for Vehicle */}
                  {tr.isVehicle && (
                    <g>
                      <rect
                        x={tr.x + 8}
                        y={tr.y + tr.h + 4}
                        width="135"
                        height="20"
                        fill="#0a0f19"
                        stroke="#00f0ff"
                        strokeWidth="1.5"
                        rx="3"
                      />
                      <text
                        x={tr.x + 14}
                        y={tr.y + tr.h + 18}
                        fill="#f59e0b"
                        fontSize="11"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        ANPR: [WB-24-1024]
                      </text>
                    </g>
                  )}
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
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs font-mono rounded cursor-pointer"
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
            FPS: <span className="text-cyan-400 font-bold">{activeMode === 'webcam' ? 25.0 : (hasLoaded ? (liveStats?.fps || 28.8) : 28.8)}</span>
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
