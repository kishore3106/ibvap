import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from backend.config import settings

# SQLite connection URL
DATABASE_URL = settings.DATABASE_URL

# Ensure directory exists for sqlite file
if DATABASE_URL.startswith("sqlite:///"):
    db_path = DATABASE_URL.replace("sqlite:///", "")
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    import json
    from . import models
    Base.metadata.create_all(bind=engine)

    # Auto-seed default camera and tactical zones if empty
    db = SessionLocal()
    try:
        if db.query(models.CameraModel).count() == 0:
            default_cam = models.CameraModel(
                camera_id="CAM-01",
                name="Main Perimeter Camera",
                source_url="0",
                location="North Border Sector",
                status="ONLINE",
                enabled=True
            )
            db.add(default_cam)
            db.commit()

        if db.query(models.ZoneModel).count() == 0:
            # 1. Virtual Center Tripwire Line across the middle
            tripwire_zone = models.ZoneModel(
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
            # 2. Restricted Sector Polygon in lower section
            polygon_zone = models.ZoneModel(
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
    finally:
        db.close()
