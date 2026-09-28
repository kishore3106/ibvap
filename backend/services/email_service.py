import os
import json
import time
import base64
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from typing import Optional, Dict, Any

from backend.config import settings

logger = logging.getLogger("ibvap.email")

CONFIG_PATH = os.path.join("data", "email_config.json")
REPORTS_DIR = os.path.join("data", "email_reports")
os.makedirs(REPORTS_DIR, exist_ok=True)
os.makedirs("data", exist_ok=True)

def get_email_config() -> Dict[str, Any]:
    default_config = {
        "recipient_email": os.environ.get("ALERT_RECIPIENT_EMAIL", ""),
        "enabled": True,
        "smtp_host": os.environ.get("SMTP_HOST", ""),
        "smtp_port": int(os.environ.get("SMTP_PORT", 587)),
        "smtp_user": os.environ.get("SMTP_USER", ""),
        "smtp_password": os.environ.get("SMTP_PASSWORD", ""),
        "smtp_from": os.environ.get("SMTP_FROM", "ibvap-alerts@defense.gov"),
        "last_dispatch": None
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                default_config.update(data)
        except Exception as e:
            logger.warning(f"Error loading email config: {e}")
    return default_config

def save_email_config(config_update: Dict[str, Any]) -> Dict[str, Any]:
    current = get_email_config()
    current.update(config_update)
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save email config: {e}")
    return current

def _generate_tactical_html_report(alert: Dict[str, Any], snapshot_base64: Optional[str] = None) -> str:
    alert_id = alert.get("alert_id", "ALT-UNKNOWN")
    event_type = alert.get("event_type", "ZONE_INTRUSION")
    severity = alert.get("severity", "HIGH")
    cam_id = alert.get("camera_id", settings.CAMERA_ID)
    zone_name = alert.get("zone_name", "Restricted Perimeter Sector")
    obj_type = alert.get("object_type", "Target").upper()
    track_id = alert.get("track_id", "N/A")
    conf = alert.get("confidence", 0.0)
    conf_pct = f"{float(conf) * 100:.1f}%" if conf else "VERIFIED"
    desc = alert.get("description", "Unauthorized penetration detected in perimeter boundary.")
    ts = alert.get("timestamp", time.strftime("%Y-%m-%d %H:%M:%S UTC"))

    img_tag = ""
    if snapshot_base64:
        img_tag = f"""
        <div style="margin-top: 20px; border: 2px solid #ef4444; border-radius: 6px; overflow: hidden; background: #000;">
            <div style="background: #ef4444; color: #fff; font-family: monospace; font-size: 11px; padding: 4px 8px; font-weight: bold; letter-spacing: 1px;">
                TACTICAL EVIDENCE SNAPSHOT // SENSOR CAPTURE
            </div>
            <img src="data:image/jpeg;base64,{snapshot_base64}" alt="Intrusion Snapshot" style="width: 100%; max-height: 480px; object-fit: contain; display: block;" />
        </div>
        """
    else:
        img_tag = """
        <div style="margin-top: 15px; padding: 12px; background: #1e293b; border: 1px dashed #64748b; border-radius: 6px; color: #94a3b8; font-family: monospace; font-size: 12px; text-align: center;">
            [SNAPSHOT EVIDENCE LOGGED TO SECURE ARCHIVE]
        </div>
        """

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f17; color: #e2e8f0; margin: 0; padding: 24px; }}
.container {{ max-width: 650px; margin: 0 auto; background-color: #0d1117; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.7); }}
.header {{ background: linear-gradient(135deg, #161b22, #0d1117); padding: 18px 24px; border-bottom: 2px solid #ef4444; display: flex; justify-content: space-between; align-items: center; }}
.title {{ color: #00f0ff; font-family: monospace; font-size: 16px; font-weight: 800; letter-spacing: 1.5px; margin: 0; }}
.subtitle {{ color: #8b949e; font-size: 11px; font-family: monospace; margin-top: 3px; }}
.badge {{ display: inline-block; padding: 4px 10px; background-color: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #ef4444; font-family: monospace; font-size: 12px; font-weight: bold; border-radius: 4px; }}
.content {{ padding: 24px; }}
.alert-box {{ background-color: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 14px; margin-bottom: 20px; border-radius: 0 4px 4px 0; }}
.alert-box h2 {{ margin: 0 0 6px 0; color: #f87171; font-size: 14px; font-family: monospace; }}
.alert-box p {{ margin: 0; color: #cbd5e1; font-size: 13px; }}
.grid {{ width: 100%; border-collapse: collapse; margin-top: 15px; font-family: monospace; font-size: 12px; }}
.grid td {{ padding: 10px 12px; border-bottom: 1px solid #21262d; }}
.grid td.label {{ color: #8b949e; width: 38%; font-weight: 600; text-transform: uppercase; }}
.grid td.val {{ color: #f0f6fc; font-weight: bold; }}
.footer {{ padding: 16px 24px; background-color: #161b22; border-top: 1px solid #30363d; font-family: monospace; font-size: 10px; color: #8b949e; text-align: center; }}
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <div>
            <h1 class="title">IBVAP // DEFENSE COMMAND</h1>
            <div class="subtitle">INTELLIGENT BORDER VIDEO ANALYTICS PLATFORM</div>
        </div>
        <div style="text-align: right;">
            <span class="badge">{severity} SEVERITY</span>
        </div>
    </div>
    <div class="content">
        <div class="alert-box">
            <h2>⚠️ PERIMETER BREACH DETECTED: {event_type.replace('_', ' ')}</h2>
            <p>{desc}</p>
        </div>

        <table class="grid">
            <tr><td class="label">Incident ID</td><td class="val" style="color: #00f0ff;">{alert_id}</td></tr>
            <tr><td class="label">Timestamp</td><td class="val">{ts}</td></tr>
            <tr><td class="label">Sensor / Camera</td><td class="val">{cam_id}</td></tr>
            <tr><td class="label">Restricted Sector</td><td class="val" style="color: #ef4444;">{zone_name}</td></tr>
            <tr><td class="label">Target Classification</td><td class="val">{obj_type} #{track_id}</td></tr>
            <tr><td class="label">Neural Confidence</td><td class="val">{conf_pct}</td></tr>
            <tr><td class="label">Status</td><td class="val" style="color: #fbbf24;">DISPATCHED TO COMMAND</td></tr>
        </table>

        {img_tag}
    </div>
    <div class="footer">
        CONFIDENTIAL & PROPRIETARY — DEFENSE SURVEILLANCE AUTOMATED DISPATCH<br>
        IBVAP EDGE AI CORE v1.8 • AUTOMATED INCIDENT TELEMETRY
    </div>
</div>
</body>
</html>"""

def send_alert_email_report(
    recipient: Optional[str] = None,
    alert: Optional[Dict[str, Any]] = None,
    snapshot_bytes: Optional[bytes] = None,
    snapshot_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Constructs and sends a tactical incident report with embedded snapshot to the configured email.
    Saves a local HTML report copy in data/email_reports/ and transmits via SMTP if configured.
    """
    config = get_email_config()
    target_email = (recipient or config.get("recipient_email", "")).strip()

    if not target_email:
        logger.warning("No email recipient specified for alert report dispatch.")
        return {"success": False, "error": "No recipient email configured"}

    if alert is None:
        alert = {
            "alert_id": f"ALT-{int(time.time())}",
            "event_type": "ZONE_INTRUSION",
            "severity": "HIGH",
            "camera_id": settings.CAMERA_ID,
            "zone_name": "Custom Border Sector 2",
            "object_type": "person",
            "track_id": 8,
            "confidence": 0.92,
            "description": "Tactical perimeter breach: Unauthorized Person entered Custom Border Sector 2",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC")
        }

    # Resolve snapshot image bytes
    img_bytes = None
    if snapshot_bytes:
        img_bytes = snapshot_bytes
    elif snapshot_path:
        p = snapshot_path.lstrip("/")
        if not os.path.isabs(p):
            p = os.path.abspath(p)
        if os.path.exists(p):
            try:
                with open(p, "rb") as f:
                    img_bytes = f.read()
            except Exception as e:
                logger.warning(f"Could not read snapshot file {p}: {e}")

    # Fallback to finding latest snapshot in data/snapshots if none provided
    if not img_bytes and os.path.exists("data/snapshots"):
        try:
            snaps = sorted(
                [os.path.join("data/snapshots", f) for f in os.listdir("data/snapshots") if f.endswith(".jpg")],
                key=os.path.getmtime,
                reverse=True
            )
            if snaps:
                with open(snaps[0], "rb") as f:
                    img_bytes = f.read()
        except Exception:
            pass

    # Convert to base64 for HTML embedding
    b64_str = base64.b64encode(img_bytes).decode("utf-8") if img_bytes else None

    # Generate HTML content
    html_content = _generate_tactical_html_report(alert, snapshot_base64=b64_str)

    # Save to disk as archived report
    alert_id = alert.get("alert_id", "ALT")
    severity = alert.get("severity", "HIGH")
    event_type = alert.get("event_type", "ZONE_INTRUSION")
    zone_name = alert.get("zone_name", "Perimeter Sector")
    report_filename = f"DISPATCH_{alert_id}_{int(time.time())}.html"
    report_file_path = os.path.join(REPORTS_DIR, report_filename)
    try:
        with open(report_file_path, "w", encoding="utf-8") as f:
            f.write(html_content)
    except Exception as e:
        logger.warning(f"Could not write archive report: {e}")

    # Set correct envelope sender (crucial for Gmail SMTP)
    smtp_user = config.get("smtp_user", "").strip()
    if smtp_user and "@" in smtp_user:
        from_addr = smtp_user
    else:
        from_addr = config.get("smtp_from") or "ibvap-alerts@defense.internal"

    subject = f"[IBVAP {severity} ALERT] {event_type} - {zone_name} ({alert_id})"
    msg = MIMEMultipart("related")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = target_email

    msg_alt = MIMEMultipart("alternative")
    msg.attach(msg_alt)

    text_part = MIMEText(
        f"IBVAP CRITICAL ALERT\nIncident: {alert_id}\nRule: {alert.get('event_type')}\n"
        f"Zone: {alert.get('zone_name')}\nTarget: {alert.get('object_type')} #{alert.get('track_id')}\n"
        f"Time: {alert.get('timestamp')}\nDescription: {alert.get('description')}\n",
        "plain"
    )
    msg_alt.attach(text_part)

    html_part = MIMEText(html_content, "html")
    msg_alt.attach(html_part)

    if img_bytes:
        try:
            image_attachment = MIMEImage(img_bytes, name=f"{alert_id}_snapshot.jpg")
            image_attachment.add_header("Content-Disposition", "attachment", filename=f"{alert_id}_snapshot.jpg")
            msg.attach(image_attachment)
        except Exception as e:
            logger.warning(f"Failed attaching MIME image: {e}")

    # Attempt SMTP transmission if server is configured
    smtp_host = config.get("smtp_host", "").strip()
    smtp_pass = config.get("smtp_password", "").strip()

    # Auto-detect Gmail if user is @gmail.com
    if not smtp_host and (target_email.endswith("@gmail.com") or smtp_user.endswith("@gmail.com")) and smtp_pass:
        smtp_host = "smtp.gmail.com"

    smtp_sent = False
    delivery_msg = ""

    if smtp_host and smtp_pass:
        try:
            smtp_port = int(config.get("smtp_port", 587))
            login_user = smtp_user or target_email

            if smtp_port == 465:
                server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=12)
                server.ehlo()
            else:
                server = smtplib.SMTP(smtp_host, smtp_port, timeout=12)
                server.ehlo()
                server.starttls()
                server.ehlo()

            server.login(login_user, smtp_pass)
            server.sendmail(from_addr, [target_email], msg.as_string())
            server.quit()
            smtp_sent = True
            delivery_msg = f"Alert report successfully delivered via SMTP to {target_email} inbox!"
            logger.info(delivery_msg)
        except smtplib.SMTPAuthenticationError as auth_err:
            delivery_msg = f"SMTP Login Failed: Google rejected the password. Use a 16-character Google App Password (myaccount.google.com/apppasswords)."
            logger.warning(delivery_msg)
        except Exception as e:
            delivery_msg = f"SMTP transmission failed ({e}). Report archived locally in data/email_reports/."
            logger.warning(delivery_msg)
    else:
        delivery_msg = f"Report generated and saved to {report_filename}. (Enter your SMTP / Google App Password to deliver live emails to your inbox)."
        logger.info(f"Local alert dispatch report generated for {target_email}: {report_file_path}")

    # Update config with last dispatch status
    save_email_config({
        "last_dispatch": {
            "email": target_email,
            "alert_id": alert_id,
            "timestamp": time.time(),
            "smtp_sent": smtp_sent,
            "report_file": report_filename,
            "message": delivery_msg
        }
    })

    return {
        "success": True,
        "recipient": target_email,
        "alert_id": alert_id,
        "smtp_sent": smtp_sent,
        "message": delivery_msg,
        "report_file": report_filename,
        "report_path": f"/data/email_reports/{report_filename}"
    }

def test_smtp_credentials(
    recipient: str,
    smtp_host: str = "smtp.gmail.com",
    smtp_port: int = 587,
    smtp_user: str = "",
    smtp_password: str = "",
    smtp_from: str = ""
) -> Dict[str, Any]:
    """
    Tests SMTP connection and sends a tactical verification email.
    Returns clear status and actionable feedback if authentication fails.
    """
    if not recipient:
        return {"success": False, "error": "Recipient email address is required"}

    login_user = smtp_user.strip() if smtp_user else recipient.strip()
    smtp_pass = smtp_password.strip()

    if not smtp_pass:
        return {
            "success": False,
            "error": "Password / App Password is required to send emails via SMTP."
        }

    host = smtp_host.strip() or ("smtp.gmail.com" if "@gmail.com" in login_user else "")
    port = int(smtp_port or 587)

    try:
        from_addr = login_user if ("@" in login_user) else (smtp_from or login_user)
        msg = MIMEMultipart()
        msg["Subject"] = "[IBVAP VERIFICATION] Automated Defense Alert Dispatch Verified"
        msg["From"] = from_addr
        msg["To"] = recipient

        body = (
            "IBVAP TACTICAL SURVEILLANCE NOTIFICATION\n"
            "=========================================\n\n"
            "This test email confirms that your email address is successfully connected to the "
            "IBVAP (Intelligent Border Video Analytics Platform) Edge Defense Core.\n\n"
            f"• Target Recipient: {recipient}\n"
            f"• SMTP Gateway: {host}:{port}\n"
            "• Auto-Dispatch on Breach: ENABLED & ARMED\n\n"
            "Whenever a perimeter zone intrusion, tripwire crossing, or unauthorized vehicle is detected, "
            "a high-resolution snapshot and incident telemetry report will be automatically transmitted here.\n"
        )
        msg.attach(MIMEText(body, "plain"))

        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=12)
            server.ehlo()
        else:
            server = smtplib.SMTP(host, port, timeout=12)
            server.ehlo()
            server.starttls()
            server.ehlo()

        server.login(login_user, smtp_pass)
        server.sendmail(from_addr, [recipient], msg.as_string())
        server.quit()

        # Save verified config
        save_email_config({
            "recipient_email": recipient,
            "smtp_host": host,
            "smtp_port": port,
            "smtp_user": login_user,
            "smtp_password": smtp_pass,
            "enabled": True
        })

        return {
            "success": True,
            "message": f"Verification email successfully sent to {recipient}! Check your inbox."
        }
    except smtplib.SMTPAuthenticationError:
        return {
            "success": False,
            "error": "SMTP Login Failed: Google/SMTP server rejected your credentials. For Gmail, you MUST use a 16-character Google App Password (myaccount.google.com/apppasswords), not your regular Gmail login password."
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed connecting to {host}:{port} — {str(e)}"
        }

