import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import requests

from backend.config import settings
from backend.core.auth import TenantContext, get_current_tenant
from backend.database.session import SessionLocal
from backend.database.models import AlertModel

logger = logging.getLogger("ibvap.api.alerts")
router = APIRouter(prefix="/api/v1/alerts", tags=["Alerts"])

class AlertCreatePayload(BaseModel):
    alert_id: str
    event_type: str
    severity: Optional[str] = "HIGH"
    camera_id: str
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    object_type: Optional[str] = None
    track_id: Optional[int] = None
    confidence: Optional[float] = None
    description: Optional[str] = None
    snapshot_path: Optional[str] = None
    status: Optional[str] = "NEW"
    timestamp: Optional[str] = None

@router.get("/")
def get_alerts(
    severity: Optional[str] = None,
    camera_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=50, le=200),
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Returns alerts scoped to the authenticated organization with SQLite fallback."""
    # 1. Try Supabase
    try:
        url = f"{settings.SUPABASE_URL}/rest/v1/alerts?organization_id=eq.{tenant.organization_id}&select=*&order=timestamp.desc&limit={limit}"
        if severity:
            url += f"&severity=eq.{severity.upper()}"
        if camera_id:
            url += f"&camera_id=eq.{camera_id}"
        if status:
            url += f"&status=eq.{status.upper()}"

        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {tenant.token}"
        }
        res = requests.get(url, headers=headers, timeout=2)
        if res.status_code == 200:
            return res.json()
    except Exception:
        pass

    # 2. Local SQLite fallback
    db = SessionLocal()
    try:
        query = db.query(AlertModel)
        if severity:
            query = query.filter(AlertModel.severity == severity.upper())
        if camera_id:
            query = query.filter(AlertModel.camera_id == camera_id)
        if status:
            query = query.filter(AlertModel.status == status.upper())
        alerts = query.order_by(AlertModel.timestamp.desc()).limit(limit).all()
        results = []
        for a in alerts:
            results.append({
                "alert_id": a.alert_id,
                "event_type": a.event_type,
                "severity": a.severity,
                "camera_id": a.camera_id,
                "zone_id": a.zone_id,
                "zone_name": a.zone_name,
                "object_type": a.object_type,
                "track_id": a.track_id,
                "confidence": a.confidence,
                "description": a.description,
                "snapshot_path": a.snapshot_path,
                "status": a.status,
                "timestamp": a.timestamp.isoformat() if hasattr(a.timestamp, "isoformat") else str(a.timestamp)
            })
        return results
    except Exception as e:
        logger.error(f"Error reading local alerts: {e}")
        return []
    finally:
        db.close()

@router.patch("/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: str,
    tenant: TenantContext = Depends(get_current_tenant)
):
    db = SessionLocal()
    try:
        alert = db.query(AlertModel).filter(AlertModel.alert_id == alert_id).first()
        if alert:
            alert.status = "ACKNOWLEDGED"
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()

    try:
        url = f"{settings.SUPABASE_URL}/rest/v1/alerts?alert_id=eq.{alert_id}&organization_id=eq.{tenant.organization_id}"
        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {tenant.token}",
            "Content-Type": "application/json"
        }
        requests.patch(url, headers=headers, json={"status": "ACKNOWLEDGED"}, timeout=2)
    except Exception:
        pass

    return {"message": "Alert marked as acknowledged", "alert_id": alert_id}

@router.post("/")
def create_alert(
    alert: AlertCreatePayload,
    tenant: TenantContext = Depends(get_current_tenant)
):
    db = SessionLocal()
    try:
        new_alert = AlertModel(
            alert_id=alert.alert_id,
            event_type=alert.event_type,
            severity=alert.severity or "HIGH",
            camera_id=alert.camera_id,
            zone_id=alert.zone_id,
            zone_name=alert.zone_name,
            object_type=alert.object_type,
            track_id=alert.track_id,
            confidence=alert.confidence or 0.0,
            description=alert.description or "",
            snapshot_path=alert.snapshot_path,
            status=alert.status or "NEW"
        )
        db.add(new_alert)
        db.commit()
    except Exception as e:
        db.rollback()
    finally:
        db.close()

    return {"message": "Alert created", "alert_id": alert.alert_id}

# --- Email Alert Notification Endpoints ---

from backend.services.email_service import get_email_config, save_email_config, send_alert_email_report, test_smtp_credentials

class EmailConfigPayload(BaseModel):
    recipient_email: str
    enabled: Optional[bool] = True
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: Optional[str] = None

class TestSmtpPayload(BaseModel):
    recipient_email: str
    smtp_host: Optional[str] = "smtp.gmail.com"
    smtp_port: Optional[int] = 587
    smtp_user: Optional[str] = ""
    smtp_password: str
    smtp_from: Optional[str] = ""

class DispatchEmailPayload(BaseModel):
    email: Optional[str] = None
    alert_id: Optional[str] = None

@router.post("/test_email_connection")
def test_email_connection(payload: TestSmtpPayload, tenant: TenantContext = Depends(get_current_tenant)):
    """Tests the SMTP gateway and transmits a real verification email."""
    res = test_smtp_credentials(
        recipient=payload.recipient_email,
        smtp_host=payload.smtp_host or "smtp.gmail.com",
        smtp_port=payload.smtp_port or 587,
        smtp_user=payload.smtp_user or payload.recipient_email,
        smtp_password=payload.smtp_password,
        smtp_from=payload.smtp_from or payload.smtp_user or payload.recipient_email
    )
    return res

@router.get("/email_config")
def get_email_alert_config(tenant: TenantContext = Depends(get_current_tenant)):
    """Returns the currently configured alert email recipient and status."""
    return get_email_config()

@router.post("/email_config")
def update_email_alert_config(payload: EmailConfigPayload, tenant: TenantContext = Depends(get_current_tenant)):
    """Saves the recipient email address for automated border breach incident reports."""
    updated = save_email_config(payload.model_dump(exclude_unset=True))
    return {"message": "Email alert configuration saved", "config": updated}

@router.post("/dispatch_email_report")
def dispatch_email_report(payload: DispatchEmailPayload, tenant: TenantContext = Depends(get_current_tenant)):
    """Generates and dispatches a tactical incident report with snapshot to the recipient email."""
    config = get_email_config()
    target_email = payload.email or config.get("recipient_email")
    if not target_email:
        raise HTTPException(status_code=400, detail="Recipient email must be provided or configured.")

    # Save target email as active if not yet saved
    if payload.email and payload.email != config.get("recipient_email"):
        save_email_config({"recipient_email": payload.email, "enabled": True})

    alert_dict = None
    snapshot_path = None

    db = SessionLocal()
    try:
        if payload.alert_id:
            a = db.query(AlertModel).filter(AlertModel.alert_id == payload.alert_id).first()
        else:
            a = db.query(AlertModel).order_by(AlertModel.timestamp.desc()).first()

        if a:
            alert_dict = {
                "alert_id": a.alert_id,
                "event_type": a.event_type,
                "severity": a.severity,
                "camera_id": a.camera_id,
                "zone_id": a.zone_id,
                "zone_name": a.zone_name,
                "object_type": a.object_type,
                "track_id": a.track_id,
                "confidence": a.confidence,
                "description": a.description,
                "snapshot_path": a.snapshot_path,
                "timestamp": a.timestamp.isoformat() if hasattr(a.timestamp, "isoformat") else str(a.timestamp)
            }
            snapshot_path = a.snapshot_path
    except Exception as e:
        logger.warning(f"Error querying alert for email dispatch: {e}")
    finally:
        db.close()

    result = send_alert_email_report(
        recipient=target_email,
        alert=alert_dict,
        snapshot_path=snapshot_path
    )
    return result
