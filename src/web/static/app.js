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
    timecodePollInterval: 200,
    autoSaveDebounceMs: 1000,
    localStorageKey: 'atem-iso-edl-generator',
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
    recording: false,
    recordingStartTime: null,
    recordingTimer: null,
    config: null,
    inputs: [],
    hyperdecks: [],
    recentExports: [],
    // Source control states (persisted)
    sourceStates: new Map(), // inputId -> { tcMaster, armed, includeInEdl }
    tcMasterInputId: null,   // Which source is TC master (only one)
    useTableTcMaster: false, // Use TC master from table vs manual entry
    activeTab: 'dashboard',  // Current tab (persisted)
    // Timecode display
    currentTimecode: null,
    timecodeSource: 'system',
    timecodePollTimer: null,
    // Auto-save debounce
    autoSaveTimer: null,
  };

  // ============================================================================
  // DOM Elements
  // ============================================================================

  const elements = {
    // Session
    sessionId: document.getElementById('session-id'),

    // Recording control
    recordingToggle: document.getElementById('recording-toggle'),
    recordingDuration: document.getElementById('recording-duration'),

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

    // Navigation tabs
    navTabs: document.querySelectorAll('.nav-tab'),
    tabContents: document.querySelectorAll('.tab-content'),

    // Export tab
    exportEventCount: document.getElementById('export-event-count'),
    exportDuration: document.getElementById('export-duration'),
    exportFrameRate: document.getElementById('export-frame-rate'),
    exportFormatInputs: document.querySelectorAll('input[name="export-format"]'),
    exportComments: document.getElementById('export-comments'),
    exportClipNames: document.getElementById('export-clip-names'),
    exportTitle: document.getElementById('export-title'),
    exportDownload: document.getElementById('export-download'),
    exportPreview: document.getElementById('export-preview'),
    recentExports: document.getElementById('recent-exports'),

    // Settings - ATEM
    settingAtemHost: document.getElementById('setting-atem-host'),
    settingAtemME: document.getElementById('setting-atem-me'),
    settingFrameOffset: document.getElementById('setting-frame-offset'),

    // Settings - Timecode
    settingFrameRate: document.getElementById('setting-frame-rate'),
    settingDropFrame: document.getElementById('setting-drop-frame'),
    settingStartTC: document.getElementById('setting-start-tc'),
    settingTCSource: document.getElementById('setting-tc-source'),

    // Settings - Sources (unified inputs + hyperdecks)
    sourceList: document.getElementById('source-list'),
    addSource: document.getElementById('add-source'),

    // Settings - Timecode HyperDeck
    hyperdeckTcSettings: document.getElementById('hyperdeck-tc-settings'),
    settingTcHyperdeckHost: document.getElementById('setting-tc-hyperdeck-host'),
    settingTcHyperdeckPort: document.getElementById('setting-tc-hyperdeck-port'),
    settingTcUseTableMaster: document.getElementById('setting-tc-use-table-master'),
    hyperdeckTcManual: document.getElementById('hyperdeck-tc-manual'),
    hyperdeckTcFromTable: document.getElementById('hyperdeck-tc-from-table'),
    tcMasterName: document.getElementById('tc-master-name'),

    // Settings - Actions
    settingsSave: document.getElementById('settings-save'),
    settingsReset: document.getElementById('settings-reset'),
    settingsStatus: document.getElementById('settings-status'),

    // Preview modal
    previewModal: document.getElementById('preview-modal'),
    previewContent: document.getElementById('preview-content'),
    previewCopy: document.getElementById('preview-copy'),
    previewDownload: document.getElementById('preview-download'),
    modalClose: document.querySelector('.modal__close'),
    modalBackdrop: document.querySelector('.modal__backdrop'),

    // Footer
    clock: document.getElementById('clock'),
    timecodeDisplay: document.getElementById('timecode-display'),
    timecodeSourceIndicator: document.getElementById('timecode-source-indicator'),
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

      case 'recording_status':
        handleRecordingStatus(message.payload);
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
    state.config = payload.config;
    updateConfigDisplay(payload.config);
    populateSettings(payload.config);

    // Recording state
    if (payload.recording) {
      state.recording = payload.recording.active;
      if (payload.recording.startTime) {
        state.recordingStartTime = new Date(payload.recording.startTime);
      }
      updateRecordingUI();
    }

    // Inputs and HyperDecks
    if (payload.inputs) {
      state.inputs = payload.inputs;
    }
    if (payload.hyperdecks) {
      state.hyperdecks = payload.hyperdecks;
    }
    renderSources();

    // Enable export buttons if we have events
    updateExportButtons();
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
   * Handle recording status update.
   */
  function handleRecordingStatus(payload) {
    state.recording = payload.active;
    if (payload.startTime) {
      state.recordingStartTime = new Date(payload.startTime);
    } else {
      state.recordingStartTime = null;
    }
    updateRecordingUI();
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
      updateExportButtons();
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
  // Tab Navigation
  // ============================================================================

  /**
   * Switch to a tab.
   */
  function switchTab(tabId) {
    // Update nav tabs
    elements.navTabs.forEach((tab) => {
      if (tab.dataset.tab === tabId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // Update tab contents
    elements.tabContents.forEach((content) => {
      if (content.id === `tab-${tabId}`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });

    // Persist active tab
    state.activeTab = tabId;
    scheduleAutoSave();

    // Refresh data when switching to export tab
    if (tabId === 'export') {
      fetchStatus();
    }

    // Update TC source UI when switching to settings
    if (tabId === 'settings') {
      updateTcSourceUI();
    }
  }

  /**
   * Set up tab navigation.
   */
  function setupTabNavigation() {
    elements.navTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        switchTab(tab.dataset.tab);
      });
    });
  }

  // ============================================================================
  // Recording Control
  // ============================================================================

  /**
   * Toggle recording state.
   */
  async function toggleRecording() {
    const btn = elements.recordingToggle;
    btn.disabled = true;

    const wasRecording = state.recording;

    try {
      // Start/stop armed HyperDecks first
      if (!wasRecording) {
        await startArmedHyperDecks();
      }

      const endpoint = wasRecording ? '/api/recording/stop' : '/api/recording/start';
      const response = await fetch(endpoint, { method: 'POST' });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      state.recording = result.recording;

      if (result.recording) {
        state.recordingStartTime = new Date();
      } else {
        state.recordingStartTime = null;
        // Stop armed HyperDecks after stopping session recording
        await stopArmedHyperDecks();
      }

      updateRecordingUI();
    } catch (error) {
      console.error('[Recording] Toggle failed:', error);
      alert('Failed to toggle recording: ' + error.message);
      // Try to stop HyperDecks if we started them but the main recording failed
      if (!wasRecording) {
        try {
          await stopArmedHyperDecks();
        } catch (e) {
          console.error('[Recording] Failed to stop HyperDecks after error:', e);
        }
      }
    } finally {
      btn.disabled = false;
    }
  }

  /**
   * Update recording UI state.
   */
  function updateRecordingUI() {
    const btn = elements.recordingToggle;
    const textEl = btn.querySelector('.btn__text');

    if (state.recording) {
      btn.classList.remove('btn--stopped');
      btn.classList.add('btn--recording-active');
      textEl.textContent = 'Stop Recording';
      startRecordingTimer();
    } else {
      btn.classList.remove('btn--recording-active');
      btn.classList.add('btn--stopped');
      textEl.textContent = 'Start Recording';
      stopRecordingTimer();
      elements.recordingDuration.textContent = '00:00:00';
    }
  }

  /**
   * Start the recording timer display.
   */
  function startRecordingTimer() {
    if (state.recordingTimer) {
      clearInterval(state.recordingTimer);
    }

    state.recordingTimer = setInterval(() => {
      if (state.recordingStartTime) {
        const elapsed = Math.floor((Date.now() - state.recordingStartTime.getTime()) / 1000);
        elements.recordingDuration.textContent = formatDuration(elapsed);
      }
    }, 1000);
  }

  /**
   * Stop the recording timer display.
   */
  function stopRecordingTimer() {
    if (state.recordingTimer) {
      clearInterval(state.recordingTimer);
      state.recordingTimer = null;
    }
  }

  /**
   * Format duration in HH:MM:SS.
   */
  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // ============================================================================
  // Export Functions
  // ============================================================================

  /**
   * Get selected export format.
   */
  function getSelectedFormat() {
    const selected = document.querySelector('input[name="export-format"]:checked');
    return selected ? selected.value : 'cmx3600';
  }

  /**
   * Get export options.
   */
  function getExportOptions() {
    return {
      format: getSelectedFormat(),
      includeComments: elements.exportComments.checked,
      includeClipNames: elements.exportClipNames.checked,
      title: elements.exportTitle.value || 'LIVE_PRODUCTION',
    };
  }

  /**
   * Download EDL in selected format.
   */
  async function downloadExport() {
    const btn = elements.exportDownload;
    const options = getExportOptions();

    btn.disabled = true;
    btn.querySelector('.btn__icon').textContent = '⏳';

    try {
      const params = new URLSearchParams({
        format: options.format,
        title: options.title,
        comments: options.includeComments,
        clipNames: options.includeClipNames,
      });

      const response = await fetch(`/api/edl/download?${params}`);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      // Get filename from Content-Disposition header
      const disposition = response.headers.get('Content-Disposition');
      let filename = getDefaultFilename(options.format);
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

      console.log('[Export] Downloaded:', filename);

      // Add to recent exports
      addRecentExport(filename, options.format);
    } catch (error) {
      console.error('[Export] Download failed:', error);
      alert('Failed to export: ' + error.message);
    } finally {
      btn.disabled = state.eventCount === 0;
      btn.querySelector('.btn__icon').textContent = '↓';
    }
  }

  /**
   * Preview EDL content.
   */
  async function previewExport() {
    const btn = elements.exportPreview;
    const options = getExportOptions();

    btn.disabled = true;

    try {
      const params = new URLSearchParams({
        format: options.format,
        title: options.title,
        comments: options.includeComments,
        clipNames: options.includeClipNames,
      });

      const response = await fetch(`/api/edl/generate?${params}`);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      showPreviewModal(data.content, options.format);
    } catch (error) {
      console.error('[Export] Preview failed:', error);
      alert('Failed to preview: ' + error.message);
    } finally {
      btn.disabled = state.eventCount === 0;
    }
  }

  /**
   * Get default filename for format.
   */
  function getDefaultFilename(format) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    switch (format) {
      case 'resolve':
        return `output_${timestamp}.drp`;
      case 'fcpxml':
        return `output_${timestamp}.xml`;
      default:
        return `output_${timestamp}.edl`;
    }
  }

  /**
   * Add export to recent list.
   */
  function addRecentExport(filename, format) {
    const formatLabels = {
      cmx3600: 'CMX 3600 EDL',
      resolve: 'DaVinci Resolve',
      fcpxml: 'FCP7 XML',
    };

    state.recentExports.unshift({
      filename,
      format: formatLabels[format] || format,
      timestamp: new Date(),
    });

    // Limit to 10 recent exports
    if (state.recentExports.length > 10) {
      state.recentExports.pop();
    }

    renderRecentExports();
  }

  /**
   * Render recent exports list.
   */
  function renderRecentExports() {
    if (state.recentExports.length === 0) {
      elements.recentExports.innerHTML = '<div class="recent-exports__empty">No exports yet</div>';
      return;
    }

    elements.recentExports.innerHTML = state.recentExports
      .map(
        (exp) => `
        <div class="recent-export">
          <span class="recent-export__name">${escapeHtml(exp.filename)}</span>
          <span class="recent-export__format">${escapeHtml(exp.format)}</span>
          <span class="recent-export__time">${formatTime(exp.timestamp)}</span>
        </div>
      `
      )
      .join('');
  }

  /**
   * Update export buttons state.
   */
  function updateExportButtons() {
    const hasEvents = state.eventCount > 0;
    elements.exportDownload.disabled = !hasEvents;
    elements.exportPreview.disabled = !hasEvents;
    if (elements.exportEventCount) {
      elements.exportEventCount.textContent = state.eventCount.toString();
    }
  }

  // ============================================================================
  // Preview Modal
  // ============================================================================

  /**
   * Show preview modal with content.
   */
  function showPreviewModal(content, format) {
    elements.previewContent.textContent = content;
    elements.previewModal.classList.remove('hidden');

    // Store content for copy/download
    elements.previewModal.dataset.content = content;
    elements.previewModal.dataset.format = format;
  }

  /**
   * Hide preview modal.
   */
  function hidePreviewModal() {
    elements.previewModal.classList.add('hidden');
  }

  /**
   * Copy preview content to clipboard.
   */
  async function copyPreviewContent() {
    const content = elements.previewModal.dataset.content;

    try {
      await navigator.clipboard.writeText(content);
      elements.previewCopy.textContent = 'Copied!';
      setTimeout(() => {
        elements.previewCopy.textContent = 'Copy to Clipboard';
      }, 2000);
    } catch (error) {
      console.error('[Preview] Copy failed:', error);
      alert('Failed to copy to clipboard');
    }
  }

  /**
   * Download preview content.
   */
  function downloadPreviewContent() {
    const content = elements.previewModal.dataset.content;
    const format = elements.previewModal.dataset.format;
    const filename = getDefaultFilename(format);

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    hidePreviewModal();
  }

  /**
   * Set up modal event handlers.
   */
  function setupModal() {
    elements.modalClose.addEventListener('click', hidePreviewModal);
    elements.modalBackdrop.addEventListener('click', hidePreviewModal);
    elements.previewCopy.addEventListener('click', copyPreviewContent);
    elements.previewDownload.addEventListener('click', downloadPreviewContent);

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !elements.previewModal.classList.contains('hidden')) {
        hidePreviewModal();
      }
    });
  }

  // ============================================================================
  // Settings
  // ============================================================================

  /**
   * Populate settings form from config.
   */
  function populateSettings(config) {
    if (!config) return;

    // ATEM settings
    if (config.atem) {
      elements.settingAtemHost.value = config.atem.host || '10.7.77.7';
      elements.settingAtemME.value = config.atem.mixEffect ?? '0';
      elements.settingFrameOffset.value = config.atem.frameOffset ?? '0';
    } else {
      // Default values when no config exists
      elements.settingAtemHost.value = '10.7.77.7';
    }

    // Timecode settings
    if (config.timecode) {
      elements.settingFrameRate.value = config.timecode.frameRate || '25';
      elements.settingDropFrame.checked = config.timecode.dropFrame || false;
      elements.settingStartTC.value = config.timecode.startTimecode || '01:00:00:00';
      elements.settingTCSource.value = config.timecode.source || 'system';

      // HyperDeck timecode source settings
      if (config.timecode.hyperdeck) {
        elements.settingTcHyperdeckHost.value = config.timecode.hyperdeck.host || '';
        elements.settingTcHyperdeckPort.value = config.timecode.hyperdeck.port || 9993;
      }

      // Update TC source UI (visibility and state)
      updateTcSourceUI();
    }
  }

  /**
   * Show/hide HyperDeck timecode settings based on selected source.
   */
  function updateTcSourceVisibility() {
    const source = elements.settingTCSource.value;
    if (source === 'hyperdeck') {
      elements.hyperdeckTcSettings.classList.remove('hidden');
    } else {
      elements.hyperdeckTcSettings.classList.add('hidden');
    }
  }

  /**
   * Collect settings from form.
   */
  function collectSettings() {
    const source = elements.settingTCSource.value;
    const timecode = {
      frameRate: parseFloat(elements.settingFrameRate.value),
      dropFrame: elements.settingDropFrame.checked,
      startTimecode: elements.settingStartTC.value,
      source: source,
    };

    // Include HyperDeck TC config if source is hyperdeck
    if (source === 'hyperdeck' && elements.settingTcHyperdeckHost.value) {
      timecode.hyperdeck = {
        host: elements.settingTcHyperdeckHost.value,
        port: parseInt(elements.settingTcHyperdeckPort.value, 10) || 9993,
      };
    }

    return {
      atem: {
        host: elements.settingAtemHost.value || '10.7.77.7',
        mixEffect: parseInt(elements.settingAtemME.value, 10),
        frameOffset: parseInt(elements.settingFrameOffset.value, 10),
      },
      timecode,
      ...collectSources(),
    };
  }

  /**
   * Save settings to server.
   */
  async function saveSettings() {
    const btn = elements.settingsSave;
    const status = elements.settingsStatus;

    btn.disabled = true;
    status.textContent = 'Saving...';
    status.className = 'settings-status';

    try {
      const settings = collectSettings();
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      status.textContent = 'Settings saved';
      status.classList.add('success');
      setTimeout(() => {
        status.textContent = '';
        status.className = 'settings-status';
      }, 3000);
    } catch (error) {
      console.error('[Settings] Save failed:', error);
      status.textContent = 'Failed to save: ' + error.message;
      status.classList.add('error');
    } finally {
      btn.disabled = false;
    }
  }

  /**
   * Reset settings to defaults.
   */
  async function resetSettings() {
    if (!confirm('Reset all settings to defaults?')) {
      return;
    }

    try {
      const response = await fetch('/api/config/reset', { method: 'POST' });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      populateSettings(result.config);
      state.config = result.config;

      elements.settingsStatus.textContent = 'Reset to defaults';
      elements.settingsStatus.classList.add('success');
      setTimeout(() => {
        elements.settingsStatus.textContent = '';
        elements.settingsStatus.className = 'settings-status';
      }, 3000);
    } catch (error) {
      console.error('[Settings] Reset failed:', error);
      alert('Failed to reset settings: ' + error.message);
    }
  }

  // ============================================================================
  // Sources (unified inputs + hyperdecks)
  // ============================================================================

  /**
   * Build unified source data by merging inputs with their hyperdecks.
   * Each input can optionally have a hyperdeck (ISO recorder) associated.
   */
  function buildSourceData() {
    // Create a map of inputId -> hyperdeck
    const hyperdeckMap = new Map();
    for (const hd of state.hyperdecks) {
      hyperdeckMap.set(hd.inputMapping, hd);
    }

    // Merge inputs with hyperdecks and source states
    return state.inputs.map((input) => {
      const hd = hyperdeckMap.get(input.inputId);
      const sourceState = state.sourceStates.get(input.inputId) || {
        armed: true,
        includeInEdl: true,
      };
      return {
        inputId: input.inputId,
        name: input.name,
        reelName: input.reelName,
        hyperdeckHost: hd?.host || '',
        isTcMaster: state.tcMasterInputId === input.inputId,
        armed: sourceState.armed,
        includeInEdl: sourceState.includeInEdl,
        hasHyperdeck: !!hd?.host,
      };
    });
  }

  /**
   * Get or create source state for an input.
   */
  function getSourceState(inputId) {
    if (!state.sourceStates.has(inputId)) {
      state.sourceStates.set(inputId, {
        armed: true,
        includeInEdl: true,
      });
    }
    return state.sourceStates.get(inputId);
  }

  /**
   * Render the unified source table.
   */
  function renderSources() {
    const sources = buildSourceData();

    if (sources.length === 0) {
      elements.sourceList.innerHTML =
        '<div class="source-table__empty">No sources configured. Add sources below.</div>';
      updateTcMasterDisplay();
      return;
    }

    elements.sourceList.innerHTML = sources
      .map(
        (src, index) => `
        <div class="source-row${src.isTcMaster ? ' source-row--tc-master' : ''}" data-index="${index}" data-input-id="${src.inputId}">
          <div class="source-col source-col--id">
            <input type="number" value="${src.inputId || ''}" data-field="inputId" min="1" max="9999">
          </div>
          <div class="source-col source-col--name">
            <input type="text" value="${escapeHtml(src.name || '')}" data-field="name" placeholder="Camera name">
          </div>
          <div class="source-col source-col--reel">
            <input type="text" value="${escapeHtml(src.reelName || '')}" data-field="reelName" maxlength="8" placeholder="REEL">
          </div>
          <div class="source-col source-col--deck">
            <input type="text" value="${escapeHtml(src.hyperdeckHost || '')}" data-field="hyperdeckHost" placeholder="(no ISO)">
          </div>
          <div class="source-col source-col--tc">
            <input type="radio" name="tc-master" value="${src.inputId}" ${src.isTcMaster ? 'checked' : ''} ${src.hasHyperdeck ? '' : 'disabled'} title="${src.hasHyperdeck ? 'Set as TC Master' : 'No HyperDeck configured'}">
          </div>
          <div class="source-col source-col--arm">
            <input type="checkbox" data-field="armed" ${src.armed ? 'checked' : ''} ${src.hasHyperdeck ? '' : 'disabled'} title="${src.hasHyperdeck ? 'Arm for recording' : 'No HyperDeck configured'}">
          </div>
          <div class="source-col source-col--edl">
            <input type="checkbox" data-field="includeInEdl" ${src.includeInEdl ? 'checked' : ''} title="Include in EDL export">
          </div>
          <div class="source-col source-col--actions">
            <button type="button" class="source-row__delete" data-index="${index}" title="Remove source">×</button>
          </div>
        </div>
      `
      )
      .join('');

    // Attach event handlers
    attachSourceEventHandlers(sources);
    updateTcMasterDisplay();
  }

  /**
   * Attach event handlers to source table rows.
   */
  function attachSourceEventHandlers(sources) {
    // Delete handlers
    elements.sourceList.querySelectorAll('.source-row__delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index, 10);
        const removedInput = sources[index];
        state.inputs.splice(index, 1);
        if (removedInput) {
          state.hyperdecks = state.hyperdecks.filter(
            (hd) => hd.inputMapping !== removedInput.inputId
          );
          state.sourceStates.delete(removedInput.inputId);
          if (state.tcMasterInputId === removedInput.inputId) {
            state.tcMasterInputId = null;
          }
        }
        renderSources();
        scheduleAutoSave();
      });
    });

    // TC Master radio handlers
    elements.sourceList.querySelectorAll('input[name="tc-master"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const inputId = parseInt(radio.value, 10);
        state.tcMasterInputId = radio.checked ? inputId : null;
        renderSources();
        scheduleAutoSave();
      });
    });

    // Armed checkbox handlers
    elements.sourceList.querySelectorAll('input[data-field="armed"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const row = checkbox.closest('.source-row');
        const inputId = parseInt(row.dataset.inputId, 10);
        const sourceState = getSourceState(inputId);
        sourceState.armed = checkbox.checked;
        scheduleAutoSave();
      });
    });

    // Include in EDL checkbox handlers
    elements.sourceList.querySelectorAll('input[data-field="includeInEdl"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const row = checkbox.closest('.source-row');
        const inputId = parseInt(row.dataset.inputId, 10);
        const sourceState = getSourceState(inputId);
        sourceState.includeInEdl = checkbox.checked;
        scheduleAutoSave();
      });
    });

    // Input field change handlers (for auto-save)
    elements.sourceList.querySelectorAll('input[data-field="inputId"], input[data-field="name"], input[data-field="reelName"], input[data-field="hyperdeckHost"]').forEach((input) => {
      input.addEventListener('change', () => {
        scheduleAutoSave();
      });
    });
  }

  /**
   * Update the TC Master display in settings.
   */
  function updateTcMasterDisplay() {
    if (!elements.tcMasterName) return;

    if (state.tcMasterInputId !== null) {
      const source = state.inputs.find((i) => i.inputId === state.tcMasterInputId);
      if (source) {
        elements.tcMasterName.textContent = `${source.name} (${source.inputId})`;
      } else {
        elements.tcMasterName.textContent = 'None selected';
        state.tcMasterInputId = null;
      }
    } else {
      elements.tcMasterName.textContent = 'None selected';
    }
  }

  /**
   * Add a new source.
   */
  function addSource() {
    // Find next available input ID
    const usedIds = new Set(state.inputs.map((i) => i.inputId));
    let nextId = 1;
    while (usedIds.has(nextId) && nextId <= 100) {
      nextId++;
    }

    state.inputs.push({
      inputId: nextId,
      name: `Input ${nextId}`,
      reelName: `CAM${nextId}`,
    });
    renderSources();
  }

  /**
   * Collect sources from the form and split into inputs + hyperdecks.
   */
  function collectSources() {
    const rows = elements.sourceList.querySelectorAll('.source-row');
    const inputs = [];
    const hyperdecks = [];

    rows.forEach((row) => {
      const inputId = parseInt(row.querySelector('[data-field="inputId"]').value, 10);
      const name = row.querySelector('[data-field="name"]').value;
      const reelName = row.querySelector('[data-field="reelName"]').value;
      const hyperdeckHost = row.querySelector('[data-field="hyperdeckHost"]').value.trim();

      if (inputId && name) {
        inputs.push({ inputId, name, reelName: reelName || `IN${inputId}` });

        // If hyperdeck host is specified, create a hyperdeck entry
        if (hyperdeckHost) {
          hyperdecks.push({
            name: `${name} ISO`,
            host: hyperdeckHost,
            port: 9993,
            inputMapping: inputId,
            enabled: true,
            frameOffset: 0,
          });
        }
      }
    });

    return { inputs, hyperdecks };
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
    if (elements.exportEventCount) {
      elements.exportEventCount.textContent = count.toString();
    }
  }

  /**
   * Update config display elements.
   */
  function updateConfigDisplay(config) {
    if (!config) return;

    // Update export tab info
    if (elements.exportFrameRate && config.timecode) {
      elements.exportFrameRate.textContent = `${config.timecode.frameRate} fps`;
    }
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

  // ============================================================================
  // Utility Functions
  // ============================================================================

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

  /**
   * Format timestamp for display.
   */
  function formatTime(date) {
    return new Date(date).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Escape HTML to prevent XSS.
   */
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

      // Update export duration
      if (elements.exportDuration) {
        elements.exportDuration.textContent = formatUptime(data.session.uptime);
      }

      return data;
    } catch (error) {
      console.error('[API] Failed to fetch status:', error);
      return null;
    }
  }

  /**
   * Fetch inputs from API.
   */
  async function fetchInputs() {
    try {
      const response = await fetch('/api/inputs');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      state.inputs = data.inputs || [];
      renderSources();
    } catch (error) {
      console.error('[API] Failed to fetch inputs:', error);
    }
  }

  // ============================================================================
  // Local Storage Persistence
  // ============================================================================

  /**
   * Load persisted state from localStorage.
   */
  function loadPersistedState() {
    try {
      const saved = localStorage.getItem(CONFIG.localStorageKey);
      if (!saved) return;

      const data = JSON.parse(saved);
      console.log('[Storage] Loading persisted state');

      // Restore active tab
      if (data.activeTab) {
        state.activeTab = data.activeTab;
      }

      // Restore source states
      if (data.sourceStates && Array.isArray(data.sourceStates)) {
        state.sourceStates = new Map(data.sourceStates);
      }

      // Restore TC master
      if (data.tcMasterInputId !== undefined) {
        state.tcMasterInputId = data.tcMasterInputId;
      }

      // Restore use table TC master flag
      if (data.useTableTcMaster !== undefined) {
        state.useTableTcMaster = data.useTableTcMaster;
      }

      // Restore recent exports
      if (data.recentExports && Array.isArray(data.recentExports)) {
        state.recentExports = data.recentExports.map((exp) => ({
          ...exp,
          timestamp: new Date(exp.timestamp),
        }));
      }

      // Restore export format preference
      if (data.exportFormat) {
        const formatInput = document.querySelector(`input[name="export-format"][value="${data.exportFormat}"]`);
        if (formatInput) {
          formatInput.checked = true;
        }
      }

    } catch (error) {
      console.error('[Storage] Failed to load persisted state:', error);
    }
  }

  /**
   * Save state to localStorage.
   */
  function savePersistedState() {
    try {
      const data = {
        activeTab: state.activeTab,
        sourceStates: Array.from(state.sourceStates.entries()),
        tcMasterInputId: state.tcMasterInputId,
        useTableTcMaster: state.useTableTcMaster,
        recentExports: state.recentExports,
        exportFormat: getSelectedFormat(),
      };
      localStorage.setItem(CONFIG.localStorageKey, JSON.stringify(data));
      console.log('[Storage] State persisted');
    } catch (error) {
      console.error('[Storage] Failed to persist state:', error);
    }
  }

  /**
   * Schedule auto-save with debouncing.
   */
  function scheduleAutoSave() {
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer);
    }
    state.autoSaveTimer = setTimeout(() => {
      savePersistedState();
      autoSaveToBackend();
    }, CONFIG.autoSaveDebounceMs);
  }

  /**
   * Auto-save configuration to backend.
   */
  async function autoSaveToBackend() {
    try {
      const settings = collectSettings();
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        console.warn('[AutoSave] Backend save failed:', response.status);
      } else {
        console.log('[AutoSave] Configuration saved to backend');
      }
    } catch (error) {
      console.warn('[AutoSave] Backend save failed:', error.message);
    }
  }

  // ============================================================================
  // Timecode Display
  // ============================================================================

  /**
   * Start polling timecode from selected source.
   */
  function startTimecodePolling() {
    if (state.timecodePollTimer) {
      clearInterval(state.timecodePollTimer);
    }

    // Initial update
    updateTimecodeDisplay();

    // Start polling
    state.timecodePollTimer = setInterval(updateTimecodeDisplay, CONFIG.timecodePollInterval);
  }

  /**
   * Update timecode display from selected source.
   */
  async function updateTimecodeDisplay() {
    const source = state.config?.timecode?.source || 'system';

    if (source === 'system') {
      // System clock timecode
      const tc = generateSystemTimecode();
      displayTimecode(tc, 'SYS');
    } else if (source === 'hyperdeck') {
      // HyperDeck timecode
      const tcHost = getActiveTcHost();
      if (tcHost) {
        try {
          const tc = await fetchHyperDeckTimecode(tcHost);
          displayTimecode(tc, 'HD');
        } catch (error) {
          displayTimecode('--:--:--:--', 'HD?');
        }
      } else {
        // Fall back to system if no TC master selected
        const tc = generateSystemTimecode();
        displayTimecode(tc, 'SYS');
      }
    }
  }

  /**
   * Get the active timecode host (from table master or manual entry).
   */
  function getActiveTcHost() {
    if (state.useTableTcMaster && state.tcMasterInputId !== null) {
      // Find the hyperdeck for the TC master input
      const hd = state.hyperdecks.find((h) => h.inputMapping === state.tcMasterInputId);
      return hd ? { host: hd.host, port: hd.port || 9993 } : null;
    } else {
      // Use manual entry
      const host = elements.settingTcHyperdeckHost?.value;
      const port = parseInt(elements.settingTcHyperdeckPort?.value, 10) || 9993;
      return host ? { host, port } : null;
    }
  }

  /**
   * Generate timecode from system clock.
   */
  function generateSystemTimecode() {
    const now = new Date();
    const frameRate = state.config?.edl?.frameRate || 25;
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    const f = Math.floor((now.getMilliseconds() / 1000) * frameRate).toString().padStart(2, '0');
    return `${h}:${m}:${s}:${f}`;
  }

  /**
   * Fetch timecode from HyperDeck via API.
   */
  async function fetchHyperDeckTimecode(tcHost) {
    const response = await fetch(`/api/timecode?host=${encodeURIComponent(tcHost.host)}&port=${tcHost.port}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.timecode || '--:--:--:--';
  }

  /**
   * Display timecode in footer.
   */
  function displayTimecode(tc, sourceLabel) {
    if (elements.timecodeDisplay) {
      elements.timecodeDisplay.textContent = tc;
    }
    if (elements.timecodeSourceIndicator) {
      elements.timecodeSourceIndicator.textContent = sourceLabel;
      elements.timecodeSourceIndicator.className = 'timecode-source';
      if (sourceLabel === 'HD') {
        elements.timecodeSourceIndicator.classList.add('timecode-source--hyperdeck');
      } else if (sourceLabel === 'SYS') {
        elements.timecodeSourceIndicator.classList.add('timecode-source--system');
      }
    }
  }

  // ============================================================================
  // HyperDeck Recording Control
  // ============================================================================

  /**
   * Start recording on all armed HyperDecks.
   */
  async function startArmedHyperDecks() {
    const armedDecks = getArmedHyperDecks();
    if (armedDecks.length === 0) {
      console.log('[HyperDeck] No armed decks to start');
      return;
    }

    console.log(`[HyperDeck] Starting recording on ${armedDecks.length} armed deck(s)`);

    const results = await Promise.allSettled(
      armedDecks.map((deck) => startHyperDeckRecording(deck))
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`[HyperDeck] ${failed.length} deck(s) failed to start recording`);
    }
  }

  /**
   * Stop recording on all armed HyperDecks.
   */
  async function stopArmedHyperDecks() {
    const armedDecks = getArmedHyperDecks();
    if (armedDecks.length === 0) {
      console.log('[HyperDeck] No armed decks to stop');
      return;
    }

    console.log(`[HyperDeck] Stopping recording on ${armedDecks.length} armed deck(s)`);

    const results = await Promise.allSettled(
      armedDecks.map((deck) => stopHyperDeckRecording(deck))
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`[HyperDeck] ${failed.length} deck(s) failed to stop recording`);
    }
  }

  /**
   * Get list of armed HyperDecks.
   */
  function getArmedHyperDecks() {
    return state.hyperdecks.filter((hd) => {
      const sourceState = state.sourceStates.get(hd.inputMapping);
      return sourceState?.armed !== false; // Default to armed if not set
    });
  }

  /**
   * Start recording on a single HyperDeck.
   */
  async function startHyperDeckRecording(deck) {
    const response = await fetch('/api/hyperdeck/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: deck.host,
        port: deck.port || 9993,
        action: 'start',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to start recording on ${deck.host}`);
    }

    console.log(`[HyperDeck] Started recording on ${deck.name || deck.host}`);
  }

  /**
   * Stop recording on a single HyperDeck.
   */
  async function stopHyperDeckRecording(deck) {
    const response = await fetch('/api/hyperdeck/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: deck.host,
        port: deck.port || 9993,
        action: 'stop',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to stop recording on ${deck.host}`);
    }

    console.log(`[HyperDeck] Stopped recording on ${deck.name || deck.host}`);
  }

  // ============================================================================
  // TC Source Settings UI
  // ============================================================================

  /**
   * Update TC source UI visibility and state.
   */
  function updateTcSourceUI() {
    updateTcSourceVisibility();
    updateUseTableMasterUI();
  }

  /**
   * Update use table master UI visibility.
   */
  function updateUseTableMasterUI() {
    if (!elements.settingTcUseTableMaster) return;

    const useTable = elements.settingTcUseTableMaster.checked;
    state.useTableTcMaster = useTable;

    if (elements.hyperdeckTcManual) {
      elements.hyperdeckTcManual.classList.toggle('hidden', useTable);
    }
    if (elements.hyperdeckTcFromTable) {
      elements.hyperdeckTcFromTable.classList.toggle('hidden', !useTable);
    }

    updateTcMasterDisplay();
  }

  // ============================================================================
  // Initialisation
  // ============================================================================

  /**
   * Initialise the dashboard.
   */
  function init() {
    console.log('[App] Initialising ATEM ISO EDL Generator Dashboard');

    // Load persisted state from localStorage FIRST
    loadPersistedState();

    // Start clock
    updateClock();
    setInterval(updateClock, CONFIG.clockUpdateInterval);

    // Start timecode display polling
    startTimecodePolling();

    // Start status polling
    fetchStatus();
    setInterval(fetchStatus, CONFIG.statusPollInterval);

    // Connect WebSocket
    connectWebSocket();

    // Set up tab navigation
    setupTabNavigation();

    // Restore active tab from persisted state
    if (state.activeTab && state.activeTab !== 'dashboard') {
      switchTab(state.activeTab);
    }

    // Set up recording control
    elements.recordingToggle.addEventListener('click', toggleRecording);

    // Set up export buttons
    elements.exportDownload.addEventListener('click', downloadExport);
    elements.exportPreview.addEventListener('click', previewExport);

    // Set up export format change handler for persistence
    elements.exportFormatInputs.forEach((input) => {
      input.addEventListener('change', () => {
        scheduleAutoSave();
      });
    });

    // Set up modal
    setupModal();

    // Set up settings
    elements.settingsSave.addEventListener('click', saveSettings);
    elements.settingsReset.addEventListener('click', resetSettings);
    elements.addSource.addEventListener('click', addSource);

    // Timecode source dropdown - show/hide HyperDeck settings
    elements.settingTCSource.addEventListener('change', () => {
      updateTcSourceUI();
      scheduleAutoSave();
    });

    // Use table TC master checkbox
    if (elements.settingTcUseTableMaster) {
      elements.settingTcUseTableMaster.checked = state.useTableTcMaster;
      elements.settingTcUseTableMaster.addEventListener('change', () => {
        updateUseTableMasterUI();
        scheduleAutoSave();
      });
    }

    // Fetch inputs for settings
    fetchInputs();

    // Render lists (will use persisted state for recent exports)
    renderSources();
    renderRecentExports();

    // Initial TC source UI state
    updateTcSourceUI();

    console.log('[App] Initialisation complete');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
