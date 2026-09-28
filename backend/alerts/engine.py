import os
import uuid
import time
import datetime
import logging
import concurrent.futures
import threading
from typing import Optional, Dict, Any, List
import cv2
import numpy as np
import requests

from backend.config import settings
from backend.database.session import SessionLocal
from backend.database.models import AlertModel, EventModel

logger = logging.getLogger("ibvap.alerts")

# Known operator accounts per surveillance tenant organization
_ORG_OPERATORS = {
    "11111111-1111-1111-1111-111111111111": ("iamnegative37@gmail.com", "Surveillance2026!"),
    "22222222-2222-2222-2222-222222222222": ("akashdas200x@gmail.com", "Surveillance2026!"),
}
_DEFAULT_OPERATOR = ("iamnegative37@gmail.com", "Surveillance2026!")

class AlertEngine:
    """
    Synthesizes rule violations and security triggers into structured alerts.
    Persists alert records, uploads evidence snapshots to Supabase Cloud Storage,
    grades severity, and forwards alerts.
    
    IMPORTANT: Uses authenticated Supabase JWT per organization (not the anon key)
    for all writes so that RLS policies based on auth.uid() are satisfied for the tenant.
    """

    def __init__(self, snapshot_dir: str = "data/snapshots"):
        self.snapshot_dir = snapshot_dir
        os.makedirs(self.snapshot_dir, exist_ok=True)
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix="SupabaseSnapshotWorker")
        
        # Cached authenticated JWTs keyed by organization_id: { org_id: { "token": str, "expiry": float } }
        self._org_tokens: Dict[str, Dict[str, Any]] = {}
        self._auth_lock = threading.Lock()
        self._email_cooldown: Dict[str, float] = {}

    def register_org_token(self, organization_id: str, token: str, expires_in: int = 3600):
        """Allows active tenant sessions (from WebSockets or REST) to register their valid JWT directly."""
        if not organization_id or not token:
            return
        with self._auth_lock:
            self._org_tokens[organization_id] = {
                "token": token,
                "expiry": time.time() + expires_in
            }
        logger.info(f"AlertEngine cached operator token for org {organization_id}")

    def _get_authenticated_headers(self, organization_id: Optional[str] = None) -> Dict[str, str]:
        """
        Returns Supabase REST headers using an authenticated user JWT for the specified organization.
        The anon key alone cannot satisfy RLS policies that check auth.uid().
        This method retrieves a cached session token or authenticates as the org's service operator.
        """
        now = time.time()
        
        # 1. Return cached token if valid
        if organization_id and organization_id in self._org_tokens:
            cached = self._org_tokens[organization_id]
            if now < (cached["expiry"] - 120):
                return {
                    "apikey": settings.SUPABASE_KEY,
                    "Authorization": f"Bearer {cached['token']}",
                    "Content-Type": "application/json"
                }
        
        with self._auth_lock:
            if organization_id and organization_id in self._org_tokens:
                cached = self._org_tokens[organization_id]
                if now < (cached["expiry"] - 120):
                    return {
                        "apikey": settings.SUPABASE_KEY,
                        "Authorization": f"Bearer {cached['token']}",
                        "Content-Type": "application/json"
                    }
            
            # 2. Determine credentials for this tenant
            creds = _ORG_OPERATORS.get(organization_id, _DEFAULT_OPERATOR)
            email, password = creds
            try:
                auth_url = f"{settings.SUPABASE_URL}/auth/v1/token?grant_type=password"
                res = requests.post(auth_url, headers={
                    "apikey": settings.SUPABASE_KEY,
                    "Content-Type": "application/json"
                }, json={
                    "email": email,
                    "password": password
                }, timeout=10)
                
                if res.status_code == 200:
                    data = res.json()
                    token = data.get("access_token")
                    expires_in = data.get("expires_in", 3600)
                    if organization_id:
                        self._org_tokens[organization_id] = {
                            "token": token,
                            "expiry": now + expires_in
                        }
                    logger.info(f"AlertEngine authenticated as {email} for org {organization_id}, JWT valid for {expires_in}s")
                    return {
                        "apikey": settings.SUPABASE_KEY,
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"
                    }
                else:
                    logger.error(f"AlertEngine auth failed for {email} ({res.status_code}): {res.text[:200]}")
            except Exception as e:
                logger.error(f"AlertEngine auth exception for {email}: {e}")
        
        # Fallback to anon key
        return {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {settings.SUPABASE_KEY}",
            "Content-Type": "application/json"
        }

    def _upload_snapshot_to_supabase(self, jpeg_bytes: bytes, filename: str, organization_id: Optional[str] = None):
        if not organization_id or organization_id == "default-org":
            return
        try:
            url = f"{settings.SUPABASE_URL}/storage/v1/object/{settings.SUPABASE_STORAGE_BUCKET}/{filename}"
            auth_headers = self._get_authenticated_headers(organization_id)
            headers = {
                "Authorization": auth_headers["Authorization"],
                "apikey": settings.SUPABASE_KEY,
                "Content-Type": "image/jpeg",
                "x-upsert": "true"
            }
            res = requests.post(url, headers=headers, data=jpeg_bytes, timeout=2)
            if res.status_code in [200, 201]:
                logger.info(f"Uploaded evidence snapshot {filename} to Supabase Storage.")
            else:
                logger.debug(f"Supabase Storage snapshot upload returned {res.status_code}")
        except Exception as e:
            logger.debug(f"Supabase snapshot upload skipped/failed: {e}")


    def _persist_alert_worker(
        self,
        alert_dict: Dict[str, Any],
        event_id: str,
        frame: Optional[np.ndarray],
        filename: Optional[str],
        organization_id: Optional[str]
    ):
        """Asynchronous worker: saves snapshot, writes to SQLite, uploads to Supabase, and dispatches email."""
        # 1. Save local snapshot & upload to cloud
        if frame is not None and frame.size > 0 and filename:
            try:
                local_path = os.path.join(self.snapshot_dir, filename)
                cv2.imwrite(local_path, frame)
            except Exception as e:
                logger.debug(f"Local snapshot backup failed: {e}")

            try:
                ret, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                if ret:
                    self._upload_snapshot_to_supabase(buf.tobytes(), filename, organization_id)
            except Exception:
                pass

        # 2. Commit to local SQLite database
        try:
            db = SessionLocal()
            local_alert = AlertModel(
                alert_id=alert_dict["alert_id"],
                event_type=alert_dict["event_type"],
                severity=alert_dict["severity"],
                camera_id=alert_dict["camera_id"],
                zone_id=alert_dict.get("zone_id"),
                zone_name=alert_dict.get("zone_name"),
                object_type=alert_dict.get("object_type"),
                track_id=alert_dict.get("track_id"),
                confidence=alert_dict.get("confidence", 0.0),
                description=alert_dict.get("description", ""),
                snapshot_path=alert_dict.get("snapshot_path"),
                status="NEW"
            )
            local_event = EventModel(
                event_id=event_id,
                camera_id=alert_dict["camera_id"],
                event_type=alert_dict["event_type"],
                object_type=alert_dict.get("object_type"),
                track_id=alert_dict.get("track_id"),
                confidence=alert_dict.get("confidence", 0.0),
                plate_number=alert_dict.get("plate_number"),
                plate_confidence=alert_dict.get("plate_confidence"),
                zone_name=alert_dict.get("zone_name"),
                snapshot_path=alert_dict.get("snapshot_path")
            )
            db.add(local_alert)
            db.add(local_event)
            db.commit()
            db.close()
        except Exception as err:
            logger.debug(f"Local alert SQLite commit error: {err}")

        # 3. Automated Email Incident Report Dispatch
        try:
            from backend.services.email_service import get_email_config, send_alert_email_report
            em_conf = get_email_config()
            now_sec = time.time()
            cooldown_key = f"{alert_dict.get('zone_id') or alert_dict.get('zone_name')}_{alert_dict.get('event_type')}"
            last_sent = self._email_cooldown.get(cooldown_key, 0.0)

            if em_conf.get("enabled") and em_conf.get("recipient_email") and (now_sec - last_sent >= 10.0):
                self._email_cooldown[cooldown_key] = now_sec
                logger.info(f"Auto-dispatching breach alert {alert_dict['alert_id']} to {em_conf['recipient_email']}")
                send_alert_email_report(
                    em_conf["recipient_email"],
                    alert_dict,
                    None,
                    alert_dict.get("snapshot_path")
                )
        except Exception as ex:
            logger.debug(f"Email dispatch trigger error: {ex}")

        # 4. Optional Supabase remote sync
        if organization_id and organization_id != "default-org":
            try:
                headers = self._get_authenticated_headers(organization_id)
                requests.post(
                    f"{settings.SUPABASE_URL}/rest/v1/alerts",
                    headers=headers,
                    json={
                        "alert_id": alert_dict["alert_id"],
                        "organization_id": organization_id,
                        "event_type": alert_dict["event_type"],
                        "severity": alert_dict["severity"],
                        "camera_id": alert_dict["camera_id"],
                        "zone_id": alert_dict.get("zone_id"),
                        "zone_name": alert_dict.get("zone_name"),
                        "object_type": alert_dict.get("object_type"),
                        "track_id": alert_dict.get("track_id"),
                        "confidence": alert_dict.get("confidence"),
                        "description": alert_dict.get("description"),
                        "snapshot_path": alert_dict.get("snapshot_path"),
                        "status": "NEW",
                        "timestamp": alert_dict["timestamp"]
                    },
                    timeout=4
                )
            except Exception:
                pass

    def process_violation(
        self,
        camera_id: str,
        violation: Dict[str, Any],
        frame: Optional[np.ndarray] = None,
        organization_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Creates an alert instantly and delegates heavy disk/DB/cloud persistence to background thread.
        This keeps the real-time AI video pipeline running at maximum hardware FPS without hitching.
        """
        alert_id = f"ALT-{uuid.uuid4().hex[:8].upper()}"
        event_id = f"EVT-{uuid.uuid4().hex[:8].upper()}"
        rule_type = violation.get("rule_type", "INTRUSION")
        severity = violation.get("severity", "HIGH")
        obj_type = violation.get("object_type", "unknown")
        track_id = violation.get("track_id")
        conf = float(violation.get("confidence", 0.0))
        zone_id = violation.get("zone_id")
        zone_name = violation.get("zone_name", "Perimeter")
        desc = violation.get("description", f"{severity} Alert: {rule_type} by {obj_type}")
        now_dt = datetime.datetime.utcnow()
        now_iso = now_dt.isoformat()

        filename = None
        local_snapshot_url = None
        if frame is not None and frame.size > 0:
            filename = f"{alert_id}_{int(time.time())}.jpg"
            local_snapshot_url = f"/data/snapshots/{filename}"

        alert_dict = {
            "alert_id": alert_id,
            "organization_id": organization_id,
            "event_type": rule_type,
            "severity": severity,
            "camera_id": camera_id,
            "zone_id": zone_id,
            "zone_name": zone_name,
            "object_type": obj_type,
            "track_id": track_id,
            "confidence": conf,
            "plate_number": violation.get("plate_number"),
            "plate_confidence": violation.get("plate_confidence"),
            "description": desc,
            "snapshot_path": local_snapshot_url,
            "timestamp": now_iso,
            "status": "NEW"
        }

        # Asynchronously execute heavy disk snapshot, SQLite insert, and email dispatch
        frame_copy = frame.copy() if (frame is not None and frame.size > 0) else None
        self._executor.submit(
            self._persist_alert_worker,
            alert_dict,
            event_id,
            frame_copy,
            filename,
            organization_id
        )

        return alert_dict
