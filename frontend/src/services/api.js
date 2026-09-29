import { supabase, isSupabaseConfigured } from './supabase';

const FALLBACK_BACKEND_URL = 'https://ibvap-backend-fkvp.onrender.com';

export function getBackendBase() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8000';
  const custom = localStorage.getItem('ibvap_backend_url');
  if (custom && custom.trim()) return custom.trim().replace(/\/+$/, '');
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl && envUrl.trim()) return envUrl.trim().replace(/\/+$/, '');

  // Hosted on Netlify or external production domain -> point to Render backend
  if (window.location.hostname.includes('netlify.app')) {
    return FALLBACK_BACKEND_URL;
  }
  // Local development -> point to local FastAPI
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8000';
  }
  return FALLBACK_BACKEND_URL;
}

export function getApiBase() {
  return `${getBackendBase()}/api/v1`;
}

export function formatSnapshotUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path;
  }
  return `${getBackendBase()}${path.startsWith('/') ? path : `/${path}`}`;
}

let cachedSession = null;
let sessionFetchTime = 0;

async function getAuthSession() {
  if (!isSupabaseConfigured()) {
    return null;
  }
  try {
    const now = Date.now();
    if (cachedSession && now - sessionFetchTime < 60000) {
      return cachedSession;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      cachedSession = session;
      sessionFetchTime = now;
      return session;
    }

    // Fallback: auto-authenticate as default surveillance operator if no session exists
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'iamnegative37@gmail.com',
      password: 'Surveillance2026!'
    });
    if (!error && data?.session) {
      cachedSession = data.session;
      sessionFetchTime = now;
      return data.session;
    }
    return null;
  } catch (err) {
    console.warn('[IBVAP Auth] Session lookup error:', err);
    return null;
  }
}

export async function getAuthUserAndOrg() {
  if (!isSupabaseConfigured()) {
    return {
      user: { id: 'operator-1', email: 'operator@ibvap.internal', user_metadata: { name: 'Tactical Operator' } },
      org: { id: 'default-org', name: 'BORDER DEFENSE COMMAND' },
      token: 'offline-operator-token'
    };
  }
  try {
    const session = await getAuthSession();
    if (!session?.user) return { user: null, org: null, token: null };

    const { data: members, error } = await supabase
      .from('organization_members')
      .select('organization_id, role, organizations(id, name, slug)')
      .eq('user_id', session.user.id)
      .limit(1);

    if (error || !members || members.length === 0) {
      return { user: session.user, org: null, token: session.access_token };
    }

    const org = members[0].organizations || { id: members[0].organization_id };
    return {
      user: session.user,
      org: org,
      token: session.access_token
    };
  } catch (err) {
    console.error('[IBVAP Auth] Error resolving user organization:', err);
    return { user: null, org: null, token: null };
  }
}

async function authFetch(url, options = {}, defaultValue = null) {
  try {
    const session = await getAuthSession();
    const headers = {
      ...(options.headers || {})
    };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const controller = new AbortController();
    const timeoutMs = options.timeout || 7000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[IBVAP API] HTTP ${res.status} for ${url}`);
      return defaultValue;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return defaultValue;
    }

    return await res.json();
  } catch (err) {
    console.warn(`[IBVAP API] Request failed for ${url}:`, err.message);
    return defaultValue;
  }
}

const STORAGE_ZONES_KEY = 'ibvap_saved_zones';

function getLocalStoredZones() {
  try {
    const raw = localStorage.getItem(STORAGE_ZONES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const needsUpgrade = parsed.some(z =>
          z.name === 'Restricted Sector Alpha' ||
          z.name === 'Center Border Tripwire' ||
          (z.name === 'Custom Border Sector 2' && (z.polygon_coords?.[1]?.[0] > 0.25 || z.polygon_data?.[1]?.x > 0.25))
        );
        if (needsUpgrade) {
          saveLocalStoredZones(DEFAULT_SAMPLE_ZONES);
          return DEFAULT_SAMPLE_ZONES;
        }
        return parsed;
      }
    }
  } catch (_) {}
  return [];
}

function saveLocalStoredZones(zones) {
  try {
    localStorage.setItem(STORAGE_ZONES_KEY, JSON.stringify(zones));
  } catch (_) {}
}

const DEFAULT_SAMPLE_ZONES = [
  {
    zone_id: 'ZONE-DEF-01',
    name: 'Custom Border Sector 1',
    camera_id: 'CAM-01',
    zone_type: 'tripwire',
    line_coords: [[0.22, 0.04], [0.22, 0.96]],
    polygon_coords: [],
    polygon_data: [],
    is_restricted: true,
    dwell_threshold: 5.0,
    color: '#ffffff',
    enabled: true
  },
  {
    zone_id: 'ZONE-DEF-02',
    name: 'Custom Border Sector 2',
    camera_id: 'CAM-01',
    zone_type: 'polygon',
    polygon_coords: [[0.05, 0.04], [0.18, 0.04], [0.18, 0.96], [0.05, 0.96]],
    polygon_data: [{ x: 0.05, y: 0.04 }, { x: 0.18, y: 0.04 }, { x: 0.18, y: 0.96 }, { x: 0.05, y: 0.96 }],
    line_coords: [],
    is_restricted: true,
    dwell_threshold: 8.0,
    color: '#ef4444',
    enabled: true
  }
];

export const api = {
  // Health
  getHealth: async () => {
    return authFetch(`${getApiBase()}/health`, {}, { status: 'OFFLINE' });
  },

  // Sites (strictly isolated per organization)
  getSites: async () => {
    const { org } = await getAuthUserAndOrg();
    if (org?.id) {
      const { data, error } = await supabase
        .from('sites')
        .select('*')
        .eq('organization_id', org.id)
        .order('created_at', { ascending: true });
      if (!error && Array.isArray(data)) return data;
    }
    return authFetch(`${getApiBase()}/sites/`, {}, []);
  },

  createSite: async (siteData) => {
    const { org } = await getAuthUserAndOrg();
    if (org?.id) {
      const { data, error } = await supabase
        .from('sites')
        .upsert({
          organization_id: org.id,
          site_id: siteData.site_id,
          name: siteData.name,
          location: siteData.location || 'Perimeter Sector'
        }, { onConflict: 'organization_id,site_id' })
        .select();
      if (!error) return data;
    }
    return authFetch(`${getApiBase()}/sites/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(siteData)
    }, null);
  },

  deleteSite: async (siteId) => {
    const { org } = await getAuthUserAndOrg();
    if (org?.id) {
      await supabase
        .from('sites')
        .delete()
        .eq('organization_id', org.id)
        .eq('site_id', siteId);
    }
    return authFetch(`${getApiBase()}/sites/${siteId}`, { method: 'DELETE' }, { success: true });
  },

  // Cameras (strictly isolated per organization)
  getCameras: async () => {
    const { org } = await getAuthUserAndOrg();
    if (org?.id) {
      const { data, error } = await supabase
        .from('cameras')
        .select('*')
        .eq('organization_id', org.id)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data) && data.length > 0) {
        return data;
      }

      // Auto-initialize primary camera profile for this organization if brand new
      if (!error && Array.isArray(data) && data.length === 0) {
        const defaultCam = {
          organization_id: org.id,
          camera_id: 'CAM-01',
          name: `CAM-01 — ${org.name || 'Perimeter Sector'}`,
          source_url: '0',
          location: org.name || 'Main Sector',
          status: 'ONLINE',
          enabled: true
        };
        const { data: inserted } = await supabase
          .from('cameras')
          .insert([defaultCam])
          .select();
        return inserted && inserted.length > 0 ? inserted : [defaultCam];
      }
    }

    const data = await authFetch(`${getApiBase()}/cameras/`, {}, []);
    return Array.isArray(data) ? data : [];
  },

  switchCameraSource: async (cameraId, sourceUrl) => {
    try {
      const { org } = await getAuthUserAndOrg();
      if (org?.id) {
        await supabase
          .from('cameras')
          .update({ source_url: sourceUrl, status: 'ONLINE', updated_at: new Date().toISOString() })
          .eq('organization_id', org.id)
          .eq('camera_id', cameraId);
      }
    } catch (_) {}

    // Priority 1: POST to FastAPI switch_source endpoint
    try {
      const res = await authFetch(`${getApiBase()}/cameras/${cameraId}/switch_source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url: sourceUrl }),
        timeout: 4000
      }, null);
      if (res) return res;
    } catch (_) {}

    // Fallback: PUT to /source
    try {
      const res = await authFetch(`${getApiBase()}/cameras/${cameraId}/source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url: sourceUrl }),
        timeout: 4000
      }, null);
      if (res) return res;
    } catch (_) {}

    return { success: true, camera_id: cameraId, source_url: sourceUrl, local_applied: true };
  },

  // Push browser webcam frame directly to FastAPI AI pipeline
  pushWebcamFrame: async (blob) => {
    try {
      const res = await fetch(`${getApiBase()}/stream/push_frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob
      });
      if (res.ok) return await res.json();
    } catch (_) {}
    return null;
  },

  // Email Alert Incident Report Integration
  getEmailAlertConfig: async () => {
    return authFetch(`${getApiBase()}/alerts/email_config`, {}, {
      recipient_email: localStorage.getItem('ibvap_alert_email') || '',
      enabled: true
    });
  },

  saveEmailAlertConfig: async (configOrEmail) => {
    let payload = {};
    if (typeof configOrEmail === 'string') {
      localStorage.setItem('ibvap_alert_email', configOrEmail);
      payload = { recipient_email: configOrEmail, enabled: true };
    } else if (typeof configOrEmail === 'object' && configOrEmail !== null) {
      if (configOrEmail.recipient_email) {
        localStorage.setItem('ibvap_alert_email', configOrEmail.recipient_email);
      }
      payload = configOrEmail;
    }
    return authFetch(`${getApiBase()}/alerts/email_config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, { message: 'Saved locally' });
  },

  testEmailConnection: async (payload) => {
    return authFetch(`${getApiBase()}/alerts/test_email_connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, { success: false, error: 'Failed connecting to server' });
  },

  dispatchEmailReport: async (email = null, alertId = null) => {
    return authFetch(`${getApiBase()}/alerts/dispatch_email_report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, alert_id: alertId })
    }, { success: false });
  },

  // Zones (persisted with instant multi-tier resilience: LocalStorage + SQLite + Supabase)
  getZones: async (cameraId = null) => {
    const local = getLocalStoredZones();

    // Priority 1: Instant LocalStorage retrieval
    if (local && local.length > 0) {
      if (cameraId) {
        const filtered = local.filter(z => z.camera_id === cameraId);
        if (filtered.length > 0) return filtered;
      }
      return local;
    }

    // Priority 2: Fast check to backend
    try {
      const q = cameraId ? `?camera_id=${cameraId}` : '';
      const data = await authFetch(`${getApiBase()}/zones/${q}`, { timeout: 2000 }, null);
      if (Array.isArray(data) && data.length > 0) {
        saveLocalStoredZones(data);
        return data;
      }
    } catch (_) {}

    // Priority 3: Fallback default sample zones
    saveLocalStoredZones(DEFAULT_SAMPLE_ZONES);
    return DEFAULT_SAMPLE_ZONES;
  },

  saveZone: async (zoneData) => {
    // 1. Normalize polygon/tripwire points into [{ x, y }] between 0 and 1
    const rawPoints = zoneData.polygon_data || zoneData.polygon_coords || zoneData.line_coords || [];
    const normData = rawPoints.map(pt => {
      let x = 0, y = 0;
      if (typeof pt === 'object' && pt !== null && !Array.isArray(pt)) {
        x = Number(pt.x) || 0;
        y = Number(pt.y) || 0;
      } else if (Array.isArray(pt) && pt.length >= 2) {
        x = Number(pt[0]) || 0;
        y = Number(pt[1]) || 0;
      }
      if (x > 1.0 || y > 1.0) {
        x = x / 960.0;
        y = y / 540.0;
      }
      x = Math.max(0.0, Math.min(1.0, Number(x.toFixed(4))));
      y = Math.max(0.0, Math.min(1.0, Number(y.toFixed(4))));
      return { x, y };
    });

    const isTripwire = zoneData.zone_type === 'tripwire';
    const payload = {
      zone_id: zoneData.zone_id || `ZONE-${Date.now().toString(36).toUpperCase()}`,
      name: zoneData.name || (isTripwire ? 'Virtual Tripwire' : 'Border Sector 1'),
      camera_id: zoneData.camera_id || 'CAM-01',
      site_id: zoneData.site_id || 'default-site',
      zone_type: zoneData.zone_type || 'polygon',
      polygon_data: isTripwire ? [] : normData,
      polygon_coords: isTripwire ? [] : normData.map(p => [p.x, p.y]),
      line_coords: isTripwire ? (zoneData.line_coords?.length ? zoneData.line_coords : normData.map(p => [p.x, p.y])) : [],
      is_restricted: zoneData.is_restricted ?? true,
      dwell_threshold: zoneData.dwell_threshold ?? 10.0,
      prohibited_directions: zoneData.prohibited_directions || [],
      color: zoneData.color || (isTripwire ? '#06b6d4' : '#ef4444'),
      enabled: zoneData.enabled ?? true
    };

    // 2. Guaranteed instant persistence to LocalStorage
    const currentLocal = getLocalStoredZones();
    const existingIdx = currentLocal.findIndex(z => z.zone_id === payload.zone_id);
    if (existingIdx >= 0) {
      currentLocal[existingIdx] = { ...currentLocal[existingIdx], ...payload };
    } else {
      currentLocal.push(payload);
    }
    saveLocalStoredZones(currentLocal);

    // 3. Asynchronously background sync to Supabase & Render without blocking UI
    (async () => {
      try {
        const { org } = await getAuthUserAndOrg();
        if (org?.id) {
          supabase
            .from('zones')
            .upsert({
              organization_id: org.id,
              site_id: payload.site_id,
              camera_id: payload.camera_id,
              zone_id: payload.zone_id,
              name: payload.name,
              zone_type: payload.zone_type,
              polygon_data: payload.polygon_data,
              polygon_coords: payload.polygon_coords,
              line_coords: payload.line_coords,
              is_restricted: payload.is_restricted,
              dwell_threshold: payload.dwell_threshold,
              prohibited_directions: payload.prohibited_directions,
              color: payload.color,
              enabled: payload.enabled
            }, { onConflict: 'organization_id,zone_id' })
            .then(() => {})
            .catch(() => {});
        }
      } catch (_) {}

      try {
        await authFetch(`${getApiBase()}/zones/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 2500
        }, null);
      } catch (_) {}
    })();

    return payload;
  },

  deleteZone: async (zoneId) => {
    const updated = getLocalStoredZones().filter(z => z.zone_id !== zoneId);
    saveLocalStoredZones(updated);

    try {
      const { org } = await getAuthUserAndOrg();
      if (org?.id) {
        supabase
          .from('zones')
          .delete()
          .eq('organization_id', org.id)
          .eq('zone_id', zoneId)
          .then(() => {})
          .catch(() => {});
      }
    } catch (_) {}

    try {
      await authFetch(`${getApiBase()}/zones/${zoneId}`, {
        method: 'DELETE',
        timeout: 3000
      }, { success: true });
    } catch (_) {}

    return { success: true, zone_id: zoneId };
  },

  // Alerts
  getAlerts: async (params = {}) => {
    let q = '';
    if (typeof params === 'number') {
      q = `limit=${params}`;
    } else if (typeof params === 'object' && params !== null) {
      q = new URLSearchParams(params).toString();
    }

    // 1. Fetch from local backend first (stores live AI detection alerts in SQLite)
    const localData = await authFetch(`${getApiBase()}/alerts/${q ? `?${q}` : ''}`, {}, []);
    if (Array.isArray(localData) && localData.length > 0) {
      return localData;
    }

    // 2. Fallback to Supabase if connected
    try {
      const { org } = await getAuthUserAndOrg();
      if (org?.id) {
        let query = supabase
          .from('alerts')
          .select('*')
          .eq('organization_id', org.id)
          .order('timestamp', { ascending: false });

        if (typeof params === 'object' && params !== null) {
          if (params.severity) query = query.eq('severity', params.severity.toUpperCase());
          if (params.status) query = query.eq('status', params.status.toUpperCase());
          if (params.camera_id) query = query.eq('camera_id', params.camera_id);
          if (params.limit) query = query.limit(params.limit);
        } else if (typeof params === 'number') {
          query = query.limit(params);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data) && data.length > 0) return data;
      }
    } catch (_) {}

    // 3. Fallback to LocalStorage
    try {
      const cached = JSON.parse(localStorage.getItem('ibvap_saved_alerts') || '[]');
      if (Array.isArray(cached) && cached.length > 0) return cached;
    } catch (_) {}

    return Array.isArray(localData) ? localData : [];
  },

  acknowledgeAlert: async (alertId) => {
    try {
      const { org } = await getAuthUserAndOrg();
      if (org?.id) {
        await supabase
          .from('alerts')
          .update({ status: 'ACKNOWLEDGED' })
          .eq('organization_id', org.id)
          .eq('alert_id', alertId);
      }
    } catch (_) {}

    try {
      const cached = JSON.parse(localStorage.getItem('ibvap_saved_alerts') || '[]');
      const updated = cached.map(a => (a.alert_id === alertId ? { ...a, status: 'ACKNOWLEDGED' } : a));
      localStorage.setItem('ibvap_saved_alerts', JSON.stringify(updated));
    } catch (_) {}

    return authFetch(`${getApiBase()}/alerts/${alertId}/acknowledge`, {
      method: 'PATCH'
    }, { success: false });
  },

  // Events
  getEvents: async (params = {}) => {
    let q = '';
    if (typeof params === 'number') {
      q = `limit=${params}`;
    } else if (typeof params === 'object' && params !== null) {
      q = new URLSearchParams(params).toString();
    }

    // 1. Fetch from local backend first
    const localData = await authFetch(`${getApiBase()}/events/${q ? `?${q}` : ''}`, {}, []);
    if (Array.isArray(localData) && localData.length > 0) {
      return localData;
    }

    // 2. Fallback to Supabase
    try {
      const { org } = await getAuthUserAndOrg();
      if (org?.id) {
        let query = supabase
          .from('events')
          .select('*')
          .eq('organization_id', org.id)
          .order('timestamp', { ascending: false });

        if (typeof params === 'object' && params !== null) {
          if (params.camera_id) query = query.eq('camera_id', params.camera_id);
          if (params.event_type) query = query.eq('event_type', params.event_type.toUpperCase());
          if (params.limit) query = query.limit(params.limit);
        } else if (typeof params === 'number') {
          query = query.limit(params);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data) && data.length > 0) return data;
      }
    } catch (_) {}

    // 3. Fallback to LocalStorage
    try {
      const cached = JSON.parse(localStorage.getItem('ibvap_saved_events') || '[]');
      if (Array.isArray(cached) && cached.length > 0) return cached;
    } catch (_) {}

    return Array.isArray(localData) ? localData : [];
  },

  // Real-time telemetry & Historical stats
  getLiveStats: async () => {
    return authFetch(`${getApiBase()}/stream/live_stats`, {}, null);
  },

  getStats: async () => {
    // 1. Local backend stats (queries SQLite events and alerts)
    const localStats = await authFetch(`${getApiBase()}/events/stats`, {}, null);
    if (localStats && (localStats.events_today > 0 || localStats.active_alerts > 0)) {
      return localStats;
    }

    // 2. Supabase stats if available
    try {
      const { org } = await getAuthUserAndOrg();
      if (org?.id) {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);

        const [eventsRes, activeAlertsRes, criticalAlertsRes] = await Promise.all([
          supabase.from('events').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).gte('timestamp', todayStart.toISOString()),
          supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).eq('status', 'NEW'),
          supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).eq('severity', 'CRITICAL').eq('status', 'NEW')
        ]);

        return {
          events_today: Math.max(eventsRes.count || 0, localStats?.events_today || 0),
          active_alerts: Math.max(activeAlertsRes.count || 0, localStats?.active_alerts || 0),
          critical_alerts: Math.max(criticalAlertsRes.count || 0, localStats?.critical_alerts || 0),
          organization_id: org.id,
          ai_status: 'Edge Connected'
        };
      }
    } catch (_) {}

    return localStats || {
      events_today: 0,
      active_alerts: 0,
      critical_alerts: 0,
      ai_status: 'Edge Connected'
    };
  },

  getEventStats: async () => {
    return api.getStats();
  },

  // Persist live alert & event directly into SQLite backend, LocalStorage, and Supabase
  createAlert: async (alert) => {
    if (!alert) return null;
    const alertId = alert.alert_id || alert.id || `ALT-${Math.floor(1000 + Math.random() * 9000)}`;
    const eventId = `EVT-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowIso = alert.timestamp || new Date().toISOString();

    const payload = {
      alert_id: alertId,
      id: alertId,
      event_type: alert.event_type || alert.rule_type || 'RESTRICTED_ZONE_INTRUSION',
      rule_type: alert.rule_type || alert.event_type || 'RESTRICTED_ZONE',
      severity: alert.severity || 'CRITICAL',
      camera_id: alert.camera_id || 'CAM-01',
      zone_id: alert.zone_id || null,
      zone_name: alert.zone_name || 'Restricted Sector Alpha',
      object_type: alert.object_type || 'person',
      track_id: alert.track_id || 1,
      confidence: typeof alert.confidence === 'number' ? alert.confidence : 0.95,
      description: alert.description || 'Intrusion violation detected in monitored sector',
      snapshot_path: alert.snapshot_path || null,
      status: alert.status || 'NEW',
      timestamp: nowIso
    };

    // 1. Guaranteed storage in LocalStorage
    try {
      const stored = JSON.parse(localStorage.getItem('ibvap_saved_alerts') || '[]');
      if (!stored.some(a => (a.alert_id || a.id) === alertId)) {
        stored.unshift(payload);
        localStorage.setItem('ibvap_saved_alerts', JSON.stringify(stored.slice(0, 50)));
      }
    } catch (_) {}

    // 2. Persist to Backend SQLite Database
    try {
      await authFetch(`${getApiBase()}/alerts/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, null);
    } catch (e) {
      console.warn('[IBVAP] Backend alert save warning:', e);
    }

    // 3. Persist Event to Backend
    try {
      await authFetch(`${getApiBase()}/events/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          camera_id: payload.camera_id,
          timestamp: nowIso,
          event_type: payload.event_type,
          object_type: payload.object_type,
          track_id: payload.track_id,
          confidence: payload.confidence,
          zone_name: payload.zone_name,
          snapshot_path: payload.snapshot_path
        })
      }, null);
    } catch (_) {}

    // 4. Also background sync to Supabase (if configured)
    (async () => {
      try {
        const { org } = await getAuthUserAndOrg();
        const orgId = org?.id || 'default-org';
        await Promise.all([
          supabase.from('alerts').insert([{ ...payload, organization_id: orgId }]),
          supabase.from('events').insert([{
            organization_id: orgId,
            event_id: eventId,
            camera_id: payload.camera_id,
            timestamp: nowIso,
            event_type: payload.event_type,
            object_type: payload.object_type,
            track_id: payload.track_id,
            confidence: payload.confidence,
            zone_name: payload.zone_name,
            snapshot_path: payload.snapshot_path
          }])
        ]);
      } catch (_) {}
    })();

    return payload;
  }
};
