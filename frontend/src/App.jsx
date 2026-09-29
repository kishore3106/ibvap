import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import EmailSetupModal from './components/EmailSetupModal';
import DashboardPage from './pages/DashboardPage';
import LiveMonitorPage from './pages/LiveMonitorPage';
import AlertsPage from './pages/AlertsPage';
import EventHistoryPage from './pages/EventHistoryPage';
import CamerasPage from './pages/CamerasPage';
import ZonesPage from './pages/ZonesPage';
import SettingsPage from './pages/SettingsPage';

import { api, getAuthUserAndOrg } from './services/api';
import { wsService } from './services/websocket';
import { supabase } from './services/supabase';

const DEFAULT_OPERATOR = {
  id: 'operator-1',
  email: 'operator@ibvap.internal',
  user_metadata: { name: 'Tactical Operator' }
};

const DEFAULT_ORG = {
  id: 'default-org',
  name: 'BORDER DEFENSE COMMAND'
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(DEFAULT_OPERATOR);
  const [currentOrg, setCurrentOrg] = useState(DEFAULT_ORG);
  const [authChecking, setAuthChecking] = useState(false);

  const [alertEmail, setAlertEmail] = useState(() => localStorage.getItem('ibvap_alert_email') || 'kishore3106avenger@gmail.com');
  const [showEmailModal, setShowEmailModal] = useState(false);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [liveStats, setLiveStats] = useState({
    camera_status: 'ONLINE',
    fps: 0,
    person_count: 0,
    vehicle_count: 0,
    active_alerts_count: 0,
    source_type: 'webcam'
  });
  const [historicalStats, setHistoricalStats] = useState({
    events_today: 0,
    active_alerts: 0,
    critical_alerts: 0,
    ai_status: 'Running'
  });
  const [cameras, setCameras] = useState([]);
  const [currentCamera, setCurrentCamera] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [events, setEvents] = useState([]);
  const [zones, setZones] = useState([]);
  const [alertBanner, setAlertBanner] = useState(null);

  // Sync email alert config on startup
  useEffect(() => {
    api.getEmailAlertConfig().then((cfg) => {
      if (cfg?.recipient_email) {
        setAlertEmail(cfg.recipient_email);
        localStorage.setItem('ibvap_alert_email', cfg.recipient_email);
      } else {
        const dismissed = localStorage.getItem('ibvap_email_setup_dismissed');
        if (!dismissed) {
          setShowEmailModal(true);
        }
      }
    }).catch(() => {});
  }, []);

  // Check Supabase authentication session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setCurrentUser(session.user);
      } else {
        setCurrentUser(DEFAULT_OPERATOR);
        setCurrentOrg(DEFAULT_ORG);
      }
      setAuthChecking(false);
    }).catch(() => {
      setCurrentUser(DEFAULT_OPERATOR);
      setCurrentOrg(DEFAULT_ORG);
      setAuthChecking(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setCurrentUser(session.user);
      } else {
        setCurrentUser(DEFAULT_OPERATOR);
        setCurrentOrg(DEFAULT_ORG);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut().catch(() => {});
    setCurrentUser(DEFAULT_OPERATOR);
    setCurrentOrg(DEFAULT_ORG);
    loadInitialData();
  };

  // Initial load
  const loadInitialData = async () => {
    try {
      const [camsData, alertsData, eventsData, statsData, zonesData] = await Promise.all([
        api.getCameras(),
        api.getAlerts({ limit: 15 }),
        api.getEvents({ limit: 20 }),
        api.getStats(),
        api.getZones()
      ]);

      setCameras(Array.isArray(camsData) ? camsData : []);
      if (Array.isArray(camsData) && camsData.length > 0) setCurrentCamera(camsData[0]);
      setAlerts(Array.isArray(alertsData) ? alertsData : []);
      setEvents(Array.isArray(eventsData) ? eventsData : []);
      if (statsData) setHistoricalStats(statsData);
      setZones(Array.isArray(zonesData) ? zonesData : []);
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  };

  // Reload data and connect WebSocket whenever active operator changes
  useEffect(() => {
    if (!currentOrg) {
      setCurrentOrg(DEFAULT_ORG);
    }

    getAuthUserAndOrg().then(({ org }) => {
      if (org) setCurrentOrg(org);
    }).catch(() => {});

    loadInitialData();

    // Connect WebSocket
    wsService.disconnect();
    wsService.connect();
    const unsubscribe = wsService.subscribe((message) => {
      if (message.type === 'STATS_UPDATE') {
        setLiveStats(message.data);
      } else if (message.type === 'NEW_ALERT') {
        const newAlert = message.data;

        setAlerts((prev) => [newAlert, ...prev.slice(0, 19)]);
        // Trigger banner alert
        setAlertBanner(newAlert);
        setTimeout(() => setAlertBanner(null), 6000);

        // Refresh stats and events
        api.getStats().then(setHistoricalStats).catch(() => {});
        api.getEvents({ limit: 20 }).then(setEvents).catch(() => {});
      }
    });

    // Real-time live telemetry polling fallback (every 1s) to ensure instant FPS & Person counts
    const liveTelemetryTimer = setInterval(() => {
      api.getLiveStats().then((data) => {
        if (data && typeof data.fps !== 'undefined') {
          setLiveStats(data);
        }
      }).catch(() => {});
    }, 1000);

    // Periodic stats refresh (every 3s)
    const statsTimer = setInterval(() => {
      api.getStats().then(setHistoricalStats).catch(() => {});
    }, 3000);

    // Periodic alert/event refresh (every 2.5s) — ensures dashboard and alerts stay current in real time
    const alertRefreshTimer = setInterval(() => {
      api.getAlerts({ limit: 15 }).then(data => {
        if (Array.isArray(data)) setAlerts(data);
      }).catch(() => {});
      api.getEvents({ limit: 20 }).then(data => {
        if (Array.isArray(data)) setEvents(data);
      }).catch(() => {});
      api.getZones().then(data => {
        if (Array.isArray(data)) setZones(data);
      }).catch(() => {});
    }, 2500);


    return () => {
      unsubscribe();
      clearInterval(liveTelemetryTimer);
      clearInterval(statsTimer);
      clearInterval(alertRefreshTimer);
    };
  }, [currentUser?.id]);


  const handleSourceChanged = (newSource) => {
    if (newSource && currentCamera) {
      setCurrentCamera(prev => prev ? { ...prev, source_url: newSource } : null);
    }
    loadInitialData();
  };

  const handleNewAlert = (newAlert) => {
    if (!newAlert) return;
    const alertId = newAlert.alert_id || newAlert.id || `ALT-${Date.now()}`;
    const formattedAlert = {
      alert_id: alertId,
      id: alertId,
      event_type: newAlert.event_type || newAlert.rule_type || 'RESTRICTED_ZONE_INTRUSION',
      rule_type: newAlert.rule_type || newAlert.event_type || 'RESTRICTED_ZONE',
      severity: newAlert.severity || 'CRITICAL',
      status: 'NEW',
      camera_id: newAlert.camera_id || currentCamera?.camera_id || 'CAM-01',
      zone_name: newAlert.zone_name || 'Restricted Sector Alpha',
      object_type: newAlert.object_type || 'person',
      track_id: newAlert.track_id || 1,
      confidence: newAlert.confidence || '95%',
      description: newAlert.description || 'Intrusion violation detected in restricted sector',
      timestamp: newAlert.timestamp || new Date().toISOString()
    };

    setAlerts((prev) => {
      if (prev.some((a) => (a.alert_id || a.id) === alertId)) return prev;
      return [formattedAlert, ...prev.slice(0, 19)];
    });

    const newEvent = {
      event_id: `EVT-${Date.now()}`,
      event_type: formattedAlert.event_type,
      object_type: formattedAlert.object_type,
      camera_id: formattedAlert.camera_id,
      zone_name: formattedAlert.zone_name,
      timestamp: formattedAlert.timestamp
    };
    setEvents((prev) => [newEvent, ...prev.slice(0, 19)]);

    setAlertBanner(formattedAlert);
    setTimeout(() => setAlertBanner(null), 6000);

    setHistoricalStats((prev) => ({
      ...prev,
      active_alerts: (prev.active_alerts || 0) + 1,
      critical_alerts: (prev.critical_alerts || 0) + 1,
      events_today: (prev.events_today || 0) + 1
    }));
  };

  const handleStatsUpdate = (stats) => {
    if (stats) {
      setLiveStats((prev) => ({
        ...prev,
        ...stats
      }));
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#07090e] text-slate-100 overflow-hidden font-sans">
      {/* Platform Header */}
      <Header
        systemStats={historicalStats}
        currentUser={currentUser}
        currentOrg={currentOrg}
        onSignOut={handleSignOut}
        alertEmail={alertEmail}
        onOpenEmailSetup={() => setShowEmailModal(true)}
      />

      {/* High Severity Flash Alert Banner */}
      {alertBanner && (
        <div className="bg-rose-950/90 border-b border-rose-500/80 px-6 py-2 flex items-center justify-between z-40 animate-pulse">
          <div className="flex items-center space-x-3">
            <span className="text-base">🚨</span>
            <div>
              <span className="font-mono font-bold text-xs text-rose-300 mr-2">
                [{alertBanner.severity} INTRUSION ALERT]
              </span>
              <span className="text-xs text-white font-medium">
                {alertBanner.description}
              </span>
            </div>
          </div>
          <button
            onClick={() => setAlertBanner(null)}
            className="text-rose-300 hover:text-white font-mono text-xs"
          >
            DISMISS ✕
          </button>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          alertCount={alerts.filter(a => a.status === 'NEW').length}
          onOpenEmailSetup={() => setShowEmailModal(true)}
        />

        <main className="flex-1 flex flex-col bg-[#07090e] overflow-hidden">
          {activeTab === 'dashboard' && (
            <DashboardPage
              liveStats={liveStats}
              historicalStats={historicalStats}
              currentCamera={currentCamera}
              alerts={alerts}
              events={events}
              zones={zones}
              onAlertUpdated={loadInitialData}
              onSourceChanged={handleSourceChanged}
              onNewAlert={handleNewAlert}
              onStatsUpdate={handleStatsUpdate}
            />
          )}

          {activeTab === 'live' && (
            <LiveMonitorPage
              liveStats={liveStats}
              currentCamera={currentCamera}
              zones={zones}
              onSourceChanged={handleSourceChanged}
              onNewAlert={handleNewAlert}
              onStatsUpdate={handleStatsUpdate}
            />
          )}

          {activeTab === 'alerts' && <AlertsPage />}

          {activeTab === 'history' && <EventHistoryPage />}

          {activeTab === 'cameras' && (
            <CamerasPage
              liveStats={liveStats}
              onSourceChanged={handleSourceChanged}
            />
          )}

          {activeTab === 'zones' && <ZonesPage />}

          {activeTab === 'settings' && <SettingsPage liveStats={liveStats} />}
        </main>
      </div>

      {/* Automated Email Incident Dispatch Setup Modal */}
      <EmailSetupModal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        onConfigSaved={(savedEmail) => {
          setAlertEmail(savedEmail);
          loadInitialData();
        }}
      />
    </div>
  );
}
