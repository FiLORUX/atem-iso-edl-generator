/**
 * ATEM ISO EDL Generator - Dashboard Client
 * Real-time WebSocket connection with auto-reconnect.
 */

(function () {
  'use strict';

  // ============================================================================
  // Configuration
  // ============================================================================

  const CONFIG = {
    wsReconnectDelay: 1000,
    wsReconnectMaxDelay: 30000,
    wsReconnectBackoff: 1.5,
    maxEventLogEntries: 100,
    clockUpdateInterval: 1000,
    statusPollInterval: 30000,
  };

  // ============================================================================
  // State
  // ============================================================================

  const state = {
    ws: null,
    wsConnected: false,
    wsReconnectAttempts: 0,
    wsReconnectTimer: null,
    eventCount: 0,
    sessionId: null,
    atemConnected: false,
    currentProgram: null,
    currentPreview: null,
  };

  // ============================================================================
  // DOM Elements
  // ============================================================================

  const elements = {
    // Session
    sessionId: document.getElementById('session-id'),

    // Status
    atemStatus: document.getElementById('atem-status'),
    atemHost: document.getElementById('atem-host'),
    wsStatus: document.getElementById('ws-status'),
    uptime: document.getElementById('uptime'),

    // Program/Preview
    programInput: document.getElementById('program-input'),
    programReel: document.getElementById('program-reel'),
    lastTransition: document.getElementById('last-transition'),
    previewInput: document.getElementById('preview-input'),

    // Events
    eventCount: document.getElementById('event-count'),
    eventLog: document.getElementById('event-log'),

    // EDL
    frameRate: document.getElementById('frame-rate'),
    dropFrame: document.getElementById('drop-frame'),
    edlEventCount: document.getElementById('edl-event-count'),
    generateEdl: document.getElementById('generate-edl'),

    // Footer
    clock: document.getElementById('clock'),
  };

  // ============================================================================
  // WebSocket Connection
  // ============================================================================

  /**
   * Connect to WebSocket server.
   */
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log('[WS] Connecting to', wsUrl);

    try {
      state.ws = new WebSocket(wsUrl);

      state.ws.onopen = handleWsOpen;
      state.ws.onclose = handleWsClose;
      state.ws.onerror = handleWsError;
      state.ws.onmessage = handleWsMessage;
    } catch (error) {
      console.error('[WS] Connection error:', error);
      scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket open.
   */
  function handleWsOpen() {
    console.log('[WS] Connected');
    state.wsConnected = true;
    state.wsReconnectAttempts = 0;
    updateWsStatus(true);
  }

  /**
   * Handle WebSocket close.
   */
  function handleWsClose(event) {
    console.log('[WS] Disconnected:', event.code, event.reason);
    state.wsConnected = false;
    state.ws = null;
    updateWsStatus(false);
    scheduleReconnect();
  }

  /**
   * Handle WebSocket error.
   */
  function handleWsError(error) {
    console.error('[WS] Error:', error);
  }

  /**
   * Handle incoming WebSocket message.
   */
  function handleWsMessage(event) {
    try {
      const message = JSON.parse(event.data);
      processMessage(message);
    } catch (error) {
      console.error('[WS] Failed to parse message:', error);
    }
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff.
   */
  function scheduleReconnect() {
    if (state.wsReconnectTimer) {
      clearTimeout(state.wsReconnectTimer);
    }

    const delay = Math.min(
      CONFIG.wsReconnectDelay * Math.pow(CONFIG.wsReconnectBackoff, state.wsReconnectAttempts),
      CONFIG.wsReconnectMaxDelay
    );

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${state.wsReconnectAttempts + 1})`);

    state.wsReconnectTimer = setTimeout(() => {
      state.wsReconnectAttempts++;
      connectWebSocket();
    }, delay);
  }

  /**
   * Send message to WebSocket server.
   */
  function sendMessage(message) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(message));
    }
  }

  // ============================================================================
  // Message Processing
  // ============================================================================

  /**
   * Process incoming server message.
   */
  function processMessage(message) {
    switch (message.type) {
      case 'initial_state':
        handleInitialState(message.payload);
        break;

      case 'connection_status':
        handleConnectionStatus(message.payload);
        break;

      case 'program_change':
        handleProgramChange(message.payload);
        break;

      case 'event':
        handleEvent(message.payload, message.timestamp);
        break;

      case 'ping':
        sendMessage({ type: 'pong' });
        break;

      case 'error':
        console.error('[Server] Error:', message.payload.message);
        break;

      default:
        console.log('[WS] Unknown message type:', message.type);
    }
  }

  /**
   * Handle initial state message.
   */
  function handleInitialState(payload) {
    console.log('[WS] Received initial state');

    // Session
    state.sessionId = payload.session.id;
    elements.sessionId.textContent = payload.session.id;

    // ATEM status
    state.atemConnected = payload.atem.connected;
    updateAtemStatus(payload.atem.connected);
    elements.atemHost.textContent = payload.atem.host;

    // Program/Preview
    if (payload.atem.currentProgram) {
      updateProgramDisplay(payload.atem.currentProgram);
    }
    if (payload.atem.currentPreview) {
      updatePreviewDisplay(payload.atem.currentPreview);
    }

    // Events
    state.eventCount = payload.eventCount;
    updateEventCount(payload.eventCount);

    // Load recent events
    if (payload.recentEvents && payload.recentEvents.length > 0) {
      clearEventLog();
      payload.recentEvents.forEach((event) => {
        addEventToLog(event, false);
      });
    }

    // Config
    elements.frameRate.textContent = `${payload.config.frameRate} fps`;
    elements.dropFrame.textContent = payload.config.dropFrame ? 'Yes' : 'No';
    elements.edlEventCount.textContent = payload.eventCount.toString();

    // Enable EDL button if we have events
    elements.generateEdl.disabled = payload.eventCount === 0;
  }

  /**
   * Handle connection status update.
   */
  function handleConnectionStatus(payload) {
    if (payload.device === 'atem') {
      state.atemConnected = payload.state === 'connected';
      updateAtemStatus(state.atemConnected);
    }
  }

  /**
   * Handle program change.
   */
  function handleProgramChange(payload) {
    state.currentProgram = payload;
    updateProgramDisplay(payload);
  }

  /**
   * Handle generic event.
   */
  function handleEvent(payload, timestamp) {
    const event = {
      type: payload.eventType,
      timestamp: payload.eventTimestamp || timestamp,
      ...payload.data,
    };

    addEventToLog(event, true);

    // Update event count
    if (payload.eventType === 'program_change') {
      state.eventCount++;
      updateEventCount(state.eventCount);
    }

    // Update preview if it's a preview change
    if (payload.eventType === 'preview_change' && payload.data.input) {
      updatePreviewDisplay(payload.data.input);
    }

    // Update last transition
    if (payload.eventType === 'program_change' && payload.data.transitionType) {
      const frames = payload.data.transitionFrames || 0;
      elements.lastTransition.textContent =
        frames > 0
          ? `${payload.data.transitionType.toUpperCase()} (${frames}f)`
          : payload.data.transitionType.toUpperCase();
    }
  }

  // ============================================================================
  // UI Updates
  // ============================================================================

  /**
   * Update WebSocket status indicator.
   */
  function updateWsStatus(connected) {
    const indicator = elements.wsStatus;
    const textEl = indicator.querySelector('.status-text');

    if (connected) {
      indicator.className = 'status-indicator status-indicator--connected';
      textEl.textContent = 'Connected';
    } else {
      indicator.className = 'status-indicator status-indicator--disconnected';
      textEl.textContent = 'Disconnected';
    }
  }

  /**
   * Update ATEM status indicator.
   */
  function updateAtemStatus(connected) {
    const indicator = elements.atemStatus;
    const textEl = indicator.querySelector('.status-text');

    if (connected) {
      indicator.className = 'status-indicator status-indicator--connected';
      textEl.textContent = 'Connected';
    } else {
      indicator.className = 'status-indicator status-indicator--disconnected';
      textEl.textContent = 'Disconnected';
    }
  }

  /**
   * Update program display.
   */
  function updateProgramDisplay(input) {
    state.currentProgram = input;

    const idEl = elements.programInput.querySelector('.program-input__id');
    const nameEl = elements.programInput.querySelector('.program-input__name');

    idEl.textContent = input.inputId.toString();
    nameEl.textContent = input.name;
    elements.programReel.textContent = input.reelName;

    // Trigger animation
    elements.programInput.classList.remove('program-input--active');
    void elements.programInput.offsetWidth; // Force reflow
    elements.programInput.classList.add('program-input--active');
  }

  /**
   * Update preview display.
   */
  function updatePreviewDisplay(input) {
    state.currentPreview = input;

    const idEl = elements.previewInput.querySelector('.preview-input__id');
    const nameEl = elements.previewInput.querySelector('.preview-input__name');

    idEl.textContent = input.inputId.toString();
    nameEl.textContent = input.name;
  }

  /**
   * Update event count display.
   */
  function updateEventCount(count) {
    elements.eventCount.textContent = `${count} event${count === 1 ? '' : 's'}`;
    elements.edlEventCount.textContent = count.toString();
    elements.generateEdl.disabled = count === 0;
  }

  /**
   * Clear event log.
   */
  function clearEventLog() {
    elements.eventLog.innerHTML = '';
  }

  /**
   * Add event to log.
   */
  function addEventToLog(event, isNew) {
    // Remove empty state message if present
    const emptyMsg = elements.eventLog.querySelector('.event-log__empty');
    if (emptyMsg) {
      emptyMsg.remove();
    }

    // Create event entry
    const entry = document.createElement('div');
    entry.className = 'event-entry' + (isNew ? ' event-entry--new' : '');

    // Format time
    const timestamp = new Date(event.timestamp);
    const timeStr = timestamp.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Format content based on event type
    let content = '';
    switch (event.type) {
      case 'program_change':
        content = `<span class="event-type">PGM</span> <span class="event-input">${event.input?.name || 'Unknown'}</span>`;
        if (event.transitionType && event.transitionType !== 'cut') {
          content += ` <span class="event-transition">(${event.transitionType})</span>`;
        }
        break;

      case 'preview_change':
        content = `<span class="event-type">PVW</span> ${event.input?.name || 'Unknown'}`;
        break;

      case 'transition_start':
        content = `<span class="event-type">TRANS</span> ${event.transitionType?.toUpperCase() || 'Unknown'}`;
        break;

      case 'transition_complete':
        content = `<span class="event-type">TRANS</span> Complete`;
        break;

      case 'connection':
        const stateStr = event.state || event.data?.state || 'unknown';
        content = `<span class="event-type">CONN</span> ATEM ${stateStr}`;
        break;

      default:
        content = `<span class="event-type">${event.type}</span>`;
    }

    entry.innerHTML = `
      <span class="event-time">${timeStr}</span>
      <span class="event-content">${content}</span>
    `;

    // Add to top of log
    elements.eventLog.insertBefore(entry, elements.eventLog.firstChild);

    // Limit entries
    while (elements.eventLog.children.length > CONFIG.maxEventLogEntries) {
      elements.eventLog.removeChild(elements.eventLog.lastChild);
    }
  }

  /**
   * Update clock display.
   */
  function updateClock() {
    const now = new Date();
    elements.clock.textContent = now.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  /**
   * Format uptime in human-readable format.
   */
  function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch current status from API.
   */
  async function fetchStatus() {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      // Update uptime
      elements.uptime.textContent = formatUptime(data.session.uptime);

      return data;
    } catch (error) {
      console.error('[API] Failed to fetch status:', error);
      return null;
    }
  }

  /**
   * Generate and download EDL.
   */
  async function downloadEdl() {
    try {
      elements.generateEdl.disabled = true;
      elements.generateEdl.textContent = 'Generating...';

      const response = await fetch('/api/edl/download');
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      // Get filename from Content-Disposition header
      const disposition = response.headers.get('Content-Disposition');
      let filename = 'output.edl';
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      console.log('[EDL] Downloaded:', filename);
    } catch (error) {
      console.error('[EDL] Download failed:', error);
      alert('Failed to generate EDL: ' + error.message);
    } finally {
      elements.generateEdl.disabled = state.eventCount === 0;
      elements.generateEdl.innerHTML = '<span class="btn__icon">&#8681;</span> Generate EDL';
    }
  }

  // ============================================================================
  // Initialisation
  // ============================================================================

  /**
   * Initialise the dashboard.
   */
  function init() {
    console.log('[App] Initialising ATEM ISO EDL Generator Dashboard');

    // Start clock
    updateClock();
    setInterval(updateClock, CONFIG.clockUpdateInterval);

    // Start status polling
    fetchStatus();
    setInterval(fetchStatus, CONFIG.statusPollInterval);

    // Connect WebSocket
    connectWebSocket();

    // Set up EDL download button
    elements.generateEdl.addEventListener('click', downloadEdl);

    console.log('[App] Initialisation complete');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
