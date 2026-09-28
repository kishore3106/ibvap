import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import requests

from backend.config import settings
from backend.core.auth import TenantContext, get_current_tenant
from backend.services.pipeline import pipeline
from backend.database.session import SessionLocal
from backend.database.models import CameraModel

logger = logging.getLogger("ibvap.api.cameras")
router = APIRouter(prefix="/api/v1/cameras", tags=["Cameras"])

class CameraCreate(BaseModel):
    camera_id: str
    name: str
    source_url: str
    location: Optional[str] = "Perimeter"
    site_id: Optional[str] = None
    enabled: Optional[bool] = True

class SourceSwitchRequest(BaseModel):
    source_url: str

@router.get("/")
def get_cameras(tenant: TenantContext = Depends(get_current_tenant)):
    """Returns cameras scoped to organization with SQLite resilience."""
    cameras = []
    try:
        url = f"{settings.SUPABASE_URL}/rest/v1/cameras?organization_id=eq.{tenant.organization_id}&select=*&order=created_at.asc"
        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {tenant.token}"
        }
        res = requests.get(url, headers=headers, timeout=2)
        if res.status_code == 200 and res.json():
            cameras = res.json()
    except Exception:
        pass

    if not cameras:
        db = SessionLocal()
        try:
            local_cams = db.query(CameraModel).filter(CameraModel.enabled == True).all()
            for c in local_cams:
                cameras.append({
                    "id": c.camera_id,
                    "organization_id": tenant.organization_id,
                    "camera_id": c.camera_id,
                    "name": c.name,
                    "source_url": c.source_url,
                    "location": c.location,
                    "status": c.status,
                    "enabled": c.enabled
                })
        except Exception:
            pass
        finally:
            db.close()

    if not cameras:
        cameras.append({
            "id": "CAM-01",
            "organization_id": tenant.organization_id,
            "camera_id": "CAM-01",
            "name": "Main Perimeter Camera",
            "source_url": "0",
            "location": "North Border Sector",
            "status": "ONLINE",
            "enabled": True
        })

    meta = pipeline.capture.get_metadata()
    results = []
    for cam in cameras:
        is_active = (cam.get("camera_id") == settings.CAMERA_ID)
        results.append({
            "id": cam.get("id"),
            "organization_id": cam.get("organization_id"),
            "site_id": cam.get("site_id"),
            "camera_id": cam.get("camera_id"),
            "name": cam.get("name"),
            "source_url": cam.get("source_url"),
            "location": cam.get("location"),
            "status": "ONLINE" if (is_active and meta["is_connected"]) else cam.get("status", "OFFLINE"),
            "fps": meta["fps"] if is_active else 0.0,
            "resolution": meta["resolution"] if is_active else "640x480",
            "type": meta["type"] if is_active else "webcam",
            "enabled": cam.get("enabled", True)
        })
    return results

@router.post("/")
def create_camera(cam: CameraCreate, tenant: TenantContext = Depends(get_current_tenant)):
    db = SessionLocal()
    try:
        new_cam = CameraModel(
            camera_id=cam.camera_id,
            name=cam.name,
            source_url=cam.source_url,
            location=cam.location,
            status="ONLINE",
            enabled=cam.enabled
        )
        db.merge(new_cam)
        db.commit()
    except Exception as e:
        db.rollback()
    finally:
        db.close()

    try:
        url = f"{settings.SUPABASE_URL}/rest/v1/cameras"
        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {tenant.token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        requests.post(url, headers=headers, json={
            "organization_id": tenant.organization_id,
            "site_id": cam.site_id,
            "camera_id": cam.camera_id,
            "name": cam.name,
            "source_url": cam.source_url,
            "location": cam.location,
            "enabled": cam.enabled
        }, timeout=2)
    except Exception:
        pass

    return {"message": "Camera registered", "camera_id": cam.camera_id}

@router.put("/{camera_id}/source")
@router.post("/{camera_id}/switch_source")
def switch_camera_source(
    camera_id: str,
    req: SourceSwitchRequest,
    tenant: TenantContext = Depends(get_current_tenant)
):
    try:
        new_source = req.source_url.strip()
        pipeline.set_camera_source(new_source)

        db = SessionLocal()
        try:
            cam = db.query(CameraModel).filter(CameraModel.camera_id == camera_id).first()
            if cam:
                cam.source_url = new_source
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

        meta = pipeline.capture.get_metadata()
        return {
            "message": f"Successfully switched camera {camera_id} source",
            "camera_id": camera_id,
            "source_url": new_source,
            "status": "ONLINE" if meta["is_connected"] else "OFFLINE",
            "source_type": meta["type"]
        }
    except Exception as e:
        logger.error(f"Failed to switch camera source: {e}")
        raise HTTPException(status_code=500, detail=str(e))
