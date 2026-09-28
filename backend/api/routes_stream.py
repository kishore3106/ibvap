import time
import cv2
import numpy as np
from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse

from backend.services.pipeline import pipeline

router = APIRouter(prefix="/api/v1/stream", tags=["Streaming"])

_standby_frame_bytes = None

def get_standby_frame() -> bytes:
    """Generates a tactical placeholder frame when the camera is connecting or re-initializing."""
    global _standby_frame_bytes
    if _standby_frame_bytes is None:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[:] = (13, 17, 23)  # Dark tactical slate (#0d1117)
        # Tactical border
        cv2.rectangle(frame, (12, 12), (628, 468), (40, 50, 65), 1)
        # Radar scan line placeholder
        cv2.line(frame, (12, 240), (628, 240), (0, 100, 120), 1)
        # Text
        cv2.putText(frame, "IBVAP DEFENSE EDGE // CONNECTING FEED...", (80, 220),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 240, 255), 2, cv2.LINE_AA)
        cv2.putText(frame, "INITIALIZING IP WEBCAM / SENSOR HARDWARE", (110, 260),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (148, 163, 184), 1, cv2.LINE_AA)
        cv2.putText(frame, "ENSURE SMARTPHONE IP WEBCAM APP IS ACTIVE ON NETWORK", (70, 300),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, (100, 116, 139), 1, cv2.LINE_AA)
        ret, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        if ret:
            _standby_frame_bytes = buffer.tobytes()
        else:
            _standby_frame_bytes = b""
    return _standby_frame_bytes

import asyncio

async def generate_mjpeg():
    """Generates continuous MJPEG multipart stream from pipeline's latest annotated frame."""
    last_count = -1
    try:
        while True:
            cur_count = pipeline.frame_count
            if cur_count != last_count:
                jpeg_bytes = pipeline.get_latest_jpeg()
                if jpeg_bytes is None:
                    jpeg_bytes = get_standby_frame()

                if jpeg_bytes:
                    yield (
                        b'--frame\r\n'
                        b'Content-Type: image/jpeg\r\n\r\n' + jpeg_bytes + b'\r\n'
                    )
                    last_count = cur_count
            await asyncio.sleep(0.025)
    except (asyncio.CancelledError, GeneratorExit):
        pass

@router.get("/video_feed")
async def video_feed():
    """MJPEG Live video stream with real-time AI bounding boxes, tracking IDs, and zone overlays."""
    return StreamingResponse(
        generate_mjpeg(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "Access-Control-Allow-Origin": "*"
        }
    )

@router.get("/snapshot")
def get_snapshot():
    """Returns the latest annotated JPEG snapshot."""
    jpeg_bytes = pipeline.get_latest_jpeg()
    if jpeg_bytes is None:
        jpeg_bytes = get_standby_frame()
    return Response(content=jpeg_bytes, media_type="image/jpeg")

@router.get("/snapshot/raw")
def get_raw_snapshot():
    """Returns a clean unannotated camera frame — used as background for the zone editor canvas."""
    with pipeline._lock:
        raw_frame = pipeline.capture.current_frame
        if raw_frame is None:
            return Response(content=get_standby_frame(), media_type="image/jpeg",
                            headers={"Cache-Control": "no-store"})
        frame_copy = raw_frame.copy()
    ret, buffer = cv2.imencode('.jpg', frame_copy, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    if not ret:
        return Response(content=get_standby_frame(), media_type="image/jpeg",
                        headers={"Cache-Control": "no-store"})
    return Response(content=buffer.tobytes(), media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})

@router.get("/debug_camera")
def debug_camera():
    meta = pipeline.capture.get_metadata()
    return {
        "pipeline_running": pipeline.is_running,
        "camera_source": pipeline.camera_source,
        "has_annotated_frame": pipeline.latest_annotated_frame is not None,
        "capture_metadata": meta,
        "capture_is_running": pipeline.capture.is_running,
        "capture_is_connected": pipeline.capture.is_connected,
        "capture_cap_is_none": pipeline.capture.cap is None,
        "capture_cap_is_opened": pipeline.capture.cap.isOpened() if pipeline.capture.cap else False
    }

@router.get("/live_stats")
def get_live_stats():
    """Returns current real-time telemetry from the live AI detection pipeline."""
    with pipeline._lock:
        tracks = list(pipeline.latest_tracks) if hasattr(pipeline, "latest_tracks") else []
        fps_val = round(pipeline.fps, 1)
        ai_fps_val = round(getattr(pipeline, "ai_fps", 0.0), 1)
        active_cnt = len(pipeline.active_alerts)
    person_cnt = sum(1 for t in tracks if t.get("class_name") == "person")
    veh_cnt = sum(1 for t in tracks if t.get("class_name") in ["car", "bus", "truck", "motorcycle"])
    meta = pipeline.capture.get_metadata()
    effective_fps = max(fps_val, ai_fps_val)
    return {
        "camera_id": "CAM-01",
        "fps": effective_fps,
        "video_fps": fps_val,
        "ai_fps": ai_fps_val,
        "camera_status": "ONLINE" if meta.get("is_connected") else "OFFLINE",
        "person_count": person_cnt,
        "vehicle_count": veh_cnt,
        "active_alerts_count": active_cnt,
        "source_type": meta.get("type", "webcam"),
        "timestamp": time.time()
    }


