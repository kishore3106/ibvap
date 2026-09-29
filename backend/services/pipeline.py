import os
import time
import json
import asyncio
import logging
import threading
from typing import List, Dict, Any, Optional
import cv2
import numpy as np
import requests

from backend.config import settings
from backend.camera.capture import VideoCaptureThread
from backend.camera.motion import EdgeMotionDetector
from backend.ai.detector import ObjectDetector
from backend.ai.tracker import ObjectTracker
from backend.ai.rules import SecurityRuleEngine, is_point_in_polygon, is_bbox_in_polygon
from backend.ai.anpr import ANPRPipeline
from backend.ai.lowlight import LowLightEnhancer
from backend.services.queue import EventQueue
from backend.alerts.engine import AlertEngine
from backend.websocket.manager import manager
from backend.database.session import SessionLocal
from backend.database.models import CameraModel, ZoneModel, EventModel

logger = logging.getLogger("ibvap.pipeline")

class AnalyticsPipeline:
    """
    Master Pipeline Orchestrator.
    Connects Camera Ingestion -> Edge Motion -> ByteTrack Tracking -> Security Rules -> Alert Generation -> WebSockets.
    """

    def __init__(self):
        self.camera_source = settings.CAMERA_SOURCE
        if settings.MODE == "demo":
            self.camera_source = "data/demo_videos/sample_border.mp4"

        # 1. Modules
        self.capture = VideoCaptureThread(source=self.camera_source)
        self.motion_detector = EdgeMotionDetector(
            sensitivity=settings.MOTION_SENSITIVITY,
            min_area=settings.MIN_MOTION_AREA
        )
        self.tracker = ObjectTracker(
            model_path=settings.YOLO_MODEL,
            conf_thresh=settings.CONFIDENCE_THRESHOLD,
            iou_thresh=settings.IOU_THRESHOLD
        )
        self.rules = SecurityRuleEngine(dwell_threshold_seconds=settings.DWELL_THRESHOLD_SECONDS)
        self.anpr = ANPRPipeline() if settings.ENABLE_ANPR else None
        self.lowlight = LowLightEnhancer()
        self.event_queue = EventQueue(redis_url=settings.REDIS_URL)
        self.alert_engine = AlertEngine(snapshot_dir=settings.SNAPSHOT_DIR)

        # 2. State
        self.is_running = False
        self.zones: List[Dict[str, Any]] = []
        self.current_organization_id: Optional[str] = None
        self.latest_annotated_frame: Optional[np.ndarray] = None
        self.latest_jpeg_bytes: Optional[bytes] = None
        self.latest_tracks: List[Dict[str, Any]] = []
        self.latest_violations: List[Dict[str, Any]] = []
        self.inference_frame: Optional[np.ndarray] = None
        self.active_alerts: List[Dict[str, Any]] = []
        self.fps = 0.0
        self.ai_fps = 0.0
        self.frame_count = 0
        self.loop = None
        self._lock = threading.Lock()
        self._worker_thread: Optional[threading.Thread] = None
        self._ai_thread: Optional[threading.Thread] = None

        # Load initial zones from database
        self._load_zones_from_db()

    def _load_zones_from_db(self):
        # 1. Local SQLite (fastest, guaranteed offline resilience)
        try:
            from backend.database.session import init_db
            init_db()
            db = SessionLocal()
            db_zones = db.query(ZoneModel).filter(ZoneModel.enabled == True).all()

            if db_zones:
                self.zones = []
                for z in db_zones:
                    self.zones.append({
                        "zone_id": z.zone_id,
                        "name": z.name,
                        "zone_type": z.zone_type,
                        "polygon_coords": json.loads(z.polygon_coords) if z.polygon_coords else [],
                        "line_coords": json.loads(z.line_coords) if z.line_coords else [],
                        "is_restricted": z.is_restricted,
                        "dwell_threshold": z.dwell_threshold,
                        "prohibited_directions": json.loads(z.prohibited_directions) if z.prohibited_directions else [],
                        "color": z.color,
                        "enabled": z.enabled
                    })
                logger.info(f"Loaded {len(self.zones)} active detection zone(s) from local database.")
                db.close()
                return
            db.close()
        except Exception as e:
            logger.error(f"Error loading zones from local database: {e}")

        # 2. Fallback to Supabase Cloud if SQLite has no zones
        try:
            url = f"{settings.SUPABASE_URL}/rest/v1/zones?enabled=eq.true&select=*"
            res = requests.get(url, headers={
                "apikey": settings.SUPABASE_KEY,
                "Authorization": f"Bearer {settings.SUPABASE_KEY}"
            }, timeout=3)
            if res.status_code == 200 and res.json():
                db_zones = res.json()
                self.zones = []
                for z in db_zones:
                    self.zones.append({
                        "zone_id": z.get("zone_id"),
                        "name": z.get("name"),
                        "zone_type": z.get("zone_type", "polygon"),
                        "polygon_data": z.get("polygon_data") or [],
                        "polygon_coords": z.get("polygon_coords") or [],
                        "line_coords": z.get("line_coords") or [],
                        "is_restricted": z.get("is_restricted", True),
                        "dwell_threshold": z.get("dwell_threshold", 10.0),
                        "prohibited_directions": z.get("prohibited_directions") or [],
                        "color": z.get("color", "#ef4444"),
                        "organization_id": z.get("organization_id"),
                        "enabled": z.get("enabled", True)
                    })
                logger.info(f"Loaded {len(self.zones)} active detection zone(s) from Supabase Cloud.")
        except Exception as e:
            logger.debug(f"Supabase zone load skipped: {e}")


    def update_zones(self, new_zones: List[Dict[str, Any]], organization_id: Optional[str] = None):
        with self._lock:
            self.zones = new_zones
            if organization_id:
                self.current_organization_id = organization_id
            logger.info(f"Updated in-memory zones: {len(new_zones)} zones active (org: {self.current_organization_id}).")

    def set_camera_source(self, new_source: str):
        with self._lock:
            logger.info(f"Switching camera source to: {new_source}")
            self.capture.stop()
            self.camera_source = new_source
            self.capture = VideoCaptureThread(source=new_source).start()

    def ingest_external_frame(self, frame: np.ndarray):
        """Allows direct ingestion of client-side webcam frames streamed from browser."""
        with self._lock:
            self.capture.current_frame = frame
            self.capture.last_frame_time = time.time()
            self.capture.is_connected = True
            self.capture.fps = 25.0
            self.capture.is_webcam = True
            self.capture.raw_source = "browser_webcam"
            self.capture.parsed_source = "browser_webcam"
            self.inference_frame = frame

    def start(self, event_loop=None):
        if self.is_running:
            return
        self.is_running = True
        self.loop = event_loop
        self.capture.start()
        self._worker_thread = threading.Thread(target=self._pipeline_loop, daemon=True, name="VideoRenderWorker")
        self._worker_thread.start()
        self._ai_thread = threading.Thread(target=self._ai_inference_worker, daemon=True, name="AIInferenceWorker")
        self._ai_thread.start()
        logger.info("AnalyticsPipeline render & AI worker threads started.")

    def stop(self):
        self.is_running = False
        self.capture.stop()
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=1.0)
        if self._ai_thread and self._ai_thread.is_alive():
            self._ai_thread.join(timeout=1.0)
        logger.info("AnalyticsPipeline stopped.")

    def _pipeline_loop(self):
        """High-speed 25-30 FPS video capture and rendering loop for smooth, zero-stutter live display."""
        last_time = time.time()
        frames_in_sec = 0
        last_stats_broadcast = 0.0
        last_rendered_ts = 0.0

        while self.is_running:
            ret, frame, timestamp = self.capture.read()
            if not ret or frame is None:
                time.sleep(0.005)
                continue

            # Skip redundant re-renders of the exact same camera frame
            if timestamp > 0 and timestamp == last_rendered_ts:
                time.sleep(0.005)
                continue
            last_rendered_ts = timestamp

            now = time.time()
            self.frame_count += 1
            frames_in_sec += 1
            if now - last_time >= 1.0:
                self.fps = round(frames_in_sec / (now - last_time), 1)
                frames_in_sec = 0
                last_time = now

            with self._lock:
                self.inference_frame = frame
                tracks = list(self.latest_tracks)
                violations = list(self.latest_violations)
                current_zones = list(self.zones)

            h, w = frame.shape[:2]
            scaled_zones = self._scale_zones_to_frame(current_zones, w, h)

            # Render Annotated Frame for Live Video Output at full 25-30 FPS!
            annotated_frame = self._draw_annotations(frame.copy(), tracks, scaled_zones, violations)
            ret_enc, buf_enc = cv2.imencode('.jpg', annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            encoded_bytes = buf_enc.tobytes() if ret_enc else None

            with self._lock:
                self.latest_annotated_frame = annotated_frame
                self.latest_jpeg_bytes = encoded_bytes

            # Broadcast real-time telemetry every 0.5s
            if (now - last_stats_broadcast >= 0.5) and self.loop and not self.loop.is_closed():
                last_stats_broadcast = now
                person_count = sum(1 for t in tracks if t.get("class_name") == "person")
                vehicle_count = sum(1 for t in tracks if t.get("class_name") in ["car", "bus", "truck", "motorcycle"])
                meta = self.capture.get_metadata()

                asyncio.run_coroutine_threadsafe(
                    manager.broadcast_stats({
                        "type": "STATS_UPDATE",
                        "data": {
                            "camera_id": settings.CAMERA_ID,
                            "fps": self.fps,
                            "camera_status": "ONLINE" if meta.get("is_connected") else "OFFLINE",
                            "person_count": person_count,
                            "vehicle_count": vehicle_count,
                            "active_alerts_count": len(self.active_alerts),
                            "source_type": meta.get("type", "webcam"),
                            "timestamp": now
                        }
                    }),
                    self.loop
                )

    def _ai_inference_worker(self):
        """Asynchronous background worker dedicated to YOLO ByteTrack and security rule checking."""
        logger.info("AI Inference background worker started.")
        ai_last_time = time.time()
        ai_frames = 0

        while self.is_running:
            with self._lock:
                frame_to_process = self.inference_frame
                current_zones = list(self.zones)

            if frame_to_process is None:
                time.sleep(0.01)
                continue

            now = time.time()
            ai_frames += 1
            if now - ai_last_time >= 1.0:
                self.ai_fps = round(ai_frames / (now - ai_last_time), 1)
                ai_frames = 0
                ai_last_time = now

            processed_frame = frame_to_process

            has_motion = True
            if settings.MOTION_FILTER_ENABLED:
                try:
                    has_motion, _, _ = self.motion_detector.detect(processed_frame)
                except Exception:
                    has_motion = True

            tracks = []
            if has_motion or (self.frame_count % 4 == 0):
                try:
                    tracks = self.tracker.track(processed_frame, timestamp=now)
                except Exception as e:
                    logger.debug(f"Tracker error: {e}")

            # 3B. In Demo Video Mode, detect and track synthetic surveillance vehicle
            if getattr(self.capture, "is_file", False):
                try:
                    v_mask = cv2.inRange(processed_frame, np.array([140, 40, 30]), np.array([180, 60, 50]))
                    v_cnts, _ = cv2.findContours(v_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    for c in v_cnts:
                        if cv2.contourArea(c) > 600:
                            vx, vy, vw, vh = cv2.boundingRect(c)
                            if vw > 80:
                                vx1, vy1, vx2, vy2 = vx, max(0, vy - 35), vx + vw, vy + vh
                                v_cx = int((vx1 + vx2) / 2)
                                v_cy = int((vy1 + vy2) / 2)
                                v_trk = {
                                    "track_id": 10,
                                    "class_name": "car",
                                    "bbox": [vx1, vy1, vx2, vy2],
                                    "center": (v_cx, v_cy),
                                    "confidence": 0.94,
                                    "dwell_time": 0.0,
                                    "direction": "LEFT",
                                    "trajectory": [(v_cx, v_cy)],
                                    "plate_number": "WB-24-1024",
                                    "plate_confidence": "High Confidence"
                                }
                                tracks.append(v_trk)
                except Exception as ex:
                    logger.debug(f"Demo vehicle detection: {ex}")

            # 4. Optional ANPR on Vehicles
            if self.anpr and tracks:
                for trk in tracks:
                    if trk.get("class_name") in ["car", "bus", "truck"] and "plate_number" not in trk:
                        plate_data = self.anpr.read_plate(processed_frame, trk.get("bbox", []), trk.get("track_id"))
                        if plate_data:
                            trk["plate_number"] = plate_data["plate_number"]
                            trk["plate_confidence"] = plate_data["confidence_level"]

            # 5. Security Rule Engine Evaluation
            h, w = frame_to_process.shape[:2]
            scaled_zones = self._scale_zones_to_frame(current_zones, w, h)
            violations = self.rules.evaluate(tracks, scaled_zones, now=now)

            # 6. Process Rule Violations & Emit Alerts
            for violation in violations:
                self.event_queue.publish({
                    "event_id": f"EQ-{int(now * 1000)}",
                    "camera_id": settings.CAMERA_ID,
                    "timestamp": now,
                    "event_type": violation["rule_type"],
                    "priority": violation["severity"],
                    "zone": violation.get("zone_name")
                })

                target_org = violation.get("organization_id") or self.current_organization_id
                annotated_snapshot = self._draw_annotations(frame_to_process.copy(), tracks, scaled_zones, [violation])
                alert = self.alert_engine.process_violation(
                    camera_id=settings.CAMERA_ID,
                    violation=violation,
                    frame=annotated_snapshot,
                    organization_id=target_org
                )

                with self._lock:
                    self.active_alerts.insert(0, alert)
                    if len(self.active_alerts) > 20:
                        self.active_alerts.pop()

                if self.loop and not self.loop.is_closed():
                    dispatch_org = target_org or "default-org"
                    asyncio.run_coroutine_threadsafe(
                        manager.send_to_org(dispatch_org, {
                            "type": "NEW_ALERT",
                            "data": alert
                        }),
                        self.loop
                    )

            with self._lock:
                self.latest_tracks = tracks
                self.latest_violations = violations

            time.sleep(0.01)

    def _scale_zones_to_frame(self, zones: List[Dict[str, Any]], frame_w: int, frame_h: int) -> List[Dict[str, Any]]:
        scaled_zones = []
        for z in zones:
            sz = dict(z)
            pts = sz.get("polygon_data") or sz.get("polygon_coords")
            if pts:
                sz["polygon_coords"] = self._scale_coords(pts, frame_w, frame_h)
            if sz.get("line_coords"):
                sz["line_coords"] = self._scale_coords(sz["line_coords"], frame_w, frame_h)
            scaled_zones.append(sz)
        return scaled_zones

    def _scale_coords(self, coords: List[Any], frame_w: int, frame_h: int) -> List[List[int]]:
        if not coords:
            return []
        try:
            standard_pts = []
            for pt in coords:
                if isinstance(pt, dict) and "x" in pt and "y" in pt:
                    standard_pts.append((float(pt["x"]), float(pt["y"])))
                elif isinstance(pt, (list, tuple)) and len(pt) >= 2:
                    standard_pts.append((float(pt[0]), float(pt[1])))

            if not standard_pts:
                return []

            max_val = max(max(abs(x), abs(y)) for x, y in standard_pts)
            is_norm = max_val <= 1.5
            is_canvas_960 = not is_norm and all(x <= 960 and y <= 540 for x, y in standard_pts)

            scaled = []
            for x, y in standard_pts:
                if is_norm:
                    cx = max(0.0, min(1.0, x))
                    cy = max(0.0, min(1.0, y))
                    sx = int(round(cx * frame_w))
                    sy = int(round(cy * frame_h))
                elif is_canvas_960:
                    sx = int(round(max(0.0, min(960.0, x)) * (frame_w / 960.0)))
                    sy = int(round(max(0.0, min(540.0, y)) * (frame_h / 540.0)))
                else:
                    sx = int(round(max(0.0, min(float(frame_w), x))))
                    sy = int(round(max(0.0, min(float(frame_h), y))))
                scaled.append([sx, sy])
            return scaled
        except Exception as e:
            logger.error(f"Error scaling coords: {e}")
            return coords

    def _draw_annotations(
        self,
        frame: np.ndarray,
        tracks: List[Dict[str, Any]],
        zones: List[Dict[str, Any]],
        violations: List[Dict[str, Any]]
    ) -> np.ndarray:
        # Detect dark frame / closed physical shutter
        if np.mean(frame) < 1.0:
            h, w = frame.shape[:2]
            cv2.rectangle(frame, (10, 10), (w - 10, h - 10), (45, 55, 72), 1)
            cv2.putText(frame, "IBVAP DEFENSE EDGE // WEBCAM HARDWARE ACTIVE", (30, 45),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 240, 255), 2, cv2.LINE_AA)
            cv2.putText(frame, "CAMERA SENSOR DARK / LENS COVERED", (30, h // 2 - 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 165, 255), 2, cv2.LINE_AA)
            cv2.putText(frame, "Slide open laptop physical webcam shutter,", (30, h // 2 + 18),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (203, 213, 225), 1, cv2.LINE_AA)
            cv2.putText(frame, "or click CHANGE SOURCE to select Demo Video / IP Cam.", (30, h // 2 + 42),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, (148, 163, 184), 1, cv2.LINE_AA)

        # 1. Detect active intrusions (persistent while target remains inside restricted polygon)
        active_intruders = set()
        active_intruder_names = {}
        breached_zone_ids = set()
        for trk in tracks:
            t_center = trk.get("center", (0, 0))
            t_bbox = trk.get("bbox", [])
            for zone in zones:
                if not zone.get("enabled", True) or not zone.get("is_restricted", True):
                    continue
                zid = zone.get("zone_id", "")
                if zone.get("zone_type") == "polygon":
                    poly = zone.get("polygon_coords", [])
                    if len(poly) >= 3 and (is_point_in_polygon(t_center, poly) or (t_bbox and is_bbox_in_polygon(t_bbox, poly))):
                        active_intruders.add(trk["track_id"])
                        active_intruder_names[trk["track_id"]] = zone.get("name", "Restricted Area")
                        breached_zone_ids.add(zid)
                        break

        for v in violations:
            if v.get("track_id") is not None:
                active_intruders.add(v["track_id"])
            if v.get("zone_id"):
                breached_zone_ids.add(v["zone_id"])

        violating_track_ids = active_intruders

        # 2. Draw Translucent Zone Background Fills
        overlay = frame.copy()
        for zone in zones:
            color_hex = zone.get("color", "#ef4444").lstrip("#")
            try:
                r, g, b = tuple(int(color_hex[i:i+2], 16) for i in (0, 2, 4))
                bgr = (b, g, r)
            except Exception:
                bgr = (0, 0, 255)

            if zone.get("zone_type") == "polygon":
                coords = zone.get("polygon_coords", [])
                if len(coords) >= 3:
                    pts = np.array(coords, np.int32).reshape((-1, 1, 2))
                    fill_bgr = (0, 0, 255) if zone.get("zone_id") in breached_zone_ids else bgr
                    cv2.fillPoly(overlay, [pts], fill_bgr)
            elif zone.get("zone_type") == "tripwire":
                line = zone.get("line_coords", [])
                if len(line) == 2:
                    p1, p2 = tuple(line[0]), tuple(line[1])
                    cv2.line(overlay, p1, p2, bgr, 6)

        # Blend transparent zone fill onto frame
        cv2.addWeighted(overlay, 0.30, frame, 0.70, 0, frame)

        # 3. Draw Crisp, Full-Opacity Solid Zone Outlines & Badges
        for zone in zones:
            zid = zone.get("zone_id", "")
            is_breached = zid in breached_zone_ids
            color_hex = zone.get("color", "#ef4444").lstrip("#")
            try:
                r, g, b = tuple(int(color_hex[i:i+2], 16) for i in (0, 2, 4))
                bgr = (b, g, r)
            except Exception:
                bgr = (0, 0, 255)

            line_color = (0, 0, 255) if is_breached else bgr
            line_thickness = 4 if is_breached else 3

            if zone.get("zone_type") == "polygon":
                coords = zone.get("polygon_coords", [])
                if len(coords) >= 3:
                    pts = np.array(coords, np.int32).reshape((-1, 1, 2))
                    # Crisp border outline
                    cv2.polylines(frame, [pts], True, line_color, line_thickness, cv2.LINE_AA)
                    # Corner vertex nodes
                    for pt in coords:
                        cv2.circle(frame, (int(pt[0]), int(pt[1])), 5, (255, 255, 255), -1)
                        cv2.circle(frame, (int(pt[0]), int(pt[1])), 3, line_color, -1)

                    # Zone Tactical Header Label
                    cx = int(np.mean([p[0] for p in coords]))
                    cy = int(np.mean([p[1] for p in coords]))
                    if is_breached:
                        zone_label = f"BREACH! {zone.get('name', 'SECTOR').upper()}"
                        bg_box_color = (0, 0, 200)
                    else:
                        zone_label = f"ZONE: {zone.get('name', 'SECTOR')}"
                        bg_box_color = (15, 23, 42)

                    (zw, zh), _ = cv2.getTextSize(zone_label, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
                    cv2.rectangle(frame, (cx - zw // 2 - 8, cy - zh // 2 - 6),
                                  (cx + zw // 2 + 8, cy + zh // 2 + 6), bg_box_color, -1)
                    cv2.rectangle(frame, (cx - zw // 2 - 8, cy - zh // 2 - 6),
                                  (cx + zw // 2 + 8, cy + zh // 2 + 6), line_color, 1)
                    cv2.putText(frame, zone_label, (cx - zw // 2, cy + zh // 2),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)

            elif zone.get("zone_type") == "tripwire":
                line = zone.get("line_coords", [])
                if len(line) == 2:
                    p1, p2 = tuple(line[0]), tuple(line[1])
                    cv2.line(frame, p1, p2, (255, 255, 255), 2, cv2.LINE_AA)
                    cv2.circle(frame, p1, 7, line_color, -1)
                    cv2.circle(frame, p2, 7, line_color, -1)
                    cv2.putText(frame, f"FENCE: {zone.get('name')}", (p1[0] + 8, max(p1[1] - 10, 25)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.52, line_color, 2, cv2.LINE_AA)

        # Draw Tracked Objects
        for trk in tracks:
            x1, y1, x2, y2 = trk["bbox"]
            cls_name = trk["class_name"]
            track_id = trk["track_id"]
            conf = trk["confidence"]
            dwell = trk.get("dwell_time", 0.0)
            direction = trk.get("direction", "")
            is_violating = track_id in violating_track_ids

            # Tactical color coding: Green for person, amber for vehicle (from akash-das-37/IBVAP)
            box_color = (0, 255, 0) if cls_name == "person" else (255, 180, 0)
            box_thickness = 2

            # Bounding box
            cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, box_thickness)

            # Label banner
            label = f"{cls_name.upper()} #{track_id} ({conf:.2f})"
            if dwell > 2.0:
                label += f" | {dwell:.1f}s"
            if direction and direction != "STATIONARY":
                label += f" [{direction}]"

            # Check if license plate is recognized
            if "plate_number" in trk:
                label += f" | {trk['plate_number']}"

            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            cv2.rectangle(frame, (x1, max(0, y1 - th - 8)), (x1 + tw + 8, y1), box_color, -1)
            cv2.putText(frame, label, (x1 + 4, max(th + 2, y1 - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)

            # Prominent Tactical ANPR License Plate Badge underneath vehicle
            if "plate_number" in trk:
                p_text = f"ANPR: [{trk['plate_number']}]"
                (pw, ph), _ = cv2.getTextSize(p_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                by1 = min(frame.shape[0] - ph - 10, y2 + 3)
                by2 = by1 + ph + 8
                cv2.rectangle(frame, (x1, by1), (x1 + pw + 8, by2), (10, 15, 25), -1)
                cv2.rectangle(frame, (x1, by1), (x1 + pw + 8, by2), (0, 240, 255), 1)
                cv2.putText(frame, p_text, (x1 + 4, by1 + ph + 2),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 240, 255), 1, cv2.LINE_AA)

            # Draw trajectory path
            trajectory = trk.get("trajectory", [])
            if len(trajectory) > 1:
                pts = np.array(trajectory, np.int32).reshape((-1, 1, 2))
                traj_color = (0, 0, 255) if is_violating else (0, 230, 255)
                cv2.polylines(frame, [pts], False, traj_color, 2)

        # 3. Violation Alerts Top Banner (Active Breach)
        if violations or active_intruders:
            if violations:
                banner_text = f"CRITICAL ALERT: {violations[0]['description']}"
            else:
                banner_text = f"RESTRICTED BREACH: Target inside restricted perimeter zone"
            cv2.rectangle(frame, (0, 0), (frame.shape[1], 36), (0, 0, 220), -1)
            cv2.putText(frame, banner_text, (20, 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255, 255, 255), 2, cv2.LINE_AA)

        return frame


    def get_latest_jpeg(self) -> Optional[bytes]:
        with self._lock:
            if self.latest_jpeg_bytes is not None:
                return self.latest_jpeg_bytes
            if self.latest_annotated_frame is None:
                return None
            ret, buffer = cv2.imencode('.jpg', self.latest_annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
            if ret:
                self.latest_jpeg_bytes = buffer.tobytes()
                return self.latest_jpeg_bytes
            return None

# Global pipeline singleton
pipeline = AnalyticsPipeline()
