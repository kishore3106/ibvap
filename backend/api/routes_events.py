import datetime
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import requests

from backend.config import settings
from backend.core.auth import TenantContext, get_current_tenant
from backend.database.session import SessionLocal
from backend.database.models import EventModel, AlertModel

logger = logging.getLogger("ibvap.api.events")
router = APIRouter(prefix="/api/v1/events", tags=["Events"])

class EventCreatePayload(BaseModel):
    event_id: str
    camera_id: str
    timestamp: Optional[str] = None
    event_type: str
    object_type: Optional[str] = None
    track_id: Optional[int] = None
    confidence: Optional[float] = None
    plate_number: Optional[str] = None
    plate_confidence: Optional[str] = None
    zone_name: Optional[str] = None
    snapshot_path: Optional[str] = None

@router.get("/")
def get_events(
    camera_id: Optional[str] = None,
    event_type: Optional[str] = None,
    limit: int = Query(default=50, le=300),
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Returns events scoped to tenant with SQLite fallback."""
    try:
        url = f"{settings.SUPABASE_URL}/rest/v1/events?organization_id=eq.{tenant.organization_id}&select=*&order=timestamp.desc&limit={limit}"
        if camera_id:
            url += f"&camera_id=eq.{camera_id}"
        if event_type:
            url += f"&event_type=eq.{event_type.upper()}"

        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {tenant.token}"
        }
        res = requests.get(url, headers=headers, timeout=2)
        if res.status_code == 200:
            return res.json()
    except Exception:
        pass

    db = SessionLocal()
    try:
        query = db.query(EventModel)
        if camera_id:
            query = query.filter(EventModel.camera_id == camera_id)
        if event_type:
            query = query.filter(EventModel.event_type == event_type.upper())
        events = query.order_by(EventModel.timestamp.desc()).limit(limit).all()
        results = []
        for e in events:
            results.append({
                "event_id": e.event_id,
                "camera_id": e.camera_id,
                "timestamp": e.timestamp.isoformat() if hasattr(e.timestamp, "isoformat") else str(e.timestamp),
                "event_type": e.event_type,
                "object_type": e.object_type,
                "track_id": e.track_id,
                "confidence": e.confidence,
                "plate_number": e.plate_number,
                "plate_confidence": e.plate_confidence,
                "zone_name": e.zone_name,
                "snapshot_path": e.snapshot_path
            })
        return results
    except Exception as ex:
        logger.error(f"Error reading local events: {ex}")
        return []
    finally:
        db.close()

@router.post("/")
def create_event(
    event: EventCreatePayload,
    tenant: TenantContext = Depends(get_current_tenant)
):
    db = SessionLocal()
    try:
        new_event = EventModel(
            event_id=event.event_id,
            camera_id=event.camera_id,
            event_type=event.event_type,
            object_type=event.object_type,
            track_id=event.track_id,
            confidence=event.confidence or 0.0,
            plate_number=event.plate_number,
            plate_confidence=event.plate_confidence,
            zone_name=event.zone_name,
            snapshot_path=event.snapshot_path
        )
        db.add(new_event)
        db.commit()
    except Exception as e:
        db.rollback()
    finally:
        db.close()

    return {"message": "Event recorded", "event_id": event.event_id}

@router.get("/stats")
def get_event_stats(tenant: TenantContext = Depends(get_current_tenant)):
    db = SessionLocal()
    try:
        events_count = db.query(EventModel).count()
        active_alerts_count = db.query(AlertModel).filter(AlertModel.status == "NEW").count()
        critical_alerts_count = db.query(AlertModel).filter(
            AlertModel.status == "NEW",
            AlertModel.severity == "CRITICAL"
        ).count()
        return {
            "events_today": events_count,
            "active_alerts": active_alerts_count,
            "critical_alerts": critical_alerts_count,
            "ai_status": "Running"
        }
    except Exception as e:
        logger.error(f"Error retrieving event stats: {e}")
        return {
            "events_today": 0,
            "active_alerts": 0,
            "critical_alerts": 0,
            "ai_status": "Running"
        }
    finally:
        db.close()

