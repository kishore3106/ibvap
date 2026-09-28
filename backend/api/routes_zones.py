import uuid
import json
import logging
from typing import List, Optional, Any, Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import requests

from backend.config import settings
from backend.core.auth import TenantContext, get_current_tenant
from backend.services.pipeline import pipeline
from backend.database.session import SessionLocal
from backend.database.models import ZoneModel

logger = logging.getLogger("ibvap.api.zones")
router = APIRouter(prefix="/api/v1/zones", tags=["Zones"])

class ZonePayload(BaseModel):
    zone_id: str
    camera_id: Optional[str] = None
    site_id: Optional[str] = None
    name: str
    zone_type: str = "polygon"  # 'polygon' or 'tripwire'
    polygon_data: Optional[List[Dict[str, Any]]] = []
    polygon_coords: Optional[List[Any]] = []
    line_coords: Optional[List[Any]] = []
    is_restricted: bool = True
    dwell_threshold: float = 10.0
    prohibited_directions: Optional[List[str]] = []
    color: str = "#ef4444"
    enabled: bool = True

def _refresh_pipeline_zones(tenant: TenantContext):
    """Reloads active enabled zones for the current tenant into the live AI detection pipeline."""
    # 1. Local SQLite (edge-first, immediate synchronization)
    db = SessionLocal()
    try:
        local_zones = db.query(ZoneModel).filter(ZoneModel.enabled == True).all()
        in_mem_zones = []
        for z in local_zones:
            p_coords = json.loads(z.polygon_coords) if z.polygon_coords else []
            l_coords = json.loads(z.line_coords) if z.line_coords else []
            p_dirs = json.loads(z.prohibited_directions) if z.prohibited_directions else []
            in_mem_zones.append({
                "zone_id": z.zone_id,
                "name": z.name,
                "zone_type": z.zone_type,
                "polygon_data": [{"x": p[0], "y": p[1]} for p in p_coords],
                "polygon_coords": p_coords,
                "line_coords": l_coords,
                "is_restricted": z.is_restricted,
                "dwell_threshold": z.dwell_threshold,
                "prohibited_directions": p_dirs,
                "color": z.color,
                "organization_id": tenant.organization_id,
                "enabled": z.enabled
            })
        pipeline.update_zones(in_mem_zones, organization_id=tenant.organization_id)
        logger.info(f"Pipeline updated with {len(in_mem_zones)} zones from local SQLite database.")
        if in_mem_zones:
            return
    except Exception as e:
        logger.error(f"Error refreshing zones from SQLite: {e}")
    finally:
        db.close()

    # 2. Supabase Fallback
    try:
        url = f"{settings.SUPABASE_URL}/rest/v1/zones?organization_id=eq.{tenant.organization_id}&enabled=eq.true&select=*"
        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {tenant.token}"
        }
        res = requests.get(url, headers=headers, timeout=2)
        if res.status_code == 200 and res.json():
            db_zones = res.json()
            in_mem_zones = []
            for z in db_zones:
                in_mem_zones.append({
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
                    "organization_id": z.get("organization_id") or tenant.organization_id,
                    "enabled": z.get("enabled", True)
                })
            pipeline.update_zones(in_mem_zones, organization_id=tenant.organization_id)
            pipeline.alert_engine.register_org_token(tenant.organization_id, tenant.token)
    except Exception:
        pass

@router.get("/")
def get_zones(
    camera_id: Optional[str] = None,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Returns zones strictly scoped to the authenticated organization with local SQLite resilience."""
    # 1. Local SQLite (fastest, guaranteed local operator truth)
    db = SessionLocal()
    try:
        query = db.query(ZoneModel).filter(ZoneModel.enabled == True)
        if camera_id:
            query = query.filter(ZoneModel.camera_id == camera_id)
        local_zones = query.all()
        if local_zones:
            results = []
            for z in local_zones:
                p_coords = json.loads(z.polygon_coords) if z.polygon_coords else []
                l_coords = json.loads(z.line_coords) if z.line_coords else []
                results.append({
                    "zone_id": z.zone_id,
                    "camera_id": z.camera_id,
                    "name": z.name,
                    "zone_type": z.zone_type,
                    "polygon_data": [{"x": p[0], "y": p[1]} for p in p_coords],
                    "polygon_coords": p_coords,
                    "line_coords": l_coords,
                    "is_restricted": z.is_restricted,
                    "dwell_threshold": z.dwell_threshold,
                    "prohibited_directions": json.loads(z.prohibited_directions) if z.prohibited_directions else [],
                    "color": z.color,
                    "organization_id": tenant.organization_id,
                    "enabled": z.enabled
                })
            _refresh_pipeline_zones(tenant)
            return results
    except Exception as e:
        logger.error(f"Error querying local zones: {e}")
    finally:
        db.close()

    # 2. Supabase Cloud fallback
    try:
        url = f"{settings.SUPABASE_URL}/rest/v1/zones?organization_id=eq.{tenant.organization_id}&select=*&order=created_at.asc"
        if camera_id:
            url += f"&camera_id=eq.{camera_id}"
        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {tenant.token}"
        }
        res = requests.get(url, headers=headers, timeout=2)
        if res.status_code == 200 and res.json():
            zones = res.json()
            _refresh_pipeline_zones(tenant)
            return zones
    except Exception:
        pass

    return []

@router.post("/")
def create_or_update_zone(
    zone: ZonePayload,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Saves or updates a zone in both SQLite and Supabase."""
    coords_list = []
    raw_points = zone.polygon_coords or zone.polygon_data or []
    for pt in raw_points:
        if isinstance(pt, dict) and "x" in pt and "y" in pt:
            coords_list.append([float(pt["x"]), float(pt["y"])])
        elif isinstance(pt, (list, tuple)) and len(pt) >= 2:
            coords_list.append([float(pt[0]), float(pt[1])])

    # 1. Save to local SQLite
    db = SessionLocal()
    try:
        existing = db.query(ZoneModel).filter(ZoneModel.zone_id == zone.zone_id).first()
        if existing:
            existing.name = zone.name
            existing.zone_type = zone.zone_type
            existing.polygon_coords = json.dumps(coords_list)
            existing.line_coords = json.dumps(zone.line_coords or [])
            existing.is_restricted = zone.is_restricted
            existing.dwell_threshold = zone.dwell_threshold
            existing.prohibited_directions = json.dumps(zone.prohibited_directions or [])
            existing.color = zone.color
            existing.enabled = zone.enabled
        else:
            new_zone = ZoneModel(
                zone_id=zone.zone_id,
                camera_id=zone.camera_id or "CAM-01",
                name=zone.name,
                zone_type=zone.zone_type,
                polygon_coords=json.dumps(coords_list),
                line_coords=json.dumps(zone.line_coords or []),
                is_restricted=zone.is_restricted,
                dwell_threshold=zone.dwell_threshold,
                prohibited_directions=json.dumps(zone.prohibited_directions or []),
                color=zone.color,
                enabled=zone.enabled
            )
            db.add(new_zone)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Error saving zone to local SQLite: {e}")
    finally:
        db.close()

    # 2. Attempt saving to Supabase if reachable
    try:
        url = f"{settings.SUPABASE_URL}/rest/v1/zones?on_conflict=organization_id,zone_id"
        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {tenant.token}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation"
        }
        payload = {
            "organization_id": tenant.organization_id,
            "zone_id": zone.zone_id,
            "camera_id": zone.camera_id or "CAM-01",
            "name": zone.name,
            "zone_type": zone.zone_type,
            "polygon_data": [{"x": p[0], "y": p[1]} for p in coords_list],
            "polygon_coords": coords_list,
            "line_coords": zone.line_coords or [],
            "is_restricted": zone.is_restricted,
            "dwell_threshold": zone.dwell_threshold,
            "prohibited_directions": zone.prohibited_directions or [],
            "color": zone.color,
            "enabled": zone.enabled
        }
        requests.post(url, headers=headers, json=payload, timeout=2)
    except Exception:
        pass

    _refresh_pipeline_zones(tenant)

    return {
        "message": "Zone saved successfully",
        "zone_id": zone.zone_id,
        "name": zone.name,
        "zone_type": zone.zone_type
    }

@router.delete("/{zone_id}")
def delete_zone(
    zone_id: str,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Deletes a zone from local SQLite and Supabase."""
    db = SessionLocal()
    try:
        target = db.query(ZoneModel).filter(ZoneModel.zone_id == zone_id).first()
        if target:
            db.delete(target)
            db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting zone from SQLite: {e}")
    finally:
        db.close()

    try:
        url = f"{settings.SUPABASE_URL}/rest/v1/zones?organization_id=eq.{tenant.organization_id}&zone_id=eq.{zone_id}"
        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {tenant.token}"
        }
        requests.delete(url, headers=headers, timeout=2)
    except Exception:
        pass

    _refresh_pipeline_zones(tenant)
    return {"message": "Zone deleted", "zone_id": zone_id}

@router.post("/reset_defaults")
def reset_default_zones(tenant: TenantContext = Depends(get_current_tenant)):
    """Resets to default Center Border Tripwire and Restricted Polygon."""
    db = SessionLocal()
    try:
        db.query(ZoneModel).delete()
        tripwire_zone = ZoneModel(
            zone_id="tripwire-center-line",
            camera_id="CAM-01",
            name="Center Border Tripwire",
            zone_type="tripwire",
            line_coords="[[0.05, 0.50], [0.95, 0.50]]",
            polygon_coords="[]",
            is_restricted=True,
            dwell_threshold=5.0,
            prohibited_directions="[]",
            color="#00ffff",
            enabled=True
        )
        polygon_zone = ZoneModel(
            zone_id="restricted-sector-alpha",
            camera_id="CAM-01",
            name="Restricted Border Sector",
            zone_type="polygon",
            polygon_coords="[[0.08, 0.45], [0.92, 0.45], [0.96, 0.95], [0.04, 0.95]]",
            line_coords="[]",
            is_restricted=True,
            dwell_threshold=3.0,
            prohibited_directions="[]",
            color="#ef4444",
            enabled=True
        )
        db.add(tripwire_zone)
        db.add(polygon_zone)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

    _refresh_pipeline_zones(tenant)
    return {"message": "Default tactical zones restored successfully"}
